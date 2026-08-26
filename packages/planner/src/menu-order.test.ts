import type { Choice, ToolDescriptor } from "@dusky/contracts";
import { idleFrame, toolId } from "@dusky/frames";
import { classify } from "@dusky/policy";
import { describe, expect, it } from "vitest";
import { ALL_TOOLS } from "./eval.fixtures.js";

/**
 * The wearer's menu, measured against the corpus rather than against a shop.
 *
 * `packages/frames` owns the ordering and tests it there. This file exists
 * because the honest question about any ordering rule is whether it survives
 * sites nobody here built, and the eleven tools across four domains that
 * `eval.fixtures.ts` already holds are the closest thing this repository has
 * to that. It lives in `packages/planner` because the corpus does and because
 * this package already depends on `@dusky/frames`; the same import from the
 * frames test would be a cycle.
 *
 * Nothing here names a tool. Every expectation is derived from
 * `packages/policy`, which is the point: if the rule needed a list of names to
 * hold, it would be a per-site branch wearing a comparator costume.
 */

const CEREMONY = { read: 0, write: 1, financial: 2, destructive: 3 } as const;

/** Every tool row a wearer can page to, in the order they can page to it. */
const menuChoices = (tools: ToolDescriptor[]): Choice[] => {
  const out: Choice[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < 64; page += 1) {
    const f = idleFrame("Src", tools, page, true);
    if (f.kind !== "idle") throw new Error("unreachable");
    let wrapped = false;
    for (const c of f.choices) {
      if (c.id === "__more" || c.id === "__compose") continue;
      if (seen.has(c.id)) {
        wrapped = true;
        break;
      }
      seen.add(c.id);
      out.push(c);
    }
    if (wrapped || !f.choices.some((c) => c.id === "__more")) break;
  }
  return out;
};

const toolFor = (id: string): ToolDescriptor => {
  const hit = ALL_TOOLS.find((t) => toolId(t) === id);
  if (!hit) throw new Error(`no tool for ${id}`);
  return hit;
};

describe("a menu built from four domains at once", () => {
  it("reaches every tool and reaches them in the same order every time", () => {
    const forwards = menuChoices(ALL_TOOLS).map((c) => c.id);
    expect(forwards).toHaveLength(ALL_TOOLS.length);

    const rotate = (n: number) => [...ALL_TOOLS.slice(n), ...ALL_TOOLS.slice(0, n)];
    for (let n = 1; n < ALL_TOOLS.length; n += 1) {
      expect(
        menuChoices(rotate(n)).map((c) => c.id),
        `rotated by ${n}`,
      ).toEqual(forwards);
    }
    expect(
      menuChoices([...ALL_TOOLS].reverse()).map((c) => c.id),
      "reversed",
    ).toEqual(forwards);
  });

  it("never offers a consequential row above a read", () => {
    const ranks = menuChoices(ALL_TOOLS).map((c) => CEREMONY[classify(toolFor(c.id))]);
    expect(new Set(ranks).size, "the corpus must reach every class or this asserts nothing").toBe(
      4,
    );
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  /**
   * Eleven tools is three pages once "More" and the composer have taken their
   * slots, and `useDpad` focuses row zero of whichever page is on screen. The
   * first page is the one a wearer lands on without asking for it.
   */
  it("fills the page a wearer lands on with things that cannot cost them anything", () => {
    const f = idleFrame("Src", ALL_TOOLS, 0, true);
    if (f.kind !== "idle") throw new Error("unreachable");
    const rows = f.choices.filter((c) => c.id !== "__more" && c.id !== "__compose");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(classify(toolFor(row.id))).toBe("read");
  });
});
