import { useLayoutEffect, useRef } from "react";

interface Point {
  x: number;
  y: number;
}

interface CubicSegment {
  from: Point;
  controlA: Point;
  controlB: Point;
  to: Point;
}

interface PairingConnectionsProps {
  leftProgress: number;
  rightProgress: number;
  ready: boolean;
  invalid: boolean;
  className?: string;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function mix(from: Point, to: Point, amount: number): Point {
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
  };
}

function centerOf(element: HTMLElement, canvas: DOMRect): Point {
  const bounds = element.getBoundingClientRect();
  return {
    x: bounds.left - canvas.left + bounds.width / 2,
    y: bounds.top - canvas.top + bounds.height / 2,
  };
}

function measuredCurve(
  from: Point,
  to: Point,
  fromNormal: Point,
  toNormal: Point,
  bend: number,
): CubicSegment {
  const span = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
  const handle = clamp(span * 0.4, 18, 112);
  const direction = { x: (to.x - from.x) / span, y: (to.y - from.y) / span };
  const offset = { x: -direction.y * bend, y: direction.x * bend };
  return {
    from,
    controlA: {
      x: from.x + fromNormal.x * handle + offset.x,
      y: from.y + fromNormal.y * handle + offset.y,
    },
    controlB: {
      x: to.x + toNormal.x * handle + offset.x,
      y: to.y + toNormal.y * handle + offset.y,
    },
    to,
  };
}

/** The first `amount` of a cubic, split exactly with de Casteljau's algorithm. */
export function partialCubic(segment: CubicSegment, amount: number): CubicSegment {
  const progress = clamp(amount, 0, 1);
  const a = mix(segment.from, segment.controlA, progress);
  const b = mix(segment.controlA, segment.controlB, progress);
  const c = mix(segment.controlB, segment.to, progress);
  const d = mix(a, b, progress);
  const e = mix(b, c, progress);
  return {
    from: segment.from,
    controlA: a,
    controlB: d,
    to: mix(d, e, progress),
  };
}

