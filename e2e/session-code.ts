import { randomBytes } from "node:crypto";
import { SESSION_CODE_ALPHABET, SESSION_CODE_LENGTH } from "../packages/contracts/src/index.ts";

/** A valid pairing code that cannot reconnect to state from an earlier test run. */
export function freshCode(): string {
  return Array.from(
    randomBytes(SESSION_CODE_LENGTH),
    (byte) => SESSION_CODE_ALPHABET[byte % SESSION_CODE_ALPHABET.length],
  ).join("");
}
