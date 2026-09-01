import { useLayoutEffect, useRef } from "react";

interface Point {
  x: number;
  y: number;
}

interface Anchor {
  point: Point;
  normal: Point;
}

export interface CubicSegment {
  from: Point;
  controlA: Point;
  controlB: Point;
  to: Point;
}

export type PathCommand = { kind: "move"; point: Point } | { kind: "curve"; segment: CubicSegment };

type EdgeKind = "display" | "provider" | "actions";

interface MeasuredEdge {
  id: string;
  kind: EdgeKind;
  origin?: string;
  segments: readonly CubicSegment[];
  motionSegments?: readonly CubicSegment[];
  connected: boolean;
}

interface PathSample {
  angle: number;
  distance: number;
  point: Point;
}

interface TopologyConnectionsProps {
  origins: readonly string[];
  connectedOrigins: ReadonlySet<string>;
  runtimeConnected: boolean;
  viewKey: string;
  className?: string;
}

const SAMPLE_STEPS = 28;
const EPSILON = 0.25;

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function samePoint(a: Point, b: Point): boolean {
  return distance(a, b) <= EPSILON;
}

function centerOf(element: HTMLElement, canvas: DOMRect): Point {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left - canvas.left + rect.width / 2,
    y: rect.top - canvas.top + rect.height / 2,
  };
}

function anchorOf(element: HTMLElement, canvas: DOMRect, normal: Point): Anchor {
  return { point: centerOf(element, canvas), normal };
}

function line(from: Point, to: Point): CubicSegment {
  return {
    from,
    controlA: { x: from.x + (to.x - from.x) / 3, y: from.y + (to.y - from.y) / 3 },
    controlB: {
      x: from.x + ((to.x - from.x) * 2) / 3,
      y: from.y + ((to.y - from.y) * 2) / 3,
    },
    to,
  };
}

function curve(from: Anchor, to: Anchor): CubicSegment {
  const span = distance(from.point, to.point);
  if (span < 36) return line(from.point, to.point);
  const handle = Math.min(104, Math.max(14, span * 0.38), span * 0.45);
  return {
    from: from.point,
    controlA: {
      x: from.point.x + from.normal.x * handle,
      y: from.point.y + from.normal.y * handle,
    },
    controlB: {
      x: to.point.x + to.normal.x * handle,
      y: to.point.y + to.normal.y * handle,
    },
    to: to.point,
  };
}

/** A restrained single-cubic bow for otherwise perfectly aligned nodes. */
function bowedCurve(from: Anchor, to: Anchor, bend: number): readonly CubicSegment[] {
  const span = Math.max(1, distance(from.point, to.point));
  const direction = {
    x: (to.point.x - from.point.x) / span,
    y: (to.point.y - from.point.y) / span,
  };
  const effectiveBend = bend;
  const handle = Math.min(72, Math.max(10, span * 0.38));
  const offset = {
    x: -direction.y * effectiveBend,
    y: direction.x * effectiveBend,
  };
  return [
    {
      from: from.point,
      controlA: {
        x: from.point.x + from.normal.x * handle + offset.x,
        y: from.point.y + from.normal.y * handle + offset.y,
      },
      controlB: {
        x: to.point.x + to.normal.x * handle + offset.x,
        y: to.point.y + to.normal.y * handle + offset.y,
      },
      to: to.point,
    },
  ];
}

/**
 * Convert a flat segment list into explicit Canvas commands. A new subpath is
 * required whenever a segment begins anywhere other than the previous end.
 */
export function commandsForSegments(segments: readonly CubicSegment[]): readonly PathCommand[] {
  const commands: PathCommand[] = [];
  let previous: Point | null = null;
  for (const segment of segments) {
    if (!previous || !samePoint(previous, segment.from)) {
      commands.push({ kind: "move", point: segment.from });
    }
    commands.push({ kind: "curve", segment });
    previous = segment.to;
  }
  return commands;
}

function trace(context: CanvasRenderingContext2D, segments: readonly CubicSegment[]): void {
  context.beginPath();
  for (const command of commandsForSegments(segments)) {
    if (command.kind === "move") {
      context.moveTo(command.point.x, command.point.y);
    } else {
      const segment = command.segment;
      context.bezierCurveTo(
        segment.controlA.x,
        segment.controlA.y,
        segment.controlB.x,
        segment.controlB.y,
        segment.to.x,
        segment.to.y,
      );
    }
  }
}

function pointOn(segment: CubicSegment, t: number): Point {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * segment.from.x +
      3 * inverse ** 2 * t * segment.controlA.x +
      3 * inverse * t ** 2 * segment.controlB.x +
      t ** 3 * segment.to.x,
    y:
      inverse ** 3 * segment.from.y +
      3 * inverse ** 2 * t * segment.controlA.y +
      3 * inverse * t ** 2 * segment.controlB.y +
      t ** 3 * segment.to.y,
  };
}

