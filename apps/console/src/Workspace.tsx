import { gate } from "@dusky/policy";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router";
import { ConnectionsPanel } from "./ConnectionsPanel.js";
import { PairingConnections } from "./PairingConnections.js";
import { RequirementsButton, RequirementsPanel, useRequirements } from "./Requirements.js";
import runtimeMotion from "./RuntimeMotion.module.css";
import { SiteHeader } from "./SiteHeader.js";
import header from "./SiteHeader.module.css";
import { codeProblem, isCode, mintCode, type PairMode } from "./session.js";
import { connectionValues, originOf, SOURCES, type Source, sitesFromQuery } from "./sources.js";
import { type TopologyActivityVisualState, TopologyConnections } from "./TopologyConnections.js";
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
 * The product loop, on the same terms as the requirements dropdown.
 *
 * A cold visitor needs to understand where actions come from, where they run,
 * and who approves them. They do not need a glossary of the current canvas
 * arrangement: that went stale as soon as the runtime and log moved.
 *
 * A dropdown costs nothing to anybody who does not open it, which makes it the
 * right home for the small amount of context only some people need.
 */
function WhatIsThis({ onClose }: { onClose: () => void }) {
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
      <div className={styles.whatBody}>
        <p className={styles.whatIntro}>
          Dusky turns authorized WebMCP actions into interfaces for AR displays. The 600 × 600
          Ray-Ban Display is the first proof case. No site-specific adapters are required.
        </p>
        <p>
          Choose on the Display, or send a task from a browser agent. The matching website runs each
          action in this browser. Any action that can change a website waits for wearer approval.
        </p>
      </div>
      <p className={styles.whatNote}>
        Hidden website previews stay connected. The execution log records only website actions that
        run.
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

function WebsitesIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3" y="3.5" width="14" height="13" rx="2" />
      <path d="M3 7h14M6 5.25h.01M8.25 5.25h.01" />
    </svg>
  );
}

function OrientationIcon({ direction }: { direction: "horizontal" | "vertical" }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      {direction === "horizontal" ? (
        <>
          <path d="M3.25 10h13.5" />
          <path d="m6.25 7-3 3 3 3M13.75 7l3 3-3 3" />
        </>
      ) : (
        <>
          <path d="M10 3.25v13.5" />
          <path d="m7 6.25 3-3 3 3M7 13.75l3 3 3-3" />
        </>
      )}
    </svg>
  );
}

function PageViewIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3.25" y="4.25" width="10.5" height="11.5" rx="1.5" />
      <path d="M6.25 2.75h8.5a2 2 0 0 1 2 2v8.5" />
      {open ? <path d="M6.25 8h4.5M6.25 11h3" /> : <path d="M6.25 10h4.5" />}
    </svg>
  );
}

function CenterIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="4.25" />
      <path d="M10 2.75v2M10 15.25v2M2.75 10h2M15.25 10h2" />
    </svg>
  );
}

function actionLabel(tool: { name: string; title?: string }): string {
  const title = tool.title?.trim();
  if (title) return title;
  const words = tool.name.replace(/[_-]+/g, " ").trim();
  return words.length === 0 ? "Unnamed action" : words[0]?.toUpperCase() + words.slice(1);
}

function runtimeStatusLabel(action: RuntimeAction): string {
  if (action.status === "running") return "Running";
  if (action.status === "returned") return "Returned";
  if (action.status === "succeeded") return "Succeeded";
  if (action.status === "unknown") return "Outcome unknown";
  return action.providerHit ? "Failed" : "Did not run";
}

