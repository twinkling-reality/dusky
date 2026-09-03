import type {
  DisplayFrame,
  DisplayToServer,
  PositionRefusal,
  ServerToDisplay,
  TaskState,
} from "@dusky/contracts";
import { CLOSE_NOT_A_CODE, CLOSE_SUPERSEDED, roundCoordinate } from "@dusky/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The Display's link to its session.
 *
 * The glasses hold no application state. The server is the source of truth, so
 * a dropped socket must never lose the wearer's place: on reconnect the server
 * replays the current frame. That is also why every reconnect is silent rather
 * than an error screen, up until the point where we genuinely cannot reach it.
 */

/**
 * `superseded` is terminal on purpose. Something else took this session, and
 * reconnecting would take it back, which is how two clients on one pairing
 * code used to trade the session between them several times a second.
 */
export type LinkState =
  | "connecting"
  | "open"
  | "reconnecting"
  | "offline"
  | "superseded"
  /** The session id is not a pairing code. Asking again cannot change that. */
  | "rejected";

export interface Relay {
  link: LinkState;
  frame: DisplayFrame | null;
  state: TaskState;
  /** Increments on every frame so the D-pad knows to reset focus. */
  frameKey: string;
  choose: (choiceId: string) => void;
  submitText: (value: string) => void;
  back: () => void;
  /**
   * Read where this device is and send it, or send why it could not.
   *
   * The read is deliberately here rather than at the relay's request. Meta's
   * Web App guidance is to trigger a permission request from a user gesture,
   * and a message arriving over a WebSocket has none: this is called straight
   * out of the wearer's keypress handler, so the browser sees the activation
   * that produced it.
   *
   * Always answers. A refusal is as much an answer as a fix, because the
   * alternative is a wearer looking at an unchanged panel wondering whether
   * their press registered, which is the failure this device makes worst.
   */
  sendPosition: () => void;
}

const RECONNECT_MS = [250, 500, 1000, 2000, 4000] as const;

/**
 * How long a wearer waits on a position before being told to write it.
 *
 * Meta reports 5-50m accuracy from the paired phone rather than from the
 * glasses, so this crosses a radio link before it crosses ours. Ten seconds is
 * long enough for a cold fix over that hop and short enough that the panel
 * does not look hung, which on a cursorless display is the same as crashed.
 * Unverified against real glasses; see FIELD-NOTES.
 */
const POSITION_TIMEOUT_MS = 10_000;

/**
 * The ceiling on the whole attempt, permission prompt included.
 *
 * Longer than the read timeout so the ordinary path always wins, and short
 * enough that an unanswered prompt still returns the wearer to the composer
 * rather than leaving them on a panel that looks hung.
 */
const POSITION_WATCHDOG_MS = 15_000;

/**
 * How old a cached browser fix may be and still answer.
 *
 * A tool wanting a coordinate wants both halves of one, and both halves should
 * describe the same place. Letting the browser serve its own recent fix is
 * what makes that true without Dusky storing a position anywhere.
 */
const POSITION_MAX_AGE_MS = 60_000;

/**
 * Liveness, because a sleeping pair of glasses does not close its socket.
 *
 * The page is SUSPENDED rather than unloaded when the display sleeps. The
 * radio stops without a FIN or an RST, so `readyState` stays OPEN, `send`
 * writes into nothing, and `onclose` never fires. Everything downstream then
 * behaves as though the link were healthy: `link` stays "open" so no badge
 * appears, the wearer's frame is stale, every control is dead, and the local
 * gesture acknowledgement sweeps forever because no frame ever arrives to
 * clear it. That is the "indistinguishable from a crash" failure this
 * codebase refuses everywhere else.
 *
 * Only traffic can tell a live socket from a dead one, so we make some.
 */
const PING_MS = 15_000;
/** Silence longer than this means the socket is gone, whatever it claims. */
const SILENCE_MS = 30_000;
/** On resume, treat anything older than this as needing proof. */
const RESUME_STALE_MS = 10_000;
/** How long that proof gets to arrive before we give up on the socket. */
const PROBE_MS = 3_000;

