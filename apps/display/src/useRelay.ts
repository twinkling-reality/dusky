import type { DisplayFrame, DisplayToServer, ServerToDisplay, TaskState } from "@dusky/contracts";
import { CLOSE_NOT_A_CODE, CLOSE_SUPERSEDED } from "@dusky/contracts";
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
}

const RECONNECT_MS = [250, 500, 1000, 2000, 4000] as const;

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
  };
}