function topologyActivityFor(
  activity: ReturnType<typeof useConsoleLink>["activity"],
): TopologyActivityVisualState | null {
  const cue = activity.cue;
  if (!cue || cue.direction === "none") return null;

  if (cue.direction === "runtime-to-provider" && cue.tool) {
    return {
      origin: cue.tool.origin,
      toolName: cue.tool.name,
      phase: "invoking",
      direction: "request",
      cueRevision: cue.sequence,
    };
  }

  if (cue.direction === "provider-to-runtime" && cue.tool) {
    return {
      origin: cue.tool.origin,
      toolName: cue.tool.name,
      phase: cue.kind === "invocation-failure" ? "failed" : "returned",
      direction: "return",
      cueRevision: cue.sequence,
    };
  }

  // Display input and returned session frames own only the Display/runtime
  // edge. Omitting tool identity prevents the renderer from inventing a
  // provider path merely because the current frame happens to name one.
  return {
    phase:
      activity.session.phase === "approval"
        ? "awaiting-approval"
        : activity.session.outcome === "failed"
          ? "failed"
          : activity.session.outcome === "unknown"
            ? "unknown"
            : "intent",
    direction: cue.direction === "display-to-runtime" ? "request" : "return",
    cueRevision: cue.sequence,
  };
}

type ActionSurfaceState = "preparing" | "approval" | RuntimeAction["status"];

interface ActionSurfaceActivity {
  state: ActionSurfaceState;
  label: string;
  providerHit: boolean;
}

function selectedActionActivity(
  activity: ReturnType<typeof useConsoleLink>["activity"],
  origin: string,
  name: string,
): ActionSurfaceActivity | null {
  if (activity.session.tool?.origin !== origin || activity.session.tool.name !== name) return null;
  if (activity.session.phase === "approval") {
    return { state: "approval", label: "Awaiting wearer approval", providerHit: false };
  }
  if (activity.session.phase === "parameters") {
    return { state: "preparing", label: "Input on Display", providerHit: false };
  }
  if (activity.session.phase === "resolving") {
    return { state: "preparing", label: "Resolving details", providerHit: false };
  }
  if (activity.session.phase === "invoking") {
    return { state: "preparing", label: "Preparing to run", providerHit: false };
  }
  return null;
}

