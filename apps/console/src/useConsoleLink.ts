import type {
  AgentReply,
  AgentRequest,
  ConsoleToServer,
  ServerToConsole,
  ToolDescriptor,
} from "@dusky/contracts";
import { CLOSE_SUPERSEDED } from "@dusky/contracts";
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

/**
 * `superseded` is terminal on purpose. Another window claimed this pairing
 * code, and reconnecting would claim it back, which is the fight rather than
 * the recovery. It reads out beside the code in the header.
 */
export type LinkState = "connecting" | "open" | "reconnecting" | "offline" | "superseded";

export interface ConsoleLink {
  link: LinkState;
  webmcp: boolean;
  tools: ToolDescriptor[];
  /**
   * Whether a discovery has finished for the source currently selected.
   *
   * An empty list means two completely different things and a page that cannot
   * tell them apart says the alarming one. Switching source clears the tools
   * and re-discovers, so for the few hundred milliseconds in between the
   * console announced that the site had granted nothing, which is a real
   * failure with a real remedy, about a site that was simply still answering.
   *
   * A zero is not enough on its own either. The FIRST discovery after a switch
   * legitimately returns nothing, because the new site's frame has not
   * registered yet, and `ontoolchange` is what fetches the real answer a moment
   * later. So an empty result has to hold still before it counts.
   */
  discovered: boolean;
  activity: string[];
  /** Whether Dusky's own tools are registered for an agent in this browser. */
  provides: boolean;
}

/**
 * How long an empty tool list has to stand before the console calls it empty.
 *
 * Long enough to cover the frame registering and `ontoolchange` firing, short
 * enough that a site which really has not granted anything is not left looking
 * like it is still loading.
 */
const EMPTY_HOLD_MS = 1500;

const RECONNECT_MS = [250, 500, 1000, 2000, 4000] as const;

/**
 * How long a connection has to last before it counts as having worked.
 *
 * Backoff reset the moment a socket opened, so a connection that opened and
 * died immediately retried at 250ms forever and never escalated.
 */
const STABLE_MS = 5_000;

/** An agent request that never comes back must not hang a tool call forever. */
const AGENT_REPLY_TIMEOUT_MS = 15_000;

/**
 * How long a burst of tool registrations is allowed to settle.
 *
 * Long enough to swallow a site registering its tools one at a time, short
 * enough that a wearer looking at a menu sees a real change almost at once.
 */
const TOOLS_SETTLE_MS = 200;

export function useConsoleLink(
  relayUrl: string,
  sessionId: string,
  partnerOrigins: string[],
  ready: boolean,
  sourceName: string,
): ConsoleLink {
  const [link, setLink] = useState<LinkState>("connecting");
  const [tools, setTools] = useState<ToolDescriptor[]>([]);
  const [discovered, setDiscovered] = useState(false);
  const emptyFor = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /**
   * Record what a discovery came back with.
   *
   * Anything found settles it at once. Nothing found starts a clock instead,
   * because the re-discovery that `ontoolchange` triggers is usually already on
   * its way, and a page that reported a missing grant in that window would be
   * wrong about every source switch.
   */
  const settleDiscovery = useCallback((found: number) => {
    clearTimeout(emptyFor.current);
    if (found > 0) {
      setDiscovered(true);
      return;
    }
    emptyFor.current = setTimeout(() => setDiscovered(true), EMPTY_HOLD_MS);
  }, []);
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
    let openedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Pointing Dusky at a different source re-runs this effect. The previous
    // site's tools are not this site's tools, and leaving them on screen until
    // discovery finishes would show a menu that belongs to somewhere else.
    setTools([]);
    setDiscovered(false);
    clearTimeout(emptyFor.current);

    const connect = () => {
      if (disposed) return;
      // The relay is told which site this console is holding, because it has
      // no way to find out. The label is what a wearer reads in the frame's
      // eyebrow; the origins are what actually decide anything.
      const url =
        `${relayUrl}?origins=${encodeURIComponent(partnerOrigins.join(","))}` +
        `&source=${encodeURIComponent(sourceName)}`;
      const sock = new WebSocket(url);
      ws.current = sock;

      sock.onopen = () => {
        if (disposed) return;
        openedAt = Date.now();
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
              settleDiscovery(found.length);
              note(`getTools({fromOrigins}) -> ${found.length} tools`);
              send({ t: "tools", requestId: msg.requestId, tools: found });
            } catch (err) {
              // The reason used to go only into this panel's activity log,
              // which is on a screen the wearer is not looking at, while the
              // glasses were told the site had nothing to offer.
              const reason = errText(err);
              // Answered, badly. Still an answer: the log and the lens both
              // carry the reason, and the list must stop saying "checking".
              clearTimeout(emptyFor.current);
              setDiscovered(true);
              note(reason);
              send({ t: "tools", requestId: msg.requestId, tools: [], error: reason });
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

      sock.onclose = (ev) => {
        if (disposed) return;

        // Another tab is holding this session. Taking it back would evict them,
        // they would reconnect and evict us, and the wearer's screen would be
        // rebuilt on every exchange for as long as both tabs stayed open.
        if (ev.code === CLOSE_SUPERSEDED) {
          setLink("superseded");
          return;
        }

        if (openedAt !== 0 && Date.now() - openedAt > STABLE_MS) attempts = 0;
        openedAt = 0;

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
    //
    // Coalesced, because registration is one event PER TOOL: a site declaring
    // four of them fires four times in a few milliseconds, and each one made
    // the relay restart the session and re-discover. That produced a run of
    // "0 tools" answers against a page still registering, and, far worse,
    // would reset the wearer's frame four times if a site ever re-registered
    // while somebody was mid-task. One burst is one change.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const off = bridge.current?.onToolsChanged(() => {
      if (settle !== undefined) clearTimeout(settle);
      settle = setTimeout(() => {
        settle = undefined;
        note("ontoolchange settled, re-discovering");
        send({ t: "toolsChanged" });
      }, TOOLS_SETTLE_MS);
    });

    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      if (settle !== undefined) clearTimeout(settle);
      clearTimeout(emptyFor.current);
      off?.();
      ws.current?.close();
      ws.current = null;
    };
  }, [relayUrl, sessionId, partnerOrigins, ready, sourceName, note, send, settleDiscovery]);

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

  return { link, webmcp, tools, discovered, activity, provides };
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
