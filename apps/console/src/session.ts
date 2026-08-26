import { SESSION_CODE_ALPHABET, SESSION_CODE_LENGTH } from "@dusky/contracts";

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

/** A code is only a code if it could have come off a lens. */
export function isCode(raw: string): boolean {
  const v = raw.trim().toUpperCase();
  if (v.length !== SESSION_CODE_LENGTH) return false;
  return [...v].every((c) => SESSION_CODE_ALPHABET.includes(c));
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