function pointOn(segment: CubicSegment, amount: number): Point {
  const t = clamp(amount, 0, 1);
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

function tangentOn(segment: CubicSegment, amount: number): Point {
  const t = clamp(amount, 0, 1);
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

function trace(context: CanvasRenderingContext2D, segment: CubicSegment): void {
  context.beginPath();
  context.moveTo(segment.from.x, segment.from.y);
  context.bezierCurveTo(
    segment.controlA.x,
    segment.controlA.y,
    segment.controlB.x,
    segment.controlB.y,
    segment.to.x,
    segment.to.y,
  );
}

function cssColor(style: CSSStyleDeclaration, property: string, fallback: string): string {
  return style.getPropertyValue(property).trim() || fallback;
}

function drawSignal(
  context: CanvasRenderingContext2D,
  segment: CubicSegment,
  progress: number,
  color: string,
): void {
  const point = pointOn(segment, progress);
  const tangent = tangentOn(segment, progress);
  const angle = Math.atan2(tangent.y, tangent.x);
  context.save();
  context.translate(point.x, point.y);
  context.rotate(angle);
  context.fillStyle = color;
  context.shadowColor = color;
  context.shadowBlur = 5;
  context.beginPath();
  context.moveTo(-7, -1.5);
  context.lineTo(2.4, 0);
  context.lineTo(-7, 1.5);
  context.lineTo(-4.6, 0);
  context.closePath();
  context.fill();
  context.restore();
}

/**
 * A high-DPI connection layer measured from the four actual DOM ports. The
 * browser-to-code and code-to-display paths therefore survive every responsive
 * layout without relying on authored SVG coordinates.
 */
export function PairingConnections({
  leftProgress,
  rightProgress,
  ready,
  invalid,
  className,
}: PairingConnectionsProps) {
  const layer = useRef<HTMLCanvasElement | null>(null);

  useLayoutEffect(() => {
    const canvas = layer.current;
    const root = canvas?.parentElement;
    const context = canvas?.getContext("2d");
    if (!canvas || !root || !context) return;

    let frame = 0;
    let left: CubicSegment | null = null;
    let right: CubicSegment | null = null;
    let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const palette = getComputedStyle(root);
    const accent = cssColor(palette, "--dusky-accent", "#1c6b68");
    const hair = cssColor(palette, "--dusky-hair", "#d8d4c8");
    const stop = cssColor(palette, "--dusky-stop", "#a9473e");

    const paint = (time: number) => {
      const bounds = canvas.getBoundingClientRect();
      context.clearRect(0, 0, bounds.width, bounds.height);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.setLineDash([]);

      if (!left || !right) return;
      context.globalAlpha = 0.72;
      context.strokeStyle = hair;
      context.lineWidth = 1.35;
      trace(context, left);
      context.stroke();
      trace(context, right);
      context.stroke();

      const activeColor = invalid ? stop : accent;
      context.globalAlpha = invalid ? 0.76 : 0.9;
      context.strokeStyle = activeColor;
      context.lineWidth = 1.85;
      if (leftProgress > 0) {
        trace(context, partialCubic(left, leftProgress));
        context.stroke();
      }
      if (rightProgress > 0) {
        trace(context, partialCubic(right, rightProgress));
        context.stroke();
      }

      if (ready && !reducedMotion) {
        context.globalAlpha = 0.95;
        const phase = (time % 3600) / 3600;
        if (phase < 0.46) drawSignal(context, left, phase / 0.46, accent);
        if (phase > 0.54) drawSignal(context, right, (phase - 0.54) / 0.46, accent);
        frame = requestAnimationFrame(paint);
      }
      context.globalAlpha = 1;
    };

    const measure = () => {
      cancelAnimationFrame(frame);
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(bounds.width * ratio));
      canvas.height = Math.max(1, Math.round(bounds.height * ratio));
      context.setTransform(canvas.width / bounds.width, 0, 0, canvas.height / bounds.height, 0, 0);

      const browser = root.querySelector<HTMLElement>('[data-pair-anchor="browser"]');
      const codeIn = root.querySelector<HTMLElement>('[data-pair-anchor="code-in"]');
      const codeOut = root.querySelector<HTMLElement>('[data-pair-anchor="code-out"]');
      const display = root.querySelector<HTMLElement>('[data-pair-anchor="display"]');
      if (!browser || !codeIn || !codeOut || !display) {
        left = null;
        right = null;
        canvas.dataset.measuredEdges = "0";
        paint(performance.now());
        return;
      }

      const vertical = bounds.width <= 999;
      left = measuredCurve(
        centerOf(browser, bounds),
        centerOf(codeIn, bounds),
        vertical ? { x: 0, y: 1 } : { x: 1, y: 0 },
        vertical ? { x: 0, y: -1 } : { x: -1, y: 0 },
        vertical ? -10 : -9,
      );
      right = measuredCurve(
        centerOf(codeOut, bounds),
        centerOf(display, bounds),
        vertical ? { x: 0, y: 1 } : { x: 1, y: 0 },
        vertical ? { x: 0, y: -1 } : { x: -1, y: 0 },
        vertical ? 10 : 9,
      );
      canvas.dataset.measuredEdges = "2";
      canvas.dataset.orientation = vertical ? "vertical" : "horizontal";
      paint(performance.now());
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    for (const node of root.querySelectorAll<HTMLElement>("[data-pair-node]")) {
      observer.observe(node);
    }
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      schedule();
    };
    motion.addEventListener("change", onMotion);
    window.addEventListener("resize", schedule);
    void document.fonts.ready.then(schedule);
    measure();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener("change", onMotion);
      window.removeEventListener("resize", schedule);
    };
  }, [leftProgress, rightProgress, ready, invalid]);

  return <canvas ref={layer} className={className} />;
}
