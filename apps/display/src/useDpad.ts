import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The entire input surface of Meta Ray-Ban Display.
 *
 * The glasses OS translates Neural Band pinches and temple captouch swipes
 * into ordinary keyboard events, so this hook is deliberately just a keyboard
 * handler. That is also why the same build runs unmodified in Chrome: a judge
 * pressing arrow keys is using the identical code path as the wearer.
 *
 * Focus is managed explicitly rather than left to the browser. React can
 * reorder or replace DOM nodes between frames, and `document.activeElement`
 * would silently reset to <body>, which on a cursorless device means the
 * wearer is stranded with no way to select anything.
 */

export const DPAD = {
  UP: "ArrowUp",
  DOWN: "ArrowDown",
  LEFT: "ArrowLeft",
  RIGHT: "ArrowRight",
  SELECT: "Enter",
  BACK: "Escape",
} as const;

export interface DpadOptions {
  /** Number of focusable items in the current frame. */
  count: number;
  /** Resets focus to the top whenever this changes, i.e. on a new frame. */
  frameKey: string;
  onSelect: (index: number) => void;
  onBack: () => void;
  enabled?: boolean;
}

export interface Dpad {
  index: number;
  /** Attach to each focusable element so the hook can move real DOM focus. */
  register: (i: number) => (el: HTMLElement | null) => void;
}

export function useDpad({ count, frameKey, onSelect, onBack, enabled = true }: DpadOptions): Dpad {
  const [index, setIndex] = useState(0);
  const items = useRef<(HTMLElement | null)[]>([]);

  // A new frame always starts at the first choice. Carrying focus across
  // frames would let a wearer confirm something while looking at the previous
  // screen's highlight.
  // biome-ignore lint/correctness/useExhaustiveDependencies: frameKey is the trigger, not a read value
  useEffect(() => {
    setIndex(0);
  }, [frameKey]);

  // Move real focus, so the platform, assistive tech and :focus styling agree.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus must also re-run on a new frame, whose refs were just replaced
  useEffect(() => {
    if (!enabled) return;
    const el = items.current[index];
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [index, frameKey, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case DPAD.UP:
        case DPAD.LEFT:
          if (count > 0) setIndex((i) => (i - 1 + count) % count);
          break;
        case DPAD.DOWN:
        case DPAD.RIGHT:
          if (count > 0) setIndex((i) => (i + 1) % count);
          break;
        case DPAD.SELECT:
          if (count > 0) onSelect(index);
          break;
        case DPAD.BACK:
          onBack();
          break;
        default:
          // Never preventDefault on keys we do not handle: the on-glasses
          // composer needs ordinary typing to reach focused text fields.
          return;
      }
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count, index, onSelect, onBack, enabled]);

  const register = useCallback(
    (i: number) => (el: HTMLElement | null) => {
      items.current[i] = el;
    },
    [],
  );

  return { index, register };
}
