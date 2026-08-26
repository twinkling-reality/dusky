import type { ConsoleToServer, ServerToConsole, ToolDescriptor } from "@dusky/contracts";
import { isWebMcpAvailable, WebMcpBridge } from "@dusky/webmcp";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The console's half of the session.
 *
 * This is the only surface in Dusky that can touch WebMCP, because tools live
 * in the partner site's document inside this browser's session. The server
 * asks; this executes; the result goes back. Dusky moves intent, never
 * credentials.
 */

export type LinkState = "connecting" | "open" | "reconnecting" | "offline";

export interface ConsoleLink {
  link: LinkState;
  webmcp: boolean;
  tools: ToolDescriptor[];
  activity: string[];
}

const RECONNECT_MS = [250, 500, 1000, 2000, 4000] as const;

export function useConsoleLink(
  relayUrl: string,
  sessionId: string,
  partnerOrigins: string[],
  ready: boolean,
): ConsoleLink {
  const [link, setLink] = useState<LinkState>("connecting");
  const [tools, setTools] = useState<ToolDescriptor[]>([]);
  const [activity, setActivity] = useState<string[]>([]);
  const webmcp = isWebMcpAvailable();

  const bridge = useRef<WebMcpBridge | null>(null);
  const ws = useRef<WebSocket | null>(null);

  const note = useCallback((line: string) => {
    setActivity((a) => [...a.slice(-60), line]);
  }, []);

  useEffect(() => {
    bridge.current = new WebMcpBridge(partnerOrigins);
  }, [partnerOrigins]);

  useEffect(() => {
    if (!ready || !sessionId) return;
    // Local to this effect invocation. A shared ref would be reset by the next
    // mount, letting the previous socket's close handler start a reconnect
    // nobody owns. See the matching note in the Display's useRelay.
    let disposed = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const send = (msg: ConsoleToServer) => {
      if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
    };

    const connect = () => {
      if (disposed) return;
      const url = `${relayUrl}?origins=${encodeURIComponent(partnerOrigins.join(","))}`;
      const sock = new WebSocket(url);
      ws.current = sock;

      sock.onopen = () => {
        if (disposed) return;
        attempts = 0;
        setLink("open");
        send({ t: "hello", sessionId, client: "console" });
      };

      sock.onmessage = (ev) => {
        void (async () => {
          let msg: ServerToConsole;
          try {
            msg = JSON.parse(String(ev.data)) as ServerToConsole;
          } catch {
            return;
          }
          const b = bridge.current;
          if (!b) return;

          if (msg.t === "discover") {
            try {
              const found = await b.discover();
              setTools(found);
              note(`getTools({fromOrigins}) -> ${found.length} tools`);
              send({ t: "tools", requestId: msg.requestId, tools: found });
            } catch (err) {
              note(errText(err));
              send({ t: "tools", requestId: msg.requestId, tools: [] });
            }
            return;
          }

          if (msg.t === "invoke") {
            const args = (msg.args ?? {}) as Record<string, unknown>;
            note(`executeTool(${msg.toolName}, ${JSON.stringify(args)})`);
            try {
              const value = await b.invoke(msg.origin, msg.toolName, args);
              note(`  -> ${value.length > 120 ? `${value.slice(0, 117)}...` : value}`);
              send({ t: "invoked", requestId: msg.requestId, ok: true, value });
            } catch (err) {
              note(`  -> failed: ${errText(err)}`);
              send({ t: "invoked", requestId: msg.requestId, ok: false, error: errText(err) });
            }
          }
        })();
      };

      sock.onclose = () => {
        if (disposed) return;
        const i = Math.min(attempts, RECONNECT_MS.length - 1);
        attempts += 1;
        setLink(attempts > RECONNECT_MS.length ? "offline" : "reconnecting");
        timer = setTimeout(connect, RECONNECT_MS[i]!);
      };

      sock.onerror = () => sock.close();
    };

    connect();

    // A page adding or removing tools must reach the wearer, so we forward the
    // event rather than polling for changes.
    const off = bridge.current?.onToolsChanged(() => {
      note("ontoolchange fired");
      send({ t: "toolsChanged" });
    });

    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      off?.();
      ws.current?.close();
      ws.current = null;
    };
  }, [relayUrl, sessionId, partnerOrigins, ready, note]);

  return { link, webmcp, tools, activity };
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
