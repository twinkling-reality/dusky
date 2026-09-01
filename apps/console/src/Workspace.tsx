import { gate } from "@dusky/policy";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
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
import { type RuntimeAction, useConsoleLink } from "./useConsoleLink.js";
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
const NODE_BOUNDARY_GUTTER = 1;

function clampMovement(value: number, minimum: number, maximum: number): number {
  if (minimum > maximum) return 0;
  return Math.min(maximum, Math.max(minimum, value));
}

function visualBoundaryOf(element: HTMLElement) {
  const boxes = [
    element.getBoundingClientRect(),
    ...Array.from(element.querySelectorAll<HTMLElement>("[data-node-boundary]"), (child) =>
      child.getBoundingClientRect(),
    ),
  ];
  return {
    top: Math.min(...boxes.map((box) => box.top)),
    right: Math.max(...boxes.map((box) => box.right)),
    bottom: Math.max(...boxes.map((box) => box.bottom)),
    left: Math.min(...boxes.map((box) => box.left)),
  };
}

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
  const sampleWebsites = sites.every((site) => site.sample === true);
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
            {sampleWebsites
              ? "These sample websites show how unrelated pages can offer actions without custom integrations. Show or hide any page; the others stay visible."
              : "Each card contains the website loaded in this browser. Show or hide any page; the others stay visible."}
          </dd>
        </div>
        <div>
          <dt>Available actions</dt>
          <dd>
            Things each provider page authorized Dusky to offer now. Dusky marks whether an action
            needs approval on the Display before it runs.
          </dd>
        </div>
        <div>
          <dt>Technical log</dt>
          <dd>
            Actions run in this session, the website each came from, and their current status.
          </dd>
        </div>
      </dl>
      <p className={styles.whatDo}>
        Choose an action on the Display. Its provider tool runs here, in the browser.
      </p>
    </section>
  );
}

type ProviderInspectIconState = "inspect" | "pin" | "close";

function ProviderInspectIcon({ state }: { state: ProviderInspectIconState }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      {state === "close" ? (
        <>
          <path d="m5.25 5.25 9.5 9.5" />
          <path d="m14.75 5.25-9.5 9.5" />
        </>
      ) : state === "pin" ? (
        <>
          <path d="M7 3.25h6M8 3.25v3.8L6 9.5h8l-2-2.45v-3.8" />
          <path d="M10 9.5v7.25" />
        </>
      ) : (
        <>
          <path d="M3.75 2.75h8.5v12.5h-8.5z" />
          <path d="M6.25 6.25h3.5M6.25 9h2.25" />
          <circle cx="13.25" cy="12.75" r="2.75" />
          <path d="m15.2 14.7 2.05 2.05" />
        </>
      )}
    </svg>
  );
}

function actionLabel(tool: { name: string; title?: string }): string {
  const title = tool.title?.trim();
  if (title) return title;
  const words = tool.name.replace(/[_-]+/g, " ").trim();
  return words.length === 0 ? "Unnamed action" : words[0]?.toUpperCase() + words.slice(1);
}

