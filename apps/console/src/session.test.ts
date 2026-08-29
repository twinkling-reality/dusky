import { SESSION_CODE_LENGTH } from "@dusky/contracts";
import { describe, expect, it } from "vitest";
import { codeProblem, isCode, mintCode } from "./session.js";

describe("mintCode", () => {
  it("only ever mints codes this console would accept", () => {
    for (let i = 0; i < 200; i += 1) expect(isCode(mintCode())).toBe(true);
  });
});

describe("codeProblem", () => {
  it("says nothing about an empty field", () => {
    expect(codeProblem("")).toBeNull();
    expect(codeProblem("   ")).toBeNull();
  });

  it("says nothing about a code that will pair", () => {
    expect(codeProblem("DUSKYA")).toBeNull();
    // Whatever the field does with case, a lens shows capitals.
    expect(codeProblem("duskya")).toBeNull();
  });

  /*
   * The case this exists for. `JN4CB2` was typed in during a real session and
   * the Pair button simply stayed disabled, so the page's answer to a misread
   * character was nothing at all.
   */
  it("names the character that cannot be in a code", () => {
    expect(codeProblem("JN4CB2")).toBe("Codes are letters only, never I, L or O. Not 4, 2.");
  });

  it("names the letters the alphabet deliberately dropped", () => {
    // I, L and O are absent because they look like each other and like digits,
    // so they are rejected for the same reason a digit is.
    expect(codeProblem("ABCDEI")).toContain("Not I.");
    expect(codeProblem("ABCDLO")).toContain("Not L, O.");
  });

  it("counts letters rather than calling a short code invalid", () => {
    expect(codeProblem("ABC")).toBe(`3 of ${SESSION_CODE_LENGTH} letters.`);
    expect(codeProblem("ABCDEFG")).toBe(`7 of ${SESSION_CODE_LENGTH} letters.`);
  });

  it("reports an impossible character before a length problem", () => {
    // Someone who typed a digit needs to look at the lens again. Telling them
    // the code is too short would send them back to the keyboard instead.
    expect(codeProblem("JN4")).toContain("letters only");
  });

  it("agrees with isCode on every input", () => {
    for (const v of ["DUSKYA", "JN4CB2", "", "ABC", "ABCDEI", "ZZZZZZ", "abcdef"]) {
      if (v.trim() === "") continue;
      expect(codeProblem(v) === null).toBe(isCode(v));
    }
  });
});
