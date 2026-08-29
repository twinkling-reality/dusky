import { isSessionCode, SESSION_CODE_ALPHABET, SESSION_CODE_LENGTH } from "@dusky/contracts";

/**
 * Starting a session from the website rather than from a pair of glasses.
 *
 * Normally the Display mints a code and a human reads it off the lens. A judge
 * has no lens, so the website mints one instead and hands it to an embedded
 * Display. Same code, same relay, same everything: the only thing that changed
 * is which end of the pair spoke first.
 */
export function mintCode(): string {
  const bytes = new Uint8Array(SESSION_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => SESSION_CODE_ALPHABET[b % SESSION_CODE_ALPHABET.length]).join("");
}

/**
 * A code is only a code if it could have come off a lens.
 *
 * The rule itself lives in `@dusky/contracts`, because the relay has to apply
 * the same one and a check that only runs in the browser protects nobody.
 */
export const isCode = isSessionCode;

/**
 * Why a typed code cannot be used yet, or null when there is nothing to say.
 *
 * The Pair button is disabled until `isCode` passes, and on its own that is
 * silence. Somebody who misreads one character off a waveguide presses a
 * button that does nothing and is told nothing, which is the same failure the
 * letters-only alphabet was introduced to end, arriving through the console
 * instead of through the lens. `JN4CB2` was typed into this field during a
 * real session and the page had no answer for it.
 *
 * Naming the offending character matters more than saying "invalid". The whole
 * point of the alphabet is that a digit can never be part of a code, so being
 * told there is no `4` sends someone back to the lens, while "invalid code"
 * sends them back to the keyboard to type the same thing again.
 */
export function codeProblem(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  if (v === "") return null;
  const bad = [...new Set(v)].filter((ch) => !SESSION_CODE_ALPHABET.includes(ch));
  if (bad.length > 0) return `Codes are letters only, never I, L or O. Not ${bad.join(", ")}.`;
  if (v.length !== SESSION_CODE_LENGTH) return `${v.length} of ${SESSION_CODE_LENGTH} letters.`;
  return null;
}

/**
 * How this session got here.
 *
 * `embedded` means the website minted the code and is showing the Display in
 * an iframe, which is the no-glasses path. `glasses` means a human typed a
 * code they read off a waveguide, and the iframe must NOT be shown: the relay
 * allows one Display per session and attaching a second closes the first, so
 * an embedded panel would quietly disconnect the actual glasses.
 */
export type PairMode = "embedded" | "glasses";
