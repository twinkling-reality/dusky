import { gate } from "@dusky/policy";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router";
import { PairingConnections } from "./PairingConnections.js";
import { RequirementsButton, RequirementsPanel, useRequirements } from "./Requirements.js";
import { SiteHeader } from "./SiteHeader.js";
import header from "./SiteHeader.module.css";
import { codeProblem, isCode, mintCode, type PairMode } from "./session.js";
import { originOf, type Source, sitesFromQuery } from "./sources.js";
import { TopologyConnections } from "./TopologyConnections.js";
import { useConsoleLink } from "./useConsoleLink.js";
import styles from "./Workspace.module.css";

/**
 * Everything in one tab: what the wearer sees, the site the tools live in, and
 * every protocol call as it happens.
 *
 * This page is not a viewer. It is where the tools actually run, in the
 * partner site's own document, in this browser's own session, which is why it
 * has to stay open and why Dusky never holds anybody's credentials. That is
 * the security model rather than a limitation, so the page says so instead of
 * letting someone discover it by closing the tab.
 */

const RELAY_URL = import.meta.env["VITE_RELAY_URL"] ?? "ws://localhost:7900/console";
const DISPLAY_URL = import.meta.env["VITE_DISPLAY_URL"] ?? "http://localhost:7802";

/**
 * What you are looking at, on the same terms as the requirements dropdown.
 *
 * This page carried a paragraph about the security model above the fold and a
 * caption under every heading, and all of it was cut because none of it was
 * what a stranger needed. Cutting it left nothing at all: four labelled boxes
 * and no way to find out what any of them is.
 *
 * A dropdown costs nothing to anybody who does not open it, which is what makes
 * it the right home for text that only some people need. The last line is the
 * one that matters: it says what to press.
 */
function WhatIsThis({
  displayLabel,
  displayCopy,
  heading,
  sites,
  onClose,
}: {
  displayLabel: string;
  displayCopy: string;
  heading: string;
  sites: readonly Source[];
  onClose: () => void;
}) {
  const box = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
      const el = box.current;
      const t = e.target as Node | null;
      if (!el || !t) return;
      if (el.contains(t) || (t instanceof Element && t.closest("[aria-controls=what]"))) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  return (
    <section id="what" ref={box} className={styles.what} data-squircle="" aria-label="What is this">
      <dl className={styles.whatList}>
        <div>
          <dt>{displayLabel}</dt>
          <dd>{displayCopy}</dd>
        </div>
        <div>
          <dt>{heading}</dt>
          <dd>
            {sites.length > 1
              ? "Provider pages exposing WebMCP tools authorized for this console. Dusky builds the Display flow from their combined registry. A moving path means an origin has exposed tools; it is not a per-call trace. The bundled pages are test fixtures."
              : "A provider page exposing WebMCP tools authorized for this console. Dusky builds the Display flow from its live registry. A moving path means the origin has exposed tools; it is not a per-call trace. Bundled pages are test fixtures."}
          </dd>
        </div>
        <div>
          <dt>Available actions</dt>
          <dd>
            Things each provider page authorized Dusky to offer now. “Wearer confirms” marks an
            action that needs approval before it runs.
          </dd>
        </div>
        <div>
          <dt>Runtime activity</dt>
          <dd>
            Session-wide discovery, relay, agent, and invocation evidence from the browser runtime.
            Rows are not assigned to a provider unless the runtime supplied that identity.
          </dd>
        </div>
      </dl>
      <p className={styles.whatDo}>
        Choose an action on the Display. Its provider tool runs here, in the browser.
      </p>
    </section>
  );
}

type ActivityKind = "discovery" | "invocation" | "result" | "agent" | "registry" | "error";

interface ActivityEvent {
  id?: string;
  kind: ActivityKind;
  label: string;
  subject: string;
  detail: string;
}