function tangentOn(segment: CubicSegment, t: number): Point {
  const inverse = 1 - t;
  return {
    x:
      3 * inverse ** 2 * (segment.controlA.x - segment.from.x) +
      6 * inverse * t * (segment.controlB.x - segment.controlA.x) +
      3 * t ** 2 * (segment.to.x - segment.controlB.x),
    y:
      3 * inverse ** 2 * (segment.controlA.y - segment.from.y) +
      6 * inverse * t * (segment.controlB.y - segment.controlA.y) +
      3 * t ** 2 * (segment.to.y - segment.controlB.y),
  };
}

function samplesFor(segments: readonly CubicSegment[]): readonly PathSample[] {
  const samples: PathSample[] = [];
  let travelled = 0;
  let previous: Point | null = null;
  for (const segment of segments) {
    for (let step = 0; step <= SAMPLE_STEPS; step += 1) {
      if (samples.length > 0 && step === 0 && previous && samePoint(previous, segment.from))
        continue;
      const t = step / SAMPLE_STEPS;
      const point = pointOn(segment, t);
      if (previous) travelled += distance(previous, point);
      const tangent = tangentOn(segment, t);
      samples.push({ point, distance: travelled, angle: Math.atan2(tangent.y, tangent.x) });
      previous = point;
    }
  }
  return samples;
}

function positionOn(samples: readonly PathSample[], progress: number): PathSample {
  const fallback = samples[0] ?? { point: { x: 0, y: 0 }, distance: 0, angle: 0 };
  const last = samples[samples.length - 1];
  if (!last || last.distance <= 0) return fallback;
  const target = Math.min(0.999999, Math.max(0, progress)) * last.distance;
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((samples[middle]?.distance ?? 0) < target) low = middle + 1;
    else high = middle;
  }
  const after = samples[low] ?? last;
  const before = samples[Math.max(0, low - 1)] ?? after;
  const span = Math.max(EPSILON, after.distance - before.distance);
  const mix = Math.min(1, Math.max(0, (target - before.distance) / span));
  return {
    point: {
      x: before.point.x + (after.point.x - before.point.x) * mix,
      y: before.point.y + (after.point.y - before.point.y) * mix,
    },
    distance: target,
    angle: before.angle + (after.angle - before.angle) * mix,
  };
}

function cssColor(style: CSSStyleDeclaration, property: string, fallback: string): string {
  return style.getPropertyValue(property).trim() || fallback;
}

function drawTransferSignal(
  context: CanvasRenderingContext2D,
  sample: PathSample,
  color: string,
  length: number,
  alpha: number,
  reverse = false,
): void {
  context.save();
  context.translate(sample.point.x, sample.point.y);
  context.rotate(sample.angle + (reverse ? Math.PI : 0));

  // A tapered signal with a detached echo reads as data moving along a path,
  // rather than as another UI pill laid on top of it.
  const halfHeight = clamp(length * 0.12, 0.9, 1.65);
  context.fillStyle = color;
  context.shadowColor = color;
  context.shadowBlur = 4;

  context.globalAlpha = alpha * 0.24;
  context.beginPath();
  context.moveTo(-length * 1.7, 0);
  context.lineTo(-length * 0.82, -halfHeight * 0.42);
  context.lineTo(-length * 0.55, 0);
  context.lineTo(-length * 0.82, halfHeight * 0.42);
  context.closePath();
  context.fill();

  context.globalAlpha = alpha;
  context.beginPath();
  context.moveTo(-length, 0);
  context.lineTo(-length * 0.16, -halfHeight);
  context.lineTo(1.8, 0);
  context.lineTo(-length * 0.16, halfHeight);
  context.closePath();
  context.fill();

  context.translate(1.25, 0);
  context.rotate(Math.PI / 4);
  context.shadowBlur = 5;
  context.fillRect(-1.15, -1.15, 2.3, 2.3);
  context.restore();
}