function actionSurfaceActivity(
  selected: ActionSurfaceActivity | null,
  latest: RuntimeAction | undefined,
): ActionSurfaceActivity | null {
  if (
    selected?.state === "preparing" &&
    selected.label === "Preparing to run" &&
    latest?.status === "running"
  ) {
    return {
      state: latest.status,
      label: runtimeStatusLabel(latest),
      providerHit: latest.providerHit,
    };
  }
  if (selected) return selected;
  if (!latest) return null;
  return {
    state: latest.status,
    label: runtimeStatusLabel(latest),
    providerHit: latest.providerHit,
  };
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
      aria-label="Execution log"
    >
      <header className={styles.technicalLogHead}>
        <h2>Execution log</h2>
        {rows.length > 0 && (
          <span>{`${rows.length} ${rows.length === 1 ? "action" : "actions"}`}</span>
        )}
      </header>

      {rows.length === 0 && (
        <p className={styles.technicalLogEmpty}>No website actions have run yet.</p>
      )}
      <ol
        className={styles.technicalLogEvents}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {rows.map((action) => {
          const tool = tools.find(
            (candidate) => candidate.origin === action.origin && candidate.name === action.toolName,
          );
          return (
            <li
              key={action.id}
              className={runtimeMotion.eventRow}
              data-status={action.status}
              data-provider-hit={action.providerHit ? "true" : "false"}
              data-origin={action.origin}
              data-tool-name={action.toolName}
              aria-atomic="true"
            >
              <span className={styles.actionEventIdentity}>
                <strong>{actionLabel(tool ?? { name: action.toolName })}</strong>
                <span>{siteNames.get(action.origin) ?? "Connected website"}</span>
              </span>
              <span className={`${styles.eventStatus} ${runtimeMotion.eventStatus}`}>
                <span className={runtimeMotion.eventGlyph} aria-hidden="true" />
                {runtimeStatusLabel(action)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * The reverse half of Dusky's WebMCP story, measured in this document.
 *
 * Provider actions flow into the browser runtime above. These controls flow
 * back out to an agent in the same browser, so they belong in that runtime
 * surface instead of in the provider action list the wearer sees.
 */
function AgentAccess({ state }: { state: "unavailable" | "registering" | "ready" | "failed" }) {
  const status =
    state === "ready" ? "Available" : state === "registering" ? "Starting" : "Unavailable";
  const description =
    state === "ready"
      ? "Browser agent control available: check Display status, list website actions, send a task, or cancel."
      : state === "registering"
        ? "Browser agent control is starting."
        : state === "unavailable"
          ? "Browser agent control is unavailable because WebMCP is not enabled in this browser."
          : "Browser agent control is unavailable because registration failed.";

  return (
    <p
      className={styles.agentAccess}
      data-agent-access=""
      data-state={state}
      role="status"
      aria-label={description}
      aria-live="polite"
    >
      <strong>Control from a browser agent</strong>
      <span>{status}</span>
    </p>
  );
}

export function Workspace() {
  const probe = useRequirements();
  const [reqOpen, setReqOpen] = useState(false);
  const [whatOpen, setWhatOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const restoreConnectionsFocus = useRef(false);
  const [canvasLayout, setCanvasLayout] = useState<"horizontal" | "vertical">("horizontal");
  const [wideTopology, setWideTopology] = useState(
    () => window.matchMedia("(min-width: 1180px)").matches,
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
  const sampleWebsiteCount = sites.filter((site) => site.sample === true).length;
  const addedWebsiteCount = sites.length - sampleWebsiteCount;
  const [openOrigins, setOpenOrigins] = useState<string[]>([]);
  const allWebsitesOpen = topologyOrigins.every((origin) => openOrigins.includes(origin));
  const effectiveCanvasLayout = wideTopology ? canvasLayout : "vertical";

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1180px)");
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
  const topologyActivity = useMemo(() => topologyActivityFor(link.activity), [link.activity]);
  const latestActionByTool = useMemo(() => {
    const index = new Map<string, RuntimeAction>();
    for (const action of link.recentActions) {
      index.set(`${action.origin}\u0000${action.toolName}`, action);
    }
    return index;
  }, [link.recentActions]);
  const cueTool = link.activity.cue?.tool ?? null;
  const providerCueOrigin =
    topologyActivity?.origin && topologyActivity.toolName ? topologyActivity.origin : null;
  const displayCueActive = topologyActivity !== null && providerCueOrigin === null;
  const displayCueState = displayCueActive
    ? topologyActivity?.phase === "awaiting-approval"
      ? "approval"
      : topologyActivity?.phase === "failed"
        ? "failed"
        : "active"
    : undefined;

  const displayLabel = mode === "embedded" ? "Display preview" : "Ray-Ban Display";
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

  /*
   * Changing the held origins restarts the relay-owned Session. That is safe
   * on the idle action menu and nowhere else: parameters, confirmation,
   * transfer, and invocation all bind to the exact discovered declaration the
   * wearer is currently looking at.
   */
  const canChangeConnections = link.activity.session.phase === "idle";

  const connectionStatusFor = useCallback(
    (origin: string) => {
      if (link.problem) return { label: "Actions unavailable", state: "failed" as const };
      if (!link.settled(origin)) return { label: "Checking", state: "checking" as const };
      const count = link.tools.filter((tool) => tool.origin === origin).length;
      if (count === 0) return { label: "No actions found", state: "empty" as const };
      return {
        label: `${count} ${count === 1 ? "action" : "actions"}`,
        state: "active" as const,
      };
    },
    [link],
  );

  const closeConnections = useCallback(() => {
    restoreConnectionsFocus.current = true;
    setConnectionsOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (connectionsOpen || !restoreConnectionsFocus.current) return;
    document.getElementById("connections-button")?.focus({ preventScroll: true });
  }, [connectionsOpen]);

  useEffect(() => {
    if (connectionsOpen || !restoreConnectionsFocus.current) return;
    // Replacing provider documents can briefly move browser focus into a new
    // iframe after the dialog has already restored it. Reassert only when the
    // browser, not the user, owns focus; never pull it away from another control.
    const settle = setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body || active.tagName === "IFRAME") {
        document.getElementById("connections-button")?.focus({ preventScroll: true });
      }
      restoreConnectionsFocus.current = false;
    }, 900);
    return () => clearTimeout(settle);
  }, [connectionsOpen]);

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
      const active = document.activeElement;
      if (active && active !== document.body) return;
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
    if (!window.matchMedia("(min-width: 1180px)").matches) return;
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
    if (!window.matchMedia("(min-width: 1180px)").matches) return;
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

  const applyConnections = (nextSites: readonly Source[]) => {
    if (!canChangeConnections || nextSites.length === 0) return;
    const next = new URLSearchParams(params);
    next.delete("connection");
    next.delete("site");
    next.delete("source");

    const isDefaultSet =
      nextSites.length === SOURCES.length &&
      nextSites.every(
        (site, index) =>
          site.sample === true &&
          site.id === SOURCES[index]?.id &&
          originOf(site) === originOf(SOURCES[index]!),
      );
    if (!isDefaultSet) {
      for (const value of connectionValues(nextSites)) next.append("connection", value);
    }

    const nextOrigins = new Set(nextSites.map(originOf));
    setOpenOrigins((current) => current.filter((origin) => nextOrigins.has(origin)));
    centerTopology();
    setParams(next, { replace: true });
    closeConnections();
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
            {whatOpen && <WhatIsThis onClose={() => setWhatOpen(false)} />}
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
                Open Dusky on your Display, then enter the six-letter code shown there.
              </p>
              <p className={styles.startSetup} data-testid="first-time-setup">
                <strong>First time?</strong> In Meta AI, add{" "}
                <span className={styles.startSetupUrl}>https://dusky-display.vercel.app</span> under{" "}
                <span className={styles.startSetupPath}>App connections → Web apps</span>. Check{" "}
                <span className={styles.startSetupPath}>Requirements</span> for Chrome setup.
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
                    ? "These sample websites supply the actions beside them. Open a page only when you want to inspect it; hidden pages stay connected."
                    : `${sampleWebsiteCount} ${sampleWebsiteCount === 1 ? "sample" : "samples"} and ${addedWebsiteCount} added ${addedWebsiteCount === 1 ? "website" : "websites"} supply the actions beside them. Hidden pages stay connected.`}
                </p>
                {link.link !== "open" && (
                  <p className={styles.canvasProblem} role="status">
                    {linkLabel}
                  </p>
                )}
              </div>
            </div>

            <div
              className={`${styles.graphPlane} ${runtimeMotion.surface}`}
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
                runtimeConnected={
                  link.link === "open" && link.activity.session.displayConnected === true
                }
                activity={topologyActivity}
                viewKey={`${effectiveCanvasLayout}:${
                  topologyOrigins.filter((origin) => openOrigins.includes(origin)).join("|") ||
                  "hidden"
                }`}
                className={styles.topologyEdges}
              />

              <div className={styles.graphNodes}>
                <section
                  className={`${styles.displayGraphNode} ${runtimeMotion.node}`}
                  data-mode={mode}
                  data-topology-node=""
                  data-node-id="display"
                  data-node-dragging={draggingNode === "display" ? "" : undefined}
                  data-topology-focus="display"
                  data-display-connected={
                    link.activity.session.displayConnected === true ? "true" : "false"
                  }
                  data-runtime-node-state={displayCueState}
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
                      className={`${styles.browserRuntimeNode} ${runtimeMotion.node}`}
                      data-runtime-status=""
                      data-runtime-node-state={
                        displayCueState ?? (providerCueOrigin ? "active" : undefined)
                      }
                      data-squircle=""
                    >
                      <div className={styles.runtimeHeading}>
                        <h2>Browser runtime</h2>
                        <span className={styles.runtimeState} data-state={link.link} role="status">
                          {linkLabel}
                        </span>
                      </div>
                      <p
                        className={styles.runtimeSummary}
                        data-state={
                          link.problem ? "failed" : link.discoverySettled ? "checked" : "checking"
                        }
                        role="status"
                      >
                        <strong>
                          {link.tools.length} {link.tools.length === 1 ? "action" : "actions"}
                        </strong>
                        <span>
                          {link.problem
                            ? "website actions unavailable"
                            : link.discoverySettled
                              ? `from ${sites.length} ${sites.length === 1 ? "website" : "websites"}`
                              : `checking ${sites.length} ${sites.length === 1 ? "website" : "websites"}`}
                        </span>
                      </p>
                      <AgentAccess state={link.provideState} />
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
                    const awaitingApprovalHere =
                      link.activity.session.phase === "approval" &&
                      link.activity.session.tool?.origin === origin;
                    return (
                      <fieldset
                        key={site.id}
                        className={styles.providerActionPair}
                        aria-label={`${site.name} provider and actions`}
                        data-topology-focus={`provider:${origin}`}
                        data-connection-kind={site.sample === true ? "sample" : "added"}
                        data-motion-item=""
                        data-motion-kind="connection"
                        data-motion-order={String(siteIndex + 4)}
                      >
                        <figure
                          className={`${styles.providerNode} ${runtimeMotion.node}`}
                          aria-labelledby={labelId}
                          data-topology-node=""
                          data-node-id={`provider:${origin}`}
                          data-node-dragging={
                            draggingNode === `provider:${origin}` ? "" : undefined
                          }
                          data-inspected={inspected ? "" : undefined}
                          data-pinned={pinned ? "" : undefined}
                          data-runtime-node-state={
                            providerCueOrigin === origin
                              ? topologyActivity?.phase === "failed"
                                ? "failed"
                                : "active"
                              : undefined
                          }
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
                          className={`${styles.actionNode} ${runtimeMotion.node}`}
                          aria-label={`${site.name} actions`}
                          data-topology-node=""
                          data-node-id={`actions:${origin}`}
                          data-node-dragging={draggingNode === `actions:${origin}` ? "" : undefined}
                          data-runtime-node-state={
                            awaitingApprovalHere
                              ? "approval"
                              : providerCueOrigin === origin
                                ? topologyActivity?.phase === "failed"
                                  ? "failed"
                                  : "active"
                                : undefined
                          }
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
                              const selected = selectedActionActivity(
                                link.activity,
                                tool.origin,
                                tool.name,
                              );
                              const latest = latestActionByTool.get(
                                `${tool.origin}\u0000${tool.name}`,
                              );
                              const surfaceActivity = actionSurfaceActivity(selected, latest);
                              const cueHitsThisTool =
                                cueTool?.origin === tool.origin &&
                                cueTool.name === tool.name &&
                                link.activity.cue?.kind === "invocation-start";
                              return (
                                <li
                                  key={`${tool.origin}/${tool.name}`}
                                  className={runtimeMotion.actionRow}
                                  data-topology-tool-origin={tool.origin}
                                  data-topology-tool-name={tool.name}
                                  data-action-state={surfaceActivity?.state}
                                  data-provider-hit={
                                    surfaceActivity
                                      ? String(surfaceActivity.providerHit)
                                      : undefined
                                  }
                                  data-motion-item=""
                                  data-motion-kind="action"
                                  data-motion-order={String(Math.min(toolIndex + 1, 8))}
                                >
                                  {cueHitsThisTool && (
                                    <span
                                      key={link.activity.cue?.sequence}
                                      className={runtimeMotion.actionGleam}
                                      aria-hidden="true"
                                    />
                                  )}
                                  <span className={styles.actionName}>{actionLabel(tool)}</span>
                                  <span
                                    className={`${styles.actionApproval} ${
                                      surfaceActivity ? runtimeMotion.actionState : ""
                                    }`}
                                    data-confirm={
                                      !surfaceActivity && decision.requiresConfirmation
                                        ? ""
                                        : undefined
                                    }
                                    data-consequence={decision.consequence}
                                  >
                                    {surfaceActivity?.label ??
                                      (decision.requiresConfirmation
                                        ? "approval required"
                                        : "no approval needed")}
                                  </span>
                                </li>
                              );
                            })}
                            {available.length === 0 && (
                              <li className={styles.actionEmpty}>
                                {link.problem
                                  ? "Could not read this page’s actions."
                                  : settled
                                    ? "No actions discovered in this browser."
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

      {session && (
        <div
          className={styles.canvasControls}
          data-motion-item=""
          data-motion-order="2"
          data-squircle=""
          role="toolbar"
          aria-label="Graph controls"
        >
          <button
            id="connections-button"
            type="button"
            className={styles.connectionsButton}
            aria-label={`Manage ${sites.length} connected ${sites.length === 1 ? "website" : "websites"}`}
            aria-haspopup="dialog"
            aria-expanded={connectionsOpen}
            data-open={connectionsOpen || undefined}
            data-tooltip="Configure Websites"
            onClick={() => setConnectionsOpen((open) => !open)}
          >
            <span className={styles.commandIcon} aria-hidden="true">
              <WebsitesIcon />
            </span>
            <span className={styles.commandLabel}>Configure Websites</span>
            <strong className={styles.commandValue}>{sites.length}</strong>
          </button>
          <button
            type="button"
            aria-label={
              wideTopology
                ? `Flow: ${canvasLayout === "horizontal" ? "left to right" : "top to bottom"}`
                : "Flow: top to bottom at this window width"
            }
            data-tooltip={
              wideTopology
                ? `Switch to ${canvasLayout === "horizontal" ? "top-to-bottom" : "left-to-right"} flow`
                : "Top-to-bottom flow at this window size"
            }
            onClick={changeCanvasLayout}
            disabled={!wideTopology}
          >
            <span className={styles.commandIcon} aria-hidden="true">
              <OrientationIcon direction={effectiveCanvasLayout} />
            </span>
            <span className={styles.commandLabel}>Orientation</span>
            <strong className={styles.commandValue}>
              {effectiveCanvasLayout === "horizontal" ? "L → R" : "T → B"}
            </strong>
          </button>
          <button
            type="button"
            className={styles.websiteToggle}
            aria-label={allWebsitesOpen ? "Hide all website pages" : "Show all website pages"}
            data-tooltip={allWebsitesOpen ? "Hide all website pages" : "Show all website pages"}
            onClick={() => setOpenOrigins(allWebsitesOpen ? [] : topologyOrigins)}
          >
            <span className={styles.commandIcon} aria-hidden="true">
              <PageViewIcon open={allWebsitesOpen} />
            </span>
            <span className={styles.commandLabel}>Page View</span>
            <strong className={styles.commandValue}>{allWebsitesOpen ? "Shown" : "Hidden"}</strong>
          </button>
          {(canvasPan.x !== 0 || canvasPan.y !== 0 || hasMovedNodes) && (
            <button
              type="button"
              aria-label="Center"
              data-tooltip="Center the graph"
              onClick={centerTopology}
            >
              <span className={styles.commandIcon} aria-hidden="true">
                <CenterIcon />
              </span>
              <span className={styles.commandLabel}>Reset view</span>
            </button>
          )}
        </div>
      )}

      {session && connectionsOpen && (
        <ConnectionsPanel
          sites={sites}
          canChange={canChangeConnections}
          statusFor={connectionStatusFor}
          onApply={applyConnections}
          onClose={closeConnections}
        />
      )}
    </>
  );
}
