import type {
  AgentReply,
  AgentRequest,
  ConsoleToServer,
  ServerToConsole,
  SiteRef,
  ToolDescriptor,
} from "@dusky/contracts";
import { CLOSE_SUPERSEDED } from "@dusky/contracts";
import { isWebMcpAvailable, registerTools, WebMcpBridge } from "@dusky/webmcp";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export interface RuntimeAction {
  id: string;
  origin: string;
  toolName: string;
  status: "running" | "completed" | "failed" | "unknown";
}

export interface ConsoleLink {
  link: LinkState;
  webmcp: boolean;
  tools: ToolDescriptor[];
  /**
   * Whether discovery has finished for ONE site, asked one site at a time.
   *
   * An empty list means two completely different things and a page that cannot
   * tell them apart says the alarming one. That was already true of a single
   * source, where a first discovery legitimately returns nothing because the
   * frame has not registered yet and `ontoolchange` fetches the real answer a
   * moment later, so an empty result has to hold still before it counts.
   *
   * Holding several sites makes a single flag actively wrong rather than merely
   * coarse. The sites load independently, so the FIRST one to answer would set
   * a shared flag and every site still loading would be reported as having
   * granted nothing, in the same breath as a site that really had. One answer
   * is not evidence about another origin.
   *
   * So a site is settled once it has contributed a tool, and every site is
   * settled once discovery has been quiet long enough that nothing more is
   * coming. That second half is what keeps a site which genuinely granted
   * nothing from looking like it is still loading forever.
   */
  settled: (origin: string) => boolean;
  /**
   * Why discovery could not run at all, if it could not.
   *
   * "We could not look" and "there was nothing to see" are different facts and
   * only one of them is about the site. The relay learned this distinction when
   * a browser without WebMCP produced "this source declared no usable tools" on
   * a wearer's lens, which is a confident statement about a shop nothing had
   * reached. The console's own list was making the same claim in its own words
   * and now makes neither: with a problem in hand it says it could not read,
   * and says which sites it could not read for, and names no business as
   * having offered anything.
   */
  problem: string | null;
  /** User-meaningful provider invocations, correlated by relay request id. */
  recentActions: RuntimeAction[];
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
  sites: readonly SiteRef[],
  ready: boolean,
): ConsoleLink {
  const [link, setLink] = useState<LinkState>("connecting");
  const [tools, setTools] = useState<ToolDescriptor[]>([]);
  /** Whether discovery has gone quiet, which settles every site at once. */
  const [quiet, setQuiet] = useState(false);
  /** Set when discovery threw, so an empty list is not read as an empty site. */
  const [problem, setProblem] = useState<string | null>(null);
  const emptyFor = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /**
   * Note that a discovery answered, and restart the clock on the rest.
   *
   * Every answer restarts it, not only an empty one. With one site an arrival
   * was the end of the story; with several it is evidence that MORE may still
   * be arriving, because each site registers on its own schedule and each
   * registration triggers another round. Ending the wait on the first answer
   * would settle sites that have not spoken yet.
   */
  const sawDiscovery = useCallback(() => {
    clearTimeout(emptyFor.current);
    setQuiet(false);
    setProblem(null);
    emptyFor.current = setTimeout(() => setQuiet(true), EMPTY_HOLD_MS);
  }, []);

  /**
   * Discovery failed outright.
   *
   * That is an answer, so the list must stop saying "checking". It is NOT
   * evidence about any site, so the reason is kept: with one in hand the list
   * reports that it could not look, rather than reporting on somebody's page.
   */
  const gaveUp = useCallback((reason: string) => {
    clearTimeout(emptyFor.current);
    setQuiet(true);
    setProblem(reason);
  }, []);
  const [recentActions, setRecentActions] = useState<RuntimeAction[]>([]);
  const webmcp = isWebMcpAvailable();

  const [provides, setProvides] = useState(false);
  const bridge = useRef<WebMcpBridge | null>(null);
  const ws = useRef<WebSocket | null>(null);
  /** Agent tool calls waiting on the relay, keyed by request id. */
  const waiting = useRef(new Map<string, (r: AgentReply) => void>());

  const origins = useMemo(() => sites.map((s) => s.origin), [sites]);

  useEffect(() => {
    bridge.current = new WebMcpBridge(origins);
  }, [origins]);

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
    const invocations = new Map<string, AbortController>();

    // A different set of sites re-runs this effect. The previous set's tools
    // are not this set's tools, and leaving them on screen until discovery
    // finishes would show a menu that belongs to somewhere else.
    setTools([]);
    setQuiet(false);
    setProblem(null);
    setRecentActions([]);
    clearTimeout(emptyFor.current);

    const connect = () => {
      if (disposed) return;
      // The relay is told which sites this console is holding, because it has
      // no way to find out. Names are what a wearer reads in a frame's eyebrow;
      // origins are what actually decide anything.
      //
      // One parameter carrying both, rather than two lists that have to stay
      // the same length and in the same order. A name may contain any
      // character a person can type, including the separators a flat list would
      // need, so JSON is what makes an arbitrary name safe to carry.
      const url = `${relayUrl}?sites=${encodeURIComponent(JSON.stringify(sites))}`;
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
          const isCurrent = () => !disposed && ws.current === sock;
          if (!isCurrent()) return;
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
          if (msg.t === "cancelInvoke") {
            invocations.get(msg.requestId)?.abort();
            setRecentActions((current) =>
              current.map((action) =>
                action.id === msg.requestId && action.status === "running"
                  ? { ...action, status: "unknown" }
                  : action,
              ),
            );
            return;
          }

          const b = bridge.current;
          if (!b) return;

          if (msg.t === "discover") {
            try {
              const found = await b.discover();
              if (!isCurrent()) return;
              setTools(found);
              sawDiscovery();
              send({ t: "tools", requestId: msg.requestId, tools: found });
            } catch (err) {
              if (!isCurrent()) return;
              // Discovery failures belong in the provider state, not in the
              // action log. The wearer still needs the same reason on the
              // glasses instead of an invented empty-site answer.
              const reason = errText(err);
              // Answered, badly. Still an answer: the provider state and the
              // lens both carry the reason, and the list must stop checking.
              gaveUp(reason);
              send({ t: "tools", requestId: msg.requestId, tools: [], error: reason });
            }
            return;
          }

          if (msg.t === "invoke") {
            const args = (msg.args ?? {}) as Record<string, unknown>;
            const controller = new AbortController();
            invocations.set(msg.requestId, controller);
            setRecentActions((current) => [
              ...current.filter((action) => action.id !== msg.requestId).slice(-19),
              {
                id: msg.requestId,
                origin: msg.origin,
                toolName: msg.toolName,
                status: "running",
              },
            ]);
            try {
              const value = await b.invoke(
                msg.origin,
                msg.toolName,
                args,
                msg.expectedTool,
                controller.signal,
              );
              if (!isCurrent()) return;
              setRecentActions((current) =>
                current.map((action) =>
                  action.id === msg.requestId && action.status === "running"
                    ? { ...action, status: "completed" }
                    : action,
                ),
              );
              send({ t: "invoked", requestId: msg.requestId, ok: true, value });
            } catch (err) {
              if (!isCurrent()) return;
              setRecentActions((current) =>
                current.map((action) =>
                  action.id === msg.requestId && action.status === "running"
                    ? { ...action, status: "failed" }
                    : action,
                ),
              );
              send({ t: "invoked", requestId: msg.requestId, ok: false, error: errText(err) });
            } finally {
              invocations.delete(msg.requestId);
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
        send({ t: "toolsChanged" });
      }, TOOLS_SETTLE_MS);
    });

    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      if (settle !== undefined) clearTimeout(settle);
      clearTimeout(emptyFor.current);
      for (const controller of invocations.values()) controller.abort();
      invocations.clear();
      off?.();
      ws.current?.close();
      ws.current = null;
    };
  }, [relayUrl, sessionId, sites, ready, send, sawDiscovery, gaveUp]);

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
    registerTools(duskyTools({ ask }), { signal: lifetime.signal })
      .then(() => {
        if (lifetime.signal.aborted) return;
        setProvides(true);
      })
      .catch(() => {
        if (lifetime.signal.aborted) return;
        setProvides(false);
      });
    return () => {
      lifetime.abort();
      setProvides(false);
    };
  }, [ready, ask]);

  /**
   * A site has answered for itself, or discovery has stopped answering at all.
   *
   * Asked per origin rather than once for the page, because one site arriving
   * says nothing about another. Anything that has offered a tool has plainly
   * answered; everything else waits for the quiet, which is the only evidence
   * available that a site with nothing to show has finished having nothing to
   * show.
   */
  const settled = useCallback(
    (origin: string) => quiet || tools.some((t) => t.origin === origin),
    [quiet, tools],
  );

  return { link, webmcp, tools, settled, problem, recentActions, provides };
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
