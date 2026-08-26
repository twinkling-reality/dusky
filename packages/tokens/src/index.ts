/**
 * Design tokens as typed constants, mirroring src/tokens.css.
 *
 * The CSS file is the source of truth for rendering; these constants exist so
 * canvas drawing and inline SVG can reach the same values without duplicating
 * hex codes across surfaces.
 */

export const DISPLAY = {
  /** Meta Ray-Ban Display renders a fixed 600x600 viewport with no scrolling. */
  width: 600,
  height: 600,
  /** Meta's documented minimum interactive target on the waveguide. */
  minTarget: 88,
  /** Meta's documented type floors: 16px body, 20-24px primary content. */
  minBodyPx: 16,
  minPrimaryPx: 20,
} as const;

/**
 * The Display palette is not a dark theme. The waveguide is additive, so a
 * black pixel emits nothing and is genuinely transparent against the room.
 * Colours here are chosen as emitted light, not as ink on a dark ground.
 */
export const EMIT = {
  ground: "#000000",
  dim: "#93AEAC",
  body: "#B9CFCD",
  bright: "#F2FCFB",
  accent: "#6FD6D2",
  ok: "#7FCFA0",
  warn: "#D8B471",
  danger: "#DB8C80",
} as const;