/**
 * How long a connection has to last before it counts as having worked.
 *
 * Backoff used to reset the moment a socket opened, so a connection that
 * opened and died immediately retried at 250ms forever and never escalated.
 * Escalation only means anything if a flap is distinguishable from a session
 * that ran for an hour and then dropped.
 */
const STABLE_MS = 5_000;

export function useRelay(url: string, sessionId: string): Relay {
  const [link, setLink] = useState<LinkState>("connecting");
  const [frame, setFrame] = useState<DisplayFrame | null>(null);
  const [state, setState] = useState<TaskState>("idle");
  const [frameKey, setFrameKey] = useState("0");

  const ws = useRef<WebSocket | null>(null);

  const send = useCallback((msg: DisplayToServer) => {
    const sock = ws.current;
    if (sock?.readyState === WebSocket.OPEN) sock.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    // Disposal state MUST be local to this effect invocation, not a ref.
    // A shared ref is reset by the next mount, so the previous socket's close
    // handler sees "not disposed" and schedules a reconnect that nobody owns.
    // React StrictMode reproduces this on every mount and it degenerates into
    // a reconnect storm, with a fresh frame each time resetting the wearer's
    // focus to the top of the list.
    let disposed = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let beat: ReturnType<typeof setInterval> | undefined;
    // Every one of these is local to this effect invocation, for the same
    // reason `disposed` is: a ref survives into the next mount and lets a
    // dead socket's handlers act on the live one's behalf.
    let lastInbound = 0;
    let openedAt = 0;

    const stopBeat = () => {
      if (beat !== undefined) clearInterval(beat);
      beat = undefined;
    };

    const connect = () => {
      if (disposed) return;
      const sock = new WebSocket(url);
      ws.current = sock;

      sock.onopen = () => {
        if (disposed) return;
        openedAt = Date.now();
        lastInbound = openedAt;
        setLink("open");
        sock.send(
          JSON.stringify({ t: "hello", sessionId, client: "display" } satisfies DisplayToServer),
        );

        stopBeat();
        beat = setInterval(() => {
          if (disposed || sock.readyState !== WebSocket.OPEN) return;
          if (Date.now() - lastInbound > SILENCE_MS) {
            // Closing it is what starts the recovery: `onclose` is the only
            // path to a reconnect, and a half-open socket will never call it
            // on its own.
            sock.close();
            return;
          }
          sock.send(JSON.stringify({ t: "ping" } satisfies DisplayToServer));
        }, PING_MS);
      };

      sock.onmessage = (ev) => {
        // Before the parse: an unparseable message is still evidence that the
        // other end is alive, which is all this timestamp claims.
        lastInbound = Date.now();
        let msg: ServerToDisplay;
        try {
          msg = JSON.parse(String(ev.data)) as ServerToDisplay;
        } catch {
          return;
        }
        if (msg.t === "frame") {
          setFrame(msg.frame);
          setState(msg.state);
          setFrameKey(msg.frameId);
        }
        // "ack" needs no rendering work: the Display already highlighted the
        // selection locally the instant the gesture landed. "pong" needs none
        // either; its whole job was to arrive.
      };

      sock.onclose = (ev) => {
        stopBeat();
        if (disposed) return;

        // Something else is driving this session now. Taking it back is not
        // recovery, it is the other half of a fight.
        if (ev.code === CLOSE_SUPERSEDED) {
          setLink("superseded");
          return;
        }

        // Not a pairing code. Retrying is not recovery, it is a loop.
        if (ev.code === CLOSE_NOT_A_CODE) {
          setLink("rejected");
          return;
        }

        // A connection that lasted earns a fresh start. One that did not keeps
        // the count, so a flap escalates instead of hammering.
        if (openedAt !== 0 && Date.now() - openedAt > STABLE_MS) attempts = 0;
        openedAt = 0;

        const i = Math.min(attempts, RECONNECT_MS.length - 1);
        const delay = RECONNECT_MS[i]!;
        attempts += 1;
        setLink(attempts > RECONNECT_MS.length ? "offline" : "reconnecting");
        timer = setTimeout(connect, delay);
      };

      sock.onerror = () => sock.close();
    };

    /**
     * The panel just woke up.
     *
     * Timers do not run while a page is suspended, so the silence watchdog
     * above cannot have noticed anything: from its point of view no time
     * passed. This is the only place that can tell.
     *
     * It probes rather than assumes. A short sleep often leaves a perfectly
     * good socket, and closing one costs a reconnect and a frame replay,
     * which resets the wearer's focus to the top of the list.
     */
    const onResume = () => {
      if (disposed) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const sock = ws.current;
      if (!sock || sock.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastInbound <= RESUME_STALE_MS) return;

      const probedAt = Date.now();
      sock.send(JSON.stringify({ t: "ping" } satisfies DisplayToServer));
      setTimeout(() => {
        if (disposed || ws.current !== sock) return;
        if (sock.readyState !== WebSocket.OPEN) return;
        if (lastInbound >= probedAt) return; // Something answered. It is alive.
        sock.close();
      }, PROBE_MS);
    };

    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("pageshow", onResume);

    connect();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("pageshow", onResume);
      stopBeat();
      if (timer !== undefined) clearTimeout(timer);
      ws.current?.close();
      ws.current = null;
    };
  }, [url, sessionId]);

  return {
    link,
    frame,
    state,
    frameKey,
    choose: useCallback(
      (choiceId) => send({ t: "choose", frameId: frameKey, choiceId }),
      [send, frameKey],
    ),
    submitText: useCallback(
      (value) => send({ t: "text", frameId: frameKey, value }),
      [send, frameKey],
    ),
    back: useCallback(() => send({ t: "cancel", frameId: frameKey }), [send, frameKey]),
    sendPosition: useCallback(() => {
      const id = frameKey;
      if (!("geolocation" in navigator)) {
        send({ t: "position", frameId: id, ok: false, reason: "unsupported" });
        return;
      }

      /*
       * Exactly one answer, from whichever of three things happens first.
       *
       * The watchdog is not redundant with the `timeout` option below, and the
       * difference is the whole reason it is here. Per the Geolocation spec
       * that interval starts AFTER permission is granted, so a wearer who is
       * shown a permission prompt and never answers it gets no success
       * callback and no error callback, forever. On this device that is the
       * worst available outcome: the local gesture acknowledgement sweeps on a
       * panel with no cursor, which a wearer reads as a crash. It has happened
       * here before, on the pairing frame, and is written up in FIELD-NOTES.
       */
      let answered = false;
      const answer = (message: DisplayToServer) => {
        if (answered) return;
        answered = true;
        clearTimeout(watchdog);
        send(message);
      };
      const watchdog = setTimeout(
        () => answer({ t: "position", frameId: id, ok: false, reason: "timeout" }),
        POSITION_WATCHDOG_MS,
      );

      navigator.geolocation.getCurrentPosition(
        (fix) => {
          // Rounded HERE, before anything leaves the device. The relay checks
          // the same bound on arrival, but by then the precise value would
          // already have been sent, and a bound applied after transmission is
          // not a bound on what was transmitted.
          answer({
            t: "position",
            frameId: id,
            ok: true,
            position: {
              latitude: roundCoordinate(fix.coords.latitude),
              longitude: roundCoordinate(fix.coords.longitude),
            },
          });
        },
        (err) => {
          // A cross-origin frame without `allow="geolocation"` fails as
          // PERMISSION_DENIED with no prompt, so this branch covers both a
          // wearer saying no and an embedder never having asked.
          const reason: PositionRefusal =
            err.code === err.PERMISSION_DENIED
              ? "denied"
              : err.code === err.TIMEOUT
                ? "timeout"
                : "unavailable";
          answer({ t: "position", frameId: id, ok: false, reason });
        },
        {
          // `maximumAge` lets the second half of a coordinate reuse the fix the
          // first half took, without this file keeping a copy of one.
          enableHighAccuracy: false,
          timeout: POSITION_TIMEOUT_MS,
          maximumAge: POSITION_MAX_AGE_MS,
        },
      );
    }, [send, frameKey]),
  };
}