function activityEvent(line: string): ActivityEvent {
  const discovery = line.match(/^getTools\(\{fromOrigins\}\) -> (\d+) tools from (\d+) of (\d+)$/);
  if (discovery) {
    return {
      kind: "discovery",
      label: "Discovery",
      subject: `${discovery[1]} tools available`,
      detail: `${discovery[2]} of ${discovery[3]} provider origins answered`,
    };
  }

  const invocation = line.match(/^executeTool\(([^,]+),\s*(.*)\)$/);
  if (invocation) {
    return {
      kind: "invocation",
      label: "Tool call",
      subject: invocation[1] ?? "Unknown tool",
      detail: invocation[2] === "{}" ? "No arguments" : (invocation[2] ?? ""),
    };
  }

  if (line.startsWith("  -> failed:")) {
    return {
      kind: "error",
      label: "Failure",
      subject: "Provider invocation",
      detail: line.slice("  -> failed:".length).trim(),
    };
  }

  if (line.startsWith("  ->")) {
    return {
      kind: "result",
      label: "Result",
      subject: "Provider returned",
      detail: line.slice("  ->".length).trim(),
    };
  }

  const agentRequest = line.match(/^agent -> ([^(]+)\((.*)\)$/);
  if (agentRequest) {
    return {
      kind: "agent",
      label: "Agent",
      subject: agentRequest[1] ?? "Request",
      detail: agentRequest[2] || "No arguments",
    };
  }

  if (line.startsWith("  <-")) {
    const detail = line.slice("  <-".length).trim();
    return {
      kind: detail.startsWith("refused") ? "error" : "result",
      label: detail.startsWith("refused") ? "Refused" : "Agent result",
      subject: "Browser agent",
      detail,
    };
  }

  if (line === "ontoolchange settled, re-discovering") {
    return {
      kind: "registry",
      label: "Registry",
      subject: "Tools changed",
      detail: "Re-reading authorized provider actions",
    };
  }

  if (line.startsWith("registered Dusky's own")) {
    return {
      kind: "registry",
      label: "Registry",
      subject: "Agent tools ready",
      detail: line,
    };
  }

  if (/failed|could not|not enabled|error/i.test(line)) {
    return { kind: "error", label: "Error", subject: "Browser runtime", detail: line };
  }

  return { kind: "registry", label: "Runtime", subject: "Session event", detail: line };
}

function TechnicalLog({
  activity,
  open,
  onToggle,
  onClose,
}: {
  activity: readonly string[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onDown = (event: PointerEvent) => {
      const element = box.current;
      const target = event.target as Node | null;
      if (!element || !target) return;
      if (
        element.contains(target) ||
        (target instanceof Element && target.closest("[aria-controls=technical-log-panel]"))
      ) {
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open, onClose]);

  const occurrences = new Map<string, number>();
  const events = activity
    .map((line) => {
      const occurrence = (occurrences.get(line) ?? 0) + 1;
      occurrences.set(line, occurrence);
      return { ...activityEvent(line), id: `${line}:${occurrence}` };
    })
    .reverse();

  return (
    <section
      id="technical-log"
      ref={box}
      className={styles.technicalLog}
      data-open={open ? "" : undefined}
      data-topology-node=""
      data-topology-focus="activity"
      aria-label="Runtime activity"
    >
      <span className={styles.activityPort} data-log-end="activity" aria-hidden="true" />
      <button
        type="button"
        className={styles.activitySummary}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="technical-log-panel"
        aria-label={`Technical log, ${activity.length} ${activity.length === 1 ? "event" : "events"}`}
      >
        <span>Runtime activity</span>
        <strong>{activity.length}</strong>
      </button>

      {open && (
        <section
          id="technical-log-panel"
          className={styles.technicalLogPanel}
          aria-label="Technical log"
        >
          <header className={styles.technicalLogHead}>
            <div>
              <h2>Technical log</h2>
              <p>Newest first · session-wide browser evidence</p>
            </div>
            <div>
              <span>{activity.length} events</span>
              <button type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </header>

          <div className={styles.technicalLogColumns} aria-hidden="true">
            <span>Event</span>
            <span>Entity</span>
            <span>Detail</span>
          </div>
          <ol className={styles.technicalLogEvents}>
            {events.map((event) => (
              <li key={event.id} data-kind={event.kind}>
                <span className={styles.eventLabel}>{event.label}</span>
                <strong>{event.subject}</strong>
                <span className={styles.eventDetail}>{event.detail}</span>
              </li>
            ))}
            {events.length === 0 && <li className={styles.noEvents}>No runtime events yet.</li>}
          </ol>
        </section>
      )}
    </section>
  );
}

export function Workspace() {
  const probe = useRequirements();
  const [reqOpen, setReqOpen] = useState(false);
  const [whatOpen, setWhatOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [canvasLayout, setCanvasLayout] = useState<"horizontal" | "vertical">("horizontal");
  const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
  const [canvasPanning, setCanvasPanning] = useState(false);
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const canvasDrag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const nodeDrag = useRef<{
    id: string;
    pointerId: number;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [params, setParams] = useSearchParams();
  /*
   * Every site at once, which is the whole product.
   *
   * This was one source wrapped in an array, and that array was the only thing
   * holding Dusky to one business at a time: `getTools({ fromOrigins })` has
   * always taken a list, tool identity has always been (origin, name), and the
   * menu has always ordered a mixed registry. Nothing downstream changed to
   * make this work.
   *
   * `?source=` still narrows it, and nothing on the page offers that. See the
   * note on `sitesFromQuery`.
   */
  const sites = useMemo(() => sitesFromQuery(params.toString()), [params]);

  /*
   * What the relay is told, and it must be a STABLE array.
   *
   * The connect effect depends on this, so rebuilding it every render would
   * reopen the socket every render. `sites` is memoised on the search string,
   * so this is too.
   */
  const held = useMemo(() => sites.map((s) => ({ origin: originOf(s), name: s.name })), [sites]);

  /*
   * A code in the URL means somebody already started a session. `?start=1`
   * means they have not, and want to: it is what the front door's one button
   * links to, so a visitor lands on a running Dusky rather than on a page with
   * another button in the middle of it.
   *
   * Minted in the initialiser rather than in an effect. An effect that mints
   * runs twice under StrictMode and the second code silently replaces the
   * first, which is a session nobody is connected to. The initialiser settles
   * on one value for the mounted component and the effect below only ever
   * copies it into the URL.
   */
  const fromUrl = params.get("session");
  const [session, setSession] = useState<string | null>(() =>
    fromUrl && isCode(fromUrl)
      ? fromUrl.toUpperCase()
      : params.get("start") === "1"
        ? mintCode()
        : null,
  );
  // `?mode=glasses` says the code came off a lens, so no panel is embedded.
  const [mode, setMode] = useState<PairMode>(
    params.get("mode") === "glasses" ? "glasses" : "embedded",
  );
  const [typed, setTyped] = useState("");
  const pairProblem = codeProblem(typed);
  const pairReady = isCode(typed);
  const pairInvalid = pairProblem?.startsWith("Codes are letters only") ?? false;
  const pairLeftProgress = Math.min(typed.length / 3, 1);
  const pairRightProgress = Math.max(Math.min((typed.length - 3) / 3, 1), 0);

  const link = useConsoleLink(RELAY_URL, session ?? "", held, session !== null);

  /**
   * What to call the box holding the sites, and what to call a row's site.
   *
   * One site keeps its own name as the heading, which is what this page looked
   * like when it could only hold one, and is what `?source=` still produces.
   * Several of them get a plain label, because no business name is true above a
   * box containing another business.
   */
  const heading = sites.length === 1 ? (sites[0] as Source).name : "Provider pages";
  const displayLabel = mode === "embedded" ? "Display preview" : "Ray-Ban Display";
  const displayCopy =
    mode === "embedded"
      ? "The same 600 × 600 Display app, embedded here for the browser demo."
      : "The current screen on the paired glasses. Wearer input returns through the relay; tools still run in this browser.";
  const topologyOrigins = useMemo(() => sites.map(originOf), [sites]);
  const connectedOrigins = useMemo(
    () => new Set(link.tools.map((tool) => tool.origin)),
    [link.tools],
  );
  const linkLabel =
    link.link === "open"
      ? "Relay connected"
      : link.link === "superseded"
        ? "Session moved"
        : link.link === "reconnecting"
          ? "Reconnecting"
          : link.link === "offline"
            ? "Relay offline"
            : "Connecting";

  // Arrow keys reach the panel only when the frame has focus, and a judge who
  // has to discover that is a judge who thinks the demo is broken.
  const lens = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    if (mode !== "embedded" || !session) return;
    const t = setTimeout(() => {
      /*
       * Not if the panel already has it. Focus inside a frame makes the frame
       * itself the active element out here, so focusing it again is a no-op
       * for the page and a BLUR for whatever is focused within it. With the
       * session starting on arrival rather than on a click, this timer now
       * fires 600ms after load, which is comfortably inside the time it takes
       * to open the composer and start typing: it committed a half-typed value
       * and advanced the frame out from under the wearer.
       */
      if (document.activeElement === lens.current) return;
      lens.current?.focus();
    }, 600);
    return () => clearTimeout(t);
  }, [mode, session]);

  /*
   * One place that writes the session and its Display surface into the URL,
   * whatever started it: the browser demo, a pasted code, or `?start=1`.
   *
   * Glasses mode has to survive a reload. Without `mode=glasses`, this console
   * would come back as embedded and mount a second Display on the same code,
   * which would disconnect the physical one. Embedded is the default and does
   * not need a query value.
   */
  useEffect(() => {
    if (!session) return;
    const modeMatches = mode === "glasses" ? params.get("mode") === "glasses" : !params.has("mode");
    if (params.get("session") === session && !params.has("start") && modeMatches) return;
    const next = new URLSearchParams(params);
    next.set("session", session);
    next.delete("start");
    if (mode === "glasses") next.set("mode", "glasses");
    else next.delete("mode");
    setParams(next, { replace: true });
  }, [session, mode, params, setParams]);

  /*
   * Back to the pairing page, which is the only place hardware setup is explained.
   *
   * Somebody who owns glasses arrives here through the front door's one button,
   * which mints a session and embeds the panel, and there was then no route to
   * the pairing form at all: it lives on the page that `?start=1` skips. The
   * code itself is deliberately NOT printed here, because the code a wearer
   * types is the one on their own lens, not the one this page minted.
   */
  const unpair = () => {
    setSession(null);
    setMode("embedded");
    const next = new URLSearchParams(params);
    next.delete("session");
    next.delete("start");
    next.delete("mode");
    setParams(next, { replace: true });
  };

  const start = () => {
    setMode("embedded");
    setSession(mintCode());
  };

  const pairGlasses = (code: string) => {
    // No embedded panel in this mode: the relay allows one Display per
    // session, so a second one would close the wearer's.
    setMode("glasses");
    setSession(code.toUpperCase());
  };

  const panCanvasStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!window.matchMedia("(min-width: 841px)").matches) return;
    const target = event.target as Element;
    if (target.closest("[data-topology-node], button, a, input, iframe")) return;
    canvasDrag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: canvasPan.x,
      panY: canvasPan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setCanvasPanning(true);
  };

  const panCanvasMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = canvasDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setCanvasPan({
      x: drag.panX + event.clientX - drag.x,
      y: drag.panY + event.clientY - drag.y,
    });
  };

  const panCanvasEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (canvasDrag.current?.pointerId !== event.pointerId) return;
    canvasDrag.current = null;
    setCanvasPanning(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const moveNodeStart = (id: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (!window.matchMedia("(min-width: 841px)").matches) return;
    const target = event.target as Element;
    if (target.closest("iframe, button, a, input, textarea, select")) return;
    const offset = nodeOffsets[id] ?? { x: 0, y: 0 };
    nodeDrag.current = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    };
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingNode(id);
  };

  const moveNode = (id: string, event: ReactPointerEvent<HTMLElement>) => {
    const drag = nodeDrag.current;
    if (!drag || drag.id !== id || drag.pointerId !== event.pointerId) return;
    setNodeOffsets((current) => ({
      ...current,
      [id]: {
        x: drag.offsetX + event.clientX - drag.x,
        y: drag.offsetY + event.clientY - drag.y,
      },
    }));
  };

  const moveNodeEnd = (id: string, event: ReactPointerEvent<HTMLElement>) => {
    const drag = nodeDrag.current;
    if (!drag || drag.id !== id || drag.pointerId !== event.pointerId) return;
    nodeDrag.current = null;
    setDraggingNode(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const nodeStyle = (id: string) => {
    const offset = nodeOffsets[id] ?? { x: 0, y: 0 };
    return {
      "--node-drag-x": `${offset.x}px`,
      "--node-drag-y": `${offset.y}px`,
    } as CSSProperties;
  };

  const hasMovedNodes = Object.values(nodeOffsets).some(
    (offset) => offset.x !== 0 || offset.y !== 0,
  );

  const centerTopology = () => {
    setCanvasPan({ x: 0, y: 0 });
    setNodeOffsets({});
  };

  const changeCanvasLayout = () => {
    setCanvasLayout((current) => (current === "horizontal" ? "vertical" : "horizontal"));
    centerTopology();
  };

  return (
    <>
      <SiteHeader>
        {/*
          The same control the front door uses, rather than a warning banner of
          this page's own.

          There were three copies of "WebMCP is not enabled": a banner here, the
          error frame on the lens, and the activity log. The lens and the log
          are both reporting a real failure and have to say it. This one was the
          only one that was ours to delete, and the component that says it
          properly already existed.
        */}
        {/*
          The way back to pairing, in the header with the other ways out.

          It sat over the grid in a row of its own, beside two source buttons
          for choosing which single site Dusky held. Those are gone with the
          restriction they controlled: holding every site at once means a
          control for choosing one of them is a control for using less of the
          product, and it would have to be labelled "show me fewer of the things
          you can do".

          That left one link alone on a row costing the page fifty pixels it no
          longer has, because three site frames and eleven actions need the height.
          It was never a control over the content anyway. It is the way to a
          different mode, which is what the header is for.
        */}
        {session && mode === "embedded" && (
          <button type="button" className={styles.pairLink} onClick={unpair}>
            Use Ray-Ban Display
          </button>
        )}
        {!session && (
          <button type="button" className={styles.pairLink} onClick={start}>
            Open browser demo
          </button>
        )}
        {session && (
          <div className={styles.reqAnchor}>
            <button
              type="button"
              className={styles.reqBtn}
              onClick={() => {
                setWhatOpen((value) => !value);
                setLogOpen(false);
              }}
              aria-expanded={whatOpen}
              aria-controls="what"
            >
              What is this?
            </button>
            {whatOpen && (
              <WhatIsThis
                displayLabel={displayLabel}
                displayCopy={displayCopy}
                heading={heading}
                sites={sites}
                onClose={() => setWhatOpen(false)}
              />
            )}
          </div>
        )}
        <div className={styles.reqAnchor}>
          <RequirementsButton
            probe={probe}
            open={reqOpen}
            onToggle={() => setReqOpen((v) => !v)}
            className={styles.reqBtn}
          />
          {reqOpen && <RequirementsPanel probe={probe} onClose={() => setReqOpen(false)} />}
        </div>
        <Link className={header.link} to="/" viewTransition>
          Home
        </Link>
      </SiteHeader>

      <div
        className={`${styles.page} ${!session ? styles.startPage : styles.activePage}`}
        data-active={session ? "" : undefined}
        data-motion-route="workspace"
      >
        {!session ? (
          <section
            className={styles.startStage}
            data-motion-item=""
            data-motion-order="1"
            data-pair-ready={pairReady ? "" : undefined}
            aria-labelledby="pair-title"
          >
            <div className={styles.startCopy}>
              <p className={styles.startEyebrow}>Pairing path</p>
              <h1 id="pair-title" className={styles.h1}>
                Connect your display.
              </h1>
              <p id="pair-instruction" className={styles.startLede}>
                Enter the six-letter code shown on your lens.
              </p>
            </div>

            <div
              className={styles.pairGraph}
              data-testid="pairing-graph"
              data-ready={pairReady ? "" : undefined}
              data-invalid={pairInvalid ? "" : undefined}
            >
              <PairingConnections
                className={styles.pairGraphConnections}
                leftProgress={pairLeftProgress}
                rightProgress={pairRightProgress}
                ready={pairReady}
                invalid={pairInvalid}
              />

              <div className={styles.pairEndpoint} data-side="browser" data-pair-node="">
                <span className={styles.pairPort} data-pair-anchor="browser" aria-hidden="true" />
                <span className={styles.pairEndpointKicker}>Browser</span>
                <strong>This tab</strong>
                <span className={styles.pairEndpointState}>Ready</span>
              </div>

              <form
                className={styles.pair}
                data-pair-node=""
                onSubmit={(e) => {
                  e.preventDefault();
                  if (pairReady) pairGlasses(typed);
                }}
              >
                <span
                  className={styles.pairCodePort}
                  data-side="in"
                  data-pair-anchor="code-in"
                  aria-hidden="true"
                />
                <span
                  className={styles.pairCodePort}
                  data-side="out"
                  data-pair-anchor="code-out"
                  aria-hidden="true"
                />
                <label className={styles.label} htmlFor="code">
                  Code from lens
                </label>
                <input
                  id="code"
                  className={styles.input}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value.toUpperCase())}
                  placeholder="ABCDEF"
                  maxLength={6}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Six-letter pairing code"
                  aria-describedby="pair-instruction code-help"
                  aria-invalid={pairInvalid || undefined}
                />
                <p
                  id="code-help"
                  className={styles.pairHelp}
                  data-error={pairInvalid ? "" : undefined}
                  aria-live="polite"
                >
                  {pairProblem ?? (pairReady ? "Code ready." : "Six letters.")}
                </p>
                <button className={styles.pairButton} type="submit" disabled={!pairReady}>
                  Connect display
                  <span aria-hidden="true">&rarr;</span>
                </button>
              </form>

              <div className={styles.pairEndpoint} data-side="display" data-pair-node="">
                <span className={styles.pairPort} data-pair-anchor="display" aria-hidden="true" />
                <span className={styles.pairEndpointKicker}>Ray-Ban</span>
                <strong>Display</strong>
                <span className={styles.pairEndpointState} aria-live="polite">
                  {pairReady ? "Code ready" : "Waiting for code"}
                </span>
              </div>
            </div>
          </section>
        ) : (
          <div
            className={styles.topologyCanvas}
            data-testid="topology-canvas"
            data-layout={canvasLayout}
            data-panning={canvasPanning ? "" : undefined}
            data-node-dragging={draggingNode ? "" : undefined}
            data-motion-item=""
            data-motion-order="1"
            onPointerDown={panCanvasStart}
            onPointerMove={panCanvasMove}
            onPointerUp={panCanvasEnd}
            onPointerCancel={panCanvasEnd}
          >
            <div className={styles.canvasMeta} data-motion-item="" data-motion-order="1">
              <div>
                <p className={styles.canvasEyebrow}>
                  {mode === "embedded" ? "Browser demo" : "Glasses session"}
                </p>
                <h1 className={styles.canvasTitle}>Authorized WebMCP paths</h1>
                {link.link !== "open" && (
                  <p className={styles.canvasProblem} role="status">
                    {linkLabel}
                  </p>
                )}
              </div>
            </div>

            <div className={styles.canvasControls} data-motion-item="" data-motion-order="2">
              <button
                type="button"
                aria-label={`Flow: ${canvasLayout === "horizontal" ? "left to right" : "top to bottom"}`}
                title={`Flow: ${canvasLayout === "horizontal" ? "left to right" : "top to bottom"}`}
                onClick={changeCanvasLayout}
              >
                <span className={styles.layoutGlyph} aria-hidden="true">
                  {canvasLayout === "horizontal" ? "↔" : "↕"}
                </span>
                <span>{canvasLayout === "horizontal" ? "Left to right" : "Top to bottom"}</span>
              </button>
              {(canvasPan.x !== 0 || canvasPan.y !== 0 || hasMovedNodes) && (
                <button
                  type="button"
                  aria-label="Center"
                  title="Center topology"
                  onClick={centerTopology}
                >
                  <span className={styles.layoutGlyph} aria-hidden="true">
                    ⌾
                  </span>
                  <span>Center</span>
                </button>
              )}
            </div>

            <div
              className={styles.graphPlane}
              style={
                {
                  "--canvas-pan-x": `${canvasPan.x}px`,
                  "--canvas-pan-y": `${canvasPan.y}px`,
                } as CSSProperties
              }
            >
              <TopologyConnections
                origins={topologyOrigins}
                connectedOrigins={connectedOrigins}
                runtimeConnected={link.link === "open"}
                activityCount={link.activity.length}
                viewKey={canvasLayout}
                className={styles.topologyEdges}
              />

              <div className={styles.graphNodes}>
                <section
                  className={styles.displayGraphNode}
                  data-mode={mode}
                  data-topology-node=""
                  data-node-id="display"
                  data-node-dragging={draggingNode === "display" ? "" : undefined}
                  data-topology-focus="display"
                  data-motion-item=""
                  data-motion-order="2"
                  style={nodeStyle("display")}
                  onPointerDown={(event) => moveNodeStart("display", event)}
                  onPointerMove={(event) => moveNode("display", event)}
                  onPointerUp={(event) => moveNodeEnd("display", event)}
                  onPointerCancel={(event) => moveNodeEnd("display", event)}
                >
                  <h2 className={styles.nodePill}>
                    <span>{displayLabel}</span>
                    <span
                      className={styles.nodeState}
                      data-live={link.link === "open" ? "" : undefined}
                    >
                      {link.link === "open" ? "live" : linkLabel}
                    </span>
                  </h2>

                  <span
                    className={styles.displayPort}
                    data-runtime-end="display"
                    aria-hidden="true"
                  />

                  {link.link === "superseded" && (
                    <p className={styles.sessionNotice} role="status">
                      <strong>Another window took over this session.</strong> Pair again to make
                      this window live.
                    </p>
                  )}

                  {mode === "embedded" ? (
                    <div className={styles.stage}>
                      <iframe
                        ref={lens}
                        className={styles.lens}
                        title="Dusky on the glasses"
                        src={`${DISPLAY_URL}/?session=${session}`}
                      />
                    </div>
                  ) : (
                    <div className={styles.glassesNodeCopy}>
                      <p>Ray-Ban Display paired</p>
                      <strong>{session}</strong>
                      <span>
                        The screen stays on the glasses. Provider tools continue to run in this
                        browser.
                      </span>
                    </div>
                  )}
                </section>

                <section
                  className={styles.browserRuntimeColumn}
                  data-topology-node=""
                  data-node-id="runtime"
                  data-node-dragging={draggingNode === "runtime" ? "" : undefined}
                  data-topology-focus="runtime"
                  data-motion-item=""
                  data-motion-order="3"
                  style={nodeStyle("runtime")}
                  onPointerDown={(event) => moveNodeStart("runtime", event)}
                  onPointerMove={(event) => moveNode("runtime", event)}
                  onPointerUp={(event) => moveNodeEnd("runtime", event)}
                  onPointerCancel={(event) => moveNodeEnd("runtime", event)}
                >
                  <div className={styles.browserRuntimeNode}>
                    <p>Browser</p>
                    <h2>Runtime</h2>
                    <span>
                      {link.tools.length} {link.tools.length === 1 ? "action" : "actions"}
                    </span>
                    <span
                      className={styles.runtimePort}
                      data-side="in"
                      data-runtime-end="browser"
                      aria-hidden="true"
                    />
                    <span
                      className={styles.runtimePort}
                      data-side="out"
                      data-provider-end="runtime"
                      aria-hidden="true"
                    />
                    <span
                      className={styles.runtimeLogPort}
                      data-log-end="runtime"
                      aria-hidden="true"
                    />
                  </div>

                  <TechnicalLog
                    activity={link.activity}
                    open={logOpen}
                    onToggle={() => {
                      setLogOpen((value) => !value);
                      setWhatOpen(false);
                    }}
                    onClose={() => setLogOpen(false)}
                  />
                </section>

                <section
                  className={styles.providerActionField}
                  data-testid="actions"
                  aria-label="Proof provider pages and their available actions"
                >
                  <p className={styles.providerClusterLabel}>
                    Proof providers · live browser pages
                  </p>
                  {sites.map((site, siteIndex) => {
                    const origin = originOf(site);
                    const available = link.tools.filter((tool) => tool.origin === origin);
                    const settled = link.settled(origin);
                    return (
                      <div
                        key={site.id}
                        className={styles.providerActionPair}
                        data-topology-focus={`provider:${origin}`}
                        data-motion-item=""
                        data-motion-order={String(siteIndex + 4)}
                      >
                        <figure
                          className={styles.providerNode}
                          data-topology-node=""
                          data-node-id={`provider:${origin}`}
                          data-node-dragging={
                            draggingNode === `provider:${origin}` ? "" : undefined
                          }
                          style={nodeStyle(`provider:${origin}`)}
                          onPointerDown={(event) => moveNodeStart(`provider:${origin}`, event)}
                          onPointerMove={(event) => moveNode(`provider:${origin}`, event)}
                          onPointerUp={(event) => moveNodeEnd(`provider:${origin}`, event)}
                          onPointerCancel={(event) => moveNodeEnd(`provider:${origin}`, event)}
                        >
                          <figcaption className={styles.nodePill}>
                            <span>{site.name}</span>
                          </figcaption>
                          <span
                            className={styles.providerPort}
                            data-provider-origin={origin}
                            aria-hidden="true"
                          />
                          <span
                            className={styles.providerActionPort}
                            data-action-origin={origin}
                            data-action-end="provider"
                            aria-hidden="true"
                          />
                          <iframe
                            className={styles.frame}
                            title={site.name}
                            src={site.previewUrl ?? site.url}
                            allow="tools"
                          />
                          <div className={styles.nodeFooter}>
                            <span>{origin}</span>
                            <span>
                              {available.length > 0
                                ? `${available.length} available`
                                : settled
                                  ? "no actions"
                                  : "discovering"}
                            </span>
                          </div>
                        </figure>

                        <article
                          className={styles.actionNode}
                          aria-label={`${site.name} actions`}
                          data-topology-node=""
                          data-node-id={`actions:${origin}`}
                          data-node-dragging={draggingNode === `actions:${origin}` ? "" : undefined}
                          style={nodeStyle(`actions:${origin}`)}
                          onPointerDown={(event) => moveNodeStart(`actions:${origin}`, event)}
                          onPointerMove={(event) => moveNode(`actions:${origin}`, event)}
                          onPointerUp={(event) => moveNodeEnd(`actions:${origin}`, event)}
                          onPointerCancel={(event) => moveNodeEnd(`actions:${origin}`, event)}
                        >
                          <span
                            className={styles.actionPort}
                            data-action-origin={origin}
                            data-action-end="actions"
                            aria-hidden="true"
                          />
                          <h2 className={styles.actionCountLabel}>
                            {available.length} {available.length === 1 ? "action" : "actions"}
                          </h2>
                          <ul className={`${styles.actionList} ${styles.actionListWithCount}`}>
                            {available.map((tool, toolIndex) => {
                              const decision = gate(tool);
                              return (
                                <li
                                  key={`${tool.origin}/${tool.name}`}
                                  data-motion-item=""
                                  data-motion-kind="action"
                                  data-motion-order={String(Math.min(toolIndex + 1, 8))}
                                >
                                  <span className={styles.actionName}>
                                    {tool.title ?? tool.name}
                                  </span>
                                  <span
                                    className={styles.actionApproval}
                                    data-confirm={decision.requiresConfirmation ? "" : undefined}
                                    title={decision.reason}
                                  >
                                    {decision.requiresConfirmation
                                      ? "wearer confirms"
                                      : "runs directly"}
                                  </span>
                                </li>
                              );
                            })}
                            {available.length === 0 && (
                              <li className={styles.actionEmpty}>
                                {link.problem
                                  ? "Could not read this page’s actions."
                                  : settled
                                    ? "No actions authorized for this console."
                                    : "Reading this page’s actions…"}
                              </li>
                            )}
                          </ul>
                        </article>
                      </div>
                    );
                  })}
                </section>
              </div>
            </div>

            <div className={styles.canvasFades} aria-hidden="true">
              <span data-edge="top" />
              <span data-edge="right" />
              <span data-edge="bottom" />
              <span data-edge="left" />
            </div>

            <p className={styles.canvasStanding}>Closing this tab ends the session.</p>
          </div>
        )}
      </div>
    </>
  );
}