function TechnicalLog({
  actions,
  sites,
  tools,
}: {
  actions: readonly RuntimeAction[];
  sites: readonly Source[];
  tools: readonly { name: string; title?: string; origin: string }[];
}) {
  const siteNames = new Map(sites.map((site) => [originOf(site), site.name]));
  const rows = [...actions].reverse();

  return (
    <section
      id="technical-log"
      className={styles.technicalLog}
      data-runtime-activity=""
      data-squircle=""
      data-empty={rows.length === 0 ? "" : undefined}
      aria-label="Technical log"
    >
      <header className={styles.technicalLogHead}>
        <h2>Technical log</h2>
        {rows.length > 0 && (
          <span>{`${rows.length} ${rows.length === 1 ? "action" : "actions"}`}</span>
        )}
      </header>

      {rows.length === 0 && <p className={styles.technicalLogEmpty}>No actions in this session.</p>}
      <ol className={styles.technicalLogEvents} aria-live="polite" aria-relevant="additions text">
        {rows.map((action) => {
          const tool = tools.find(
            (candidate) => candidate.origin === action.origin && candidate.name === action.toolName,
          );
          return (
            <li
              key={action.id}
              data-status={action.status}
              data-origin={action.origin}
              data-tool-name={action.toolName}
              aria-atomic="true"
            >
              <span className={styles.actionEventIdentity}>
                <strong>{actionLabel(tool ?? { name: action.toolName })}</strong>
                <span>{siteNames.get(action.origin) ?? "Connected website"}</span>
              </span>
              <span className={styles.eventStatus}>
                {action.status === "running"
                  ? "Running"
                  : action.status === "completed"
                    ? "Returned"
                    : action.status === "unknown"
                      ? "Outcome unknown"
                      : "Failed"}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function Workspace() {
  const probe = useRequirements();
  const [reqOpen, setReqOpen] = useState(false);
  const [whatOpen, setWhatOpen] = useState(false);
  const [canvasLayout, setCanvasLayout] = useState<"horizontal" | "vertical">("horizontal");
  const [wideTopology, setWideTopology] = useState(
    () => window.matchMedia("(min-width: 1320px)").matches,
  );
  const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
  const [canvasPanning, setCanvasPanning] = useState(false);
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const inspectButtons = useRef(new Map<string, HTMLButtonElement>());
  const canvasDrag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    panX: number;
    panY: number;
    minPanX: number;
    maxPanX: number;
    minPanY: number;
    maxPanY: number;
  } | null>(null);
  const nodeDrag = useRef<{
    id: string;
    pointerId: number;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    minOffsetX: number;
    maxOffsetX: number;
    minOffsetY: number;
    maxOffsetY: number;
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
  const topologyOrigins = useMemo(() => sites.map(originOf), [sites]);
  const sampleWebsites = sites.every((site) => site.sample === true);
  const [openOrigins, setOpenOrigins] = useState<string[]>(() => topologyOrigins);
  const allWebsitesOpen = topologyOrigins.every((origin) => openOrigins.includes(origin));
  const effectiveCanvasLayout = wideTopology ? canvasLayout : "vertical";

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1320px)");
    /*
     * A freeform desktop placement is not valid geometry after the viewport
     * changes. Keeping those pixel offsets was how a node dragged on a wide
     * canvas could wake up beyond the page rail in the stacked layout.
     */
    const update = () => {
      setWideTopology(query.matches);
      canvasDrag.current = null;
      nodeDrag.current = null;
      setCanvasPan({ x: 0, y: 0 });
      setNodeOffsets({});
      setCanvasPanning(false);
      setDraggingNode(null);
    };
    update();
    query.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      query.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

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
  const heading = sites.length === 1 ? (sites[0] as Source).name : "Connected websites";
  const displayLabel = mode === "embedded" ? "Display preview" : "Ray-Ban Display";
  const displayCopy =
    mode === "embedded"
      ? "The same 600 × 600 Display app, embedded here for the browser demo."
      : "The current screen on the paired glasses. Wearer input returns through the relay; tools still run in this browser.";
  const connectedOrigins = useMemo(
    () => new Set(link.tools.map((tool) => tool.origin)),
    [link.tools],
  );
  const linkLabel =
    link.link === "open"
      ? "Ready"
      : link.link === "superseded"
        ? "Moved to another tab"
        : link.link === "reconnecting"
          ? "Reconnecting"
          : link.link === "offline"
            ? "Offline"
            : "Connecting";

  const closeProviderInspector = useCallback((origin: string) => {
    setOpenOrigins((current) => current.filter((candidate) => candidate !== origin));
    const button = inspectButtons.current.get(origin);
    requestAnimationFrame(() => button?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const activeProvider = document.activeElement?.closest<HTMLElement>(
        '[data-node-id^="provider:"][data-inspected]',
      );
      const nodeId = activeProvider?.dataset["nodeId"];
      const origin = nodeId?.startsWith("provider:") ? nodeId.slice("provider:".length) : null;
      if (!origin || !openOrigins.includes(origin)) return;
      event.preventDefault();
      closeProviderInspector(origin);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openOrigins, closeProviderInspector]);

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
    if (!window.matchMedia("(min-width: 1320px)").matches) return;
    const target = event.target as Element;
    if (target.closest("[data-topology-node], button, a, input, iframe")) return;
    const canvasBox = event.currentTarget.getBoundingClientRect();
    const graphBox = event.currentTarget
      .querySelector<HTMLElement>(`.${styles.graphNodes}`)
      ?.getBoundingClientRect();
    if (!graphBox) return;
    canvasDrag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: canvasPan.x,
      panY: canvasPan.y,
      minPanX: canvasPan.x + canvasBox.left - graphBox.left,
      maxPanX: canvasPan.x + canvasBox.right - graphBox.right,
      minPanY: canvasPan.y + canvasBox.top - graphBox.top,
      maxPanY: canvasPan.y + canvasBox.bottom - graphBox.bottom,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setCanvasPanning(true);
  };

  const panCanvasMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = canvasDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setCanvasPan({
      x: clampMovement(drag.panX + event.clientX - drag.x, drag.minPanX, drag.maxPanX),
      y: clampMovement(drag.panY + event.clientY - drag.y, drag.minPanY, drag.maxPanY),
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
    if (!window.matchMedia("(min-width: 1320px)").matches) return;
    const target = event.target as Element;
    if (target.closest("iframe, button, a, input, textarea, select, [data-runtime-activity]"))
      return;
    const offset = nodeOffsets[id] ?? { x: 0, y: 0 };
    const nodeBox = visualBoundaryOf(event.currentTarget);
    const canvasBox = event.currentTarget
      .closest<HTMLElement>('[data-testid="topology-canvas"]')
      ?.getBoundingClientRect();
    if (!canvasBox) return;
    nodeDrag.current = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
      minOffsetX: offset.x + canvasBox.left + NODE_BOUNDARY_GUTTER - nodeBox.left,
      maxOffsetX: offset.x + canvasBox.right - NODE_BOUNDARY_GUTTER - nodeBox.right,
      minOffsetY: offset.y + canvasBox.top + NODE_BOUNDARY_GUTTER - nodeBox.top,
      maxOffsetY: offset.y + canvasBox.bottom - NODE_BOUNDARY_GUTTER - nodeBox.bottom,
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
        x: clampMovement(drag.offsetX + event.clientX - drag.x, drag.minOffsetX, drag.maxOffsetX),
        y: clampMovement(drag.offsetY + event.clientY - drag.y, drag.minOffsetY, drag.maxOffsetY),
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
            data-layout={effectiveCanvasLayout}
            data-panning={canvasPanning ? "" : undefined}
            data-node-dragging={draggingNode ? "" : undefined}
            data-inspecting={openOrigins.length > 0 ? "" : undefined}
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
                <h1 className={styles.canvasTitle}>Connected websites and their actions</h1>
                <p className={styles.canvasDescription}>
                  {sampleWebsites
                    ? "These sample websites supply the actions beside them. Show or hide any page; the others stay visible."
                    : "These websites supply the actions beside them. Show or hide any page; the others stay visible."}
                </p>
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
                aria-label={
                  wideTopology
                    ? `Flow: ${canvasLayout === "horizontal" ? "left to right" : "top to bottom"}`
                    : "Flow: top to bottom at this window width"
                }
                title={
                  wideTopology
                    ? `Flow: ${canvasLayout === "horizontal" ? "left to right" : "top to bottom"}`
                    : "Top to bottom at this window width"
                }
                onClick={changeCanvasLayout}
                disabled={!wideTopology}
              >
                <span className={styles.layoutGlyph} aria-hidden="true">
                  {effectiveCanvasLayout === "horizontal" ? "↔" : "↕"}
                </span>
                <span>
                  {effectiveCanvasLayout === "horizontal" ? "Left to right" : "Top to bottom"}
                </span>
              </button>
              <button
                type="button"
                className={styles.websiteToggle}
                aria-label={allWebsitesOpen ? "Hide all website pages" : "Show all website pages"}
                title={allWebsitesOpen ? "Hide all website pages" : "Show all website pages"}
                onClick={() => setOpenOrigins(allWebsitesOpen ? [] : topologyOrigins)}
              >
                <span className={styles.layoutGlyph} aria-hidden="true">
                  {allWebsitesOpen ? "−" : "+"}
                </span>
                <span>{allWebsitesOpen ? "Hide all pages" : "Show all pages"}</span>
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
                viewKey={`${effectiveCanvasLayout}:${
                  topologyOrigins.filter((origin) => openOrigins.includes(origin)).join("|") ||
                  "hidden"
                }`}
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
                  <h2
                    className={`${styles.nodePill} ${styles.displayNodeLabel}`}
                    data-node-boundary=""
                  >
                    <span>{displayLabel}</span>
                    {link.link !== "open" && <span className={styles.nodeState}>{linkLabel}</span>}
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
                  <div className={styles.runtimePanel} data-runtime-panel="">
                    <div
                      className={styles.browserRuntimeNode}
                      data-runtime-status=""
                      data-squircle=""
                    >
                      <div className={styles.runtimeHeading}>
                        <h2>Browser runtime</h2>
                        <span className={styles.runtimeState} data-state={link.link} role="status">
                          {linkLabel}
                        </span>
                      </div>
                      <p className={styles.runtimeSummary}>
                        <strong>
                          {link.tools.length} {link.tools.length === 1 ? "action" : "actions"}
                        </strong>
                        <span>
                          across {connectedOrigins.size}{" "}
                          {connectedOrigins.size === 1 ? "website" : "websites"}
                        </span>
                      </p>
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
                    </div>

                    <TechnicalLog actions={link.recentActions} sites={sites} tools={link.tools} />
                  </div>
                </section>

                <section
                  className={styles.providerActionField}
                  data-testid="actions"
                  aria-label="Connected websites and their available actions"
                >
                  {sites.map((site, siteIndex) => {
                    const origin = originOf(site);
                    const available = link.tools.filter((tool) => tool.origin === origin);
                    const settled = link.settled(origin);
                    const inspected = openOrigins.includes(origin);
                    const pinned = inspected;
                    const panelId = `provider-page-${siteIndex}`;
                    const labelId = `provider-label-${siteIndex}`;
                    const inspectLabel = pinned
                      ? `Hide ${site.name} page`
                      : `Show ${site.name} page`;
                    const inspectIcon: ProviderInspectIconState = pinned ? "close" : "inspect";
                    return (
                      <fieldset
                        key={site.id}
                        className={styles.providerActionPair}
                        aria-label={`${site.name} provider and actions`}
                        data-topology-focus={`provider:${origin}`}
                        data-motion-order={String(siteIndex + 4)}
                      >
                        <figure
                          className={styles.providerNode}
                          aria-labelledby={labelId}
                          data-topology-node=""
                          data-node-id={`provider:${origin}`}
                          data-node-dragging={
                            draggingNode === `provider:${origin}` ? "" : undefined
                          }
                          data-inspected={inspected ? "" : undefined}
                          data-pinned={pinned ? "" : undefined}
                          style={nodeStyle(`provider:${origin}`)}
                          onPointerDown={(event) => moveNodeStart(`provider:${origin}`, event)}
                          onPointerMove={(event) => moveNode(`provider:${origin}`, event)}
                          onPointerUp={(event) => moveNodeEnd(`provider:${origin}`, event)}
                          onPointerCancel={(event) => moveNodeEnd(`provider:${origin}`, event)}
                        >
                          <div
                            className={styles.providerNodeControls}
                            data-provider-controls=""
                            data-node-boundary=""
                          >
                            <span
                              id={labelId}
                              className={`${styles.nodePill} ${styles.providerNodeLabel}`}
                            >
                              <span>{site.name}</span>
                            </span>
                            <button
                              ref={(element) => {
                                if (element) inspectButtons.current.set(origin, element);
                                else inspectButtons.current.delete(origin);
                              }}
                              type="button"
                              className={styles.providerInspectButton}
                              data-open={inspected ? "" : undefined}
                              data-pinned={pinned ? "" : undefined}
                              aria-label={inspectLabel}
                              aria-controls={panelId}
                              aria-expanded={inspected}
                              title={inspectLabel}
                              onClick={() => {
                                if (pinned) closeProviderInspector(origin);
                                else
                                  setOpenOrigins((current) => [
                                    ...current.filter((candidate) => candidate !== origin),
                                    origin,
                                  ]);
                              }}
                            >
                              <ProviderInspectIcon state={inspectIcon} />
                            </button>
                            {!inspected ? (
                              <>
                                <span
                                  className={styles.providerPort}
                                  data-provider-origin={origin}
                                  data-compact-port=""
                                  aria-hidden="true"
                                />
                                <span
                                  className={styles.providerActionPort}
                                  data-action-origin={origin}
                                  data-action-end="provider"
                                  data-compact-port=""
                                  aria-hidden="true"
                                />
                              </>
                            ) : null}
                          </div>
                          {inspected ? (
                            <>
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
                            </>
                          ) : null}
                          <div className={styles.providerViewport} data-provider-viewport="">
                            <iframe
                              id={panelId}
                              className={styles.frame}
                              title={site.name}
                              src={site.previewUrl ?? site.url}
                              allow="tools"
                              tabIndex={inspected ? 0 : -1}
                              aria-hidden={inspected ? undefined : true}
                            />
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
                          <h2 className={styles.actionCountLabel} data-node-boundary="">
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
                                  <span className={styles.actionName}>{actionLabel(tool)}</span>
                                  <span
                                    className={styles.actionApproval}
                                    data-confirm={decision.requiresConfirmation ? "" : undefined}
                                    data-consequence={decision.consequence}
                                  >
                                    {decision.requiresConfirmation
                                      ? "approval required"
                                      : "no approval needed"}
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
                      </fieldset>
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
