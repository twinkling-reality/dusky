import type { DisplayFrame, DisplayToServer, ServerToDisplay, TaskState } from "@dusky/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The Display's link to its session.
 *
 * The glasses hold no application state. The server is the source of truth, so
 * a dropped socket must never lose the wearer's place: on reconnect the server
 * replays the current frame. That is also why every reconnect is silent rather
 * than an error screen, up until the point where we genuinely cannot reach it.
 */

export type LinkState = "connecting" | "open" | "reconnecting" | "offline";

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

    const connect = () => {
      if (disposed) return;
      const sock = new WebSocket(url);
      ws.current = sock;

      sock.onopen = () => {
        if (disposed) return;
        attempts = 0;
        setLink("open");
        sock.send(
          JSON.stringify({ t: "hello", sessionId, client: "display" } satisfies DisplayToServer),
        );
      };

      sock.onmessage = (ev) => {
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
        // selection locally the instant the gesture landed.
      };

      sock.onclose = () => {
        if (disposed) return;
        const i = Math.min(attempts, RECONNECT_MS.length - 1);
        const delay = RECONNECT_MS[i]!;
        attempts += 1;
        setLink(attempts > RECONNECT_MS.length ? "offline" : "reconnecting");
        timer = setTimeout(connect, delay);
      };

      sock.onerror = () => sock.close();
    };

    connect();
    return () => {
      disposed = true;
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