function focusMatches(edge: MeasuredEdge, focus: string | null): boolean {
  if (!focus) return true;
  if (focus === "display") return edge.kind === "display";
  if (focus === "runtime") return edge.kind === "display" || edge.kind === "provider";
  if (focus.startsWith("provider:")) {
    const origin = focus.slice("provider:".length);
    return edge.origin === origin;
  }
  return true;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * High-DPI Canvas2D connection layer. DOM terminals own the exact measured
 * boundaries; nodes and canvas share one translated graph plane so pan and
 * Center cannot separate a line from its anchor.
 */
export function TopologyConnections({
  origins,
  connectedOrigins,
  runtimeConnected,
  viewKey,
  className,
}: TopologyConnectionsProps) {
  const layer = useRef<HTMLCanvasElement | null>(null);
  const connectedKey = origins.filter((origin) => connectedOrigins.has(origin)).join("|");

  useLayoutEffect(() => {
    const canvas = layer.current;
    const root = canvas?.parentElement;
    const context = canvas?.getContext("2d");
    if (!canvas || !root || !context) return;

    canvas.dataset.viewKey = `${connectedKey}:${viewKey}`;
    let frame = 0;
    let edges: readonly MeasuredEdge[] = [];
    let focus: string | null = null;
    let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const palette = getComputedStyle(root);
    const accent = cssColor(palette, "--dusky-accent", "#1c6b68");
    const capability = cssColor(palette, "--topology-capability", "#587069");

    const paint = (time: number) => {
      const bounds = canvas.getBoundingClientRect();
      context.clearRect(0, 0, bounds.width, bounds.height);
      context.lineCap = "round";
      context.lineJoin = "round";

      const sampled = new Map<string, readonly PathSample[]>();
      for (const edge of edges) {
        const related = focusMatches(edge, focus);
        const activeAlpha =
          edge.kind === "display"
            ? 0.78
            : edge.kind === "provider"
              ? 0.64
              : edge.kind === "actions"
                ? 0.56
                : 0.5;
        context.globalAlpha = related ? (edge.connected ? activeAlpha : 0.24) : 0.08;
        context.strokeStyle = edge.kind === "actions" ? capability : accent;
        context.lineWidth = edge.kind === "display" ? 1.8 : edge.kind === "provider" ? 1.5 : 1.35;
        context.setLineDash([]);
        trace(context, edge.segments);
        context.stroke();
        sampled.set(edge.id, samplesFor(edge.motionSegments ?? edge.segments));
      }

      context.setLineDash([]);
      if (!reducedMotion) {
        for (const [index, edge] of edges.entries()) {
          if (!edge.connected || !focusMatches(edge, focus)) continue;
          const samples = sampled.get(edge.id) ?? [];
          if (edge.kind === "display") {
            const progress = ((time + 420) % 4200) / 4200;
            drawTransferSignal(context, positionOn(samples, progress), accent, 13, 0.96);
            drawTransferSignal(
              context,
              positionOn(samples, 1 - ((time + 1880) % 5200) / 5200),
              accent,
              9,
              0.54,
              true,
            );
          } else if (edge.kind === "provider") {
            const duration = 5100 + index * 260;
            const progress = ((time + index * 740) % duration) / duration;
            drawTransferSignal(context, positionOn(samples, progress), accent, 9, 0.78);
            drawTransferSignal(
              context,
              positionOn(samples, 1 - ((time + index * 910 + 1900) % 6700) / 6700),
              accent,
              6,
              0.34,
              true,
            );
          } else if (edge.kind === "actions") {
            const duration = 5700 + index * 180;
            const progress = ((time + index * 680) % duration) / duration;
            drawTransferSignal(context, positionOn(samples, progress), capability, 7, 0.66);
          }
        }
      }

      context.globalAlpha = 1;
      const liveMotion =
        !reducedMotion &&
        edges.some(
          (edge) =>
            edge.connected &&
            (edge.kind === "display" || edge.kind === "provider" || edge.kind === "actions") &&
            focusMatches(edge, focus),
        );
      if (liveMotion) frame = requestAnimationFrame(paint);
    };

    const measure = () => {
      cancelAnimationFrame(frame);
      const bounds = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(bounds.width * ratio));
      canvas.height = Math.max(1, Math.round(bounds.height * ratio));
      context.setTransform(canvas.width / bounds.width, 0, 0, canvas.height / bounds.height, 0, 0);

      // Workspace owns the effective responsive layout. Reading that same value
      // keeps connector routing and card geometry in agreement at every width.
      const vertical = root.closest('[data-layout="vertical"]') !== null;
      const display = root.querySelector<HTMLElement>('[data-runtime-end="display"]');
      const browserIn = root.querySelector<HTMLElement>('[data-runtime-end="browser"]');
      const browserOut = root.querySelector<HTMLElement>('[data-provider-end="runtime"]');
      const providerPorts = origins
        .map((origin) => ({
          origin,
          element: Array.from(root.querySelectorAll<HTMLElement>("[data-provider-origin]")).find(
            (port) => port.dataset.providerOrigin === origin,
          ),
        }))
        .filter(
          (entry): entry is { origin: string; element: HTMLElement } => entry.element !== undefined,
        );

      const measured: MeasuredEdge[] = [];
      if (display && browserIn) {
        measured.push({
          id: "display-runtime",
          kind: "display",
          connected: runtimeConnected,
          segments: bowedCurve(
            anchorOf(display, bounds, vertical ? { x: 0, y: 1 } : { x: 1, y: 0 }),
            anchorOf(browserIn, bounds, vertical ? { x: 0, y: -1 } : { x: -1, y: 0 }),
            vertical ? 12 : -4,
          ),
        });
      }

      if (browserOut && providerPorts.length > 0) {
        const source = anchorOf(browserOut, bounds, vertical ? { x: 0, y: 1 } : { x: 1, y: 0 });
        for (const [index, target] of providerPorts.entries()) {
          const targetAnchor = anchorOf(
            target.element,
            bounds,
            vertical ? { x: 0, y: -1 } : { x: -1, y: 0 },
          );
          measured.push({
            id: `provider:${target.origin}`,
            kind: "provider",
            origin: target.origin,
            connected: connectedOrigins.has(target.origin),
            segments: vertical
              ? bowedCurve(source, targetAnchor, [-44, 38, -52][index] ?? 38)
              : [curve(source, targetAnchor)],
            motionSegments: undefined,
          });
        }
      }

      const actionPorts = Array.from(root.querySelectorAll<HTMLElement>("[data-action-origin]"));
      for (const origin of origins) {
        const provider = actionPorts.find(
          (port) => port.dataset.actionOrigin === origin && port.dataset.actionEnd === "provider",
        );
        const actions = actionPorts.find(
          (port) => port.dataset.actionOrigin === origin && port.dataset.actionEnd === "actions",
        );
        if (!provider || !actions) continue;
        measured.push({
          id: `actions:${origin}`,
          kind: "actions",
          origin,
          connected: connectedOrigins.has(origin),
          segments: bowedCurve(
            anchorOf(provider, bounds, vertical ? { x: 0, y: 1 } : { x: 1, y: 0 }),
            anchorOf(actions, bounds, vertical ? { x: 0, y: -1 } : { x: -1, y: 0 }),
            (origins.indexOf(origin) % 2 === 0 ? 1 : -1) * 3,
          ),
        });
      }

      edges = measured;
      canvas.dataset.runtimeTrunks = String(edges.filter((edge) => edge.kind === "display").length);
      canvas.dataset.providerBuses = "0";
      canvas.dataset.providerBranches = String(
        edges.filter((edge) => edge.kind === "provider").length,
      );
      canvas.dataset.runtimeEdges = String(
        edges.filter((edge) => edge.kind === "display" || edge.kind === "provider").length,
      );
      canvas.dataset.actionEdges = String(edges.filter((edge) => edge.kind === "actions").length);
      canvas.dataset.connectedOrigins = String(connectedOrigins.size);
      canvas.dataset.reducedMotion = String(reducedMotion);
      paint(performance.now());
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const repaint = () => {
      cancelAnimationFrame(frame);
      paint(performance.now());
    };
    const focusedFrom = (target: EventTarget | null): string | null => {
      if (!(target instanceof Element)) return null;
      return target.closest<HTMLElement>("[data-topology-focus]")?.dataset.topologyFocus ?? null;
    };
    const onPointerOver = (event: PointerEvent) => {
      const next = focusedFrom(event.target);
      if (next === focus) return;
      focus = next;
      repaint();
    };
    const onPointerLeave = () => {
      focus = null;
      repaint();
    };
    const onFocusIn = (event: FocusEvent) => {
      focus = focusedFrom(event.target);
      repaint();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) return;
      focus = null;
      repaint();
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    const topologyNodes = root.querySelectorAll<HTMLElement>("[data-topology-node]");
    for (const node of topologyNodes) {
      observer.observe(node);
    }
    const transformObserver = new MutationObserver(schedule);
    for (const node of topologyNodes) {
      transformObserver.observe(node, { attributes: true, attributeFilter: ["style"] });
    }
    const iframeListeners = Array.from(root.querySelectorAll<HTMLIFrameElement>("iframe")).map(
      (iframe) => {
        iframe.addEventListener("load", schedule);
        return () => iframe.removeEventListener("load", schedule);
      },
    );
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      schedule();
    };
    motion.addEventListener("change", onMotion);
    root.addEventListener("pointerover", onPointerOver);
    root.addEventListener("pointerleave", onPointerLeave);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    window.addEventListener("resize", schedule);
    void document.fonts.ready.then(schedule);
    measure();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      transformObserver.disconnect();
      iframeListeners.forEach((remove) => {
        remove();
      });
      motion.removeEventListener("change", onMotion);
      root.removeEventListener("pointerover", onPointerOver);
      root.removeEventListener("pointerleave", onPointerLeave);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("resize", schedule);
    };
  }, [origins, connectedOrigins, connectedKey, runtimeConnected, viewKey]);

  return (
    <canvas
      ref={layer}
      className={className}
      data-motion-item=""
      data-motion-kind="connections"
      data-motion-order="1"
    />
  );
}
