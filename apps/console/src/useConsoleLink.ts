import type {
  AgentReply,
  AgentRequest,
  ConsoleToServer,
  ServerToConsole,
  ToolDescriptor,
} from "@dusky/contracts";
import { isWebMcpAvailable, registerTools, WebMcpBridge } from "@dusky/webmcp";
import { useCallback, useEffect, useRef, useState } from "react";
import { duskyTools } from "./duskyTools.js";

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
  /** Whether Dusky's own tools are registered for an agent in this browser. */
  provides: boolean;
}

const RECONNECT_MS = [250, 500, 1000, 2000, 4000] as const;

/** An agent request that never comes back must not hang a tool call forever. */
const AGENT_REPLY_TIMEOUT_MS = 15_000;

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

  const [provides, setProvides] = useState(false);
  const bridge = useRef<WebMcpBridge | null>(null);
  const ws = useRef<WebSocket | null>(null);
  /** Agent tool calls waiting on the relay, keyed by request id. */
  const waiting = useRef(new Map<string, (r: AgentReply) => void>());

  const note = useCallback((line: string) => {
    setActivity((a) => [...a.slice(-60), line]);
  }, []);

  useEffect(() => {
    bridge.current = new WebMcpBridge(partnerOrigins);
  }, [partnerOrigins]);

  const send = useCallback((msg: ConsoleToServer) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
  }, []);

  /**
   * Forward an agent's request to the relay and wait for its answer.
   *
   * Note what is NOT sent: a session id. The relay answers for the session
   * this socket said hello as, so a caller cannot reach a session other than
   * the one this page is already paired to.
   */
  const ask = useCallback(
    (request: AgentRequest): Promise<AgentReply> =>
      new Promise((resolve) => {
        if (ws.current?.readyState !== WebSocket.OPEN) {
          resolve({ ok: false, error: "Dusky is not connected to its relay right now." });
          return;
        }
        const requestId = crypto.randomUUID();
        const timer = setTimeout(() => {
          waiting.current.delete(requestId);
          resolve({ ok: false, error: "Dusky did not answer in time." });
        }, AGENT_REPLY_TIMEOUT_MS);
        waiting.current.set(requestId, (r) => {
          clearTimeout(timer);
          resolve(r);
        });
        send({ t: "agent", requestId, request });
      }),
    [send],
  );

  useEffect(() => {
    if (!ready || !sessionId) return;
    // Local to this effect invocation. A shared ref would be reset by the next
    // mount, letting the previous socket's close handler start a reconnect
    // nobody owns. See the matching note in the Display's useRelay.
    let disposed = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

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
          if (msg.t === "agentReply") {
            const settle = waiting.current.get(msg.requestId);
            if (settle) {
              waiting.current.delete(msg.requestId);
              settle(msg.reply);
            }
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
  }, [relayUrl, sessionId, partnerOrigins, ready, note, send]);

  /**
   * Register Dusky's own tools, so an agent in this browser can drive the
   * glasses.
   *
   * `exposedTo` is deliberately omitted. Naming an origin is how a page grants
   * a specific third party access, which is what Verdant Market does for
   * Dusky. Omitting it is the correct default here: these tools are for the
   * agent built into whatever browser the human opened this page in, which is
   * exactly the ChatGPT desktop browser case.
   *
   * The AbortController is created SYNCHRONOUSLY, because registration is
   * async and a disposer that only exists once the promise resolves leaves a
   * window where StrictMode's second pass collides with the first. See the
   * matching note in @dusky/webmcp.
   */
  useEffect(() => {
    if (!ready || !isWebMcpAvailable()) return;
    const lifetime = new AbortController();
    registerTools(duskyTools({ ask, note }), { signal: lifetime.signal })
      .then(() => {
        if (lifetime.signal.aborted) return;
        setProvides(true);
        note("registered Dusky's own 4 tools for this browser's agent");
      })
      .catch((err: unknown) => {
        if (lifetime.signal.aborted) return;
        note(`could not register Dusky's tools: ${errText(err)}`);
      });
    return () => {
      lifetime.abort();
      setProvides(false);
    };
  }, [ready, ask, note]);

  return { link, webmcp, tools, activity, provides };
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
