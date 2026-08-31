import type { Choice, ToolDescriptor } from "@dusky/contracts";
import { idleFrame, siteFromChoice, toolId } from "@dusky/frames";
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

/** Every row on one screen, following "More" but not stepping into a site. */
const rowsOf = (tools: ToolDescriptor[], site?: string): Choice[] => {
  const out: Choice[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < 64; page += 1) {
    const f = idleFrame("Src", tools, page, true, undefined, site ? { site } : {});
    if (f.kind !== "idle") throw new Error("unreachable");
    let wrapped = false;
    for (const c of f.choices) {
      if (c.id === "__more" || c.id === "__compose" || c.id === "__home") continue;
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

/** Each screen of tool rows a wearer can land on, kept apart. */
const menuScreens = (tools: ToolDescriptor[]): Choice[][] => {
  const top = rowsOf(tools);
  const sites = top.map((c) => siteFromChoice(c.id)).filter((o): o is string => o !== null);
  return sites.length > 0 ? sites.map((site) => rowsOf(tools, site)) : [top];
};

/**
 * Every tool row a wearer can reach, in the order they can reach it.
 *
 * Eleven tools across four sites do not fit a four-row panel, so the top of
 * the menu is a row per site and each site's actions sit behind it. The walk
 * follows both, because what these tests are about is what a wearer can get to
 * and in what order, not how the rows happen to be split across frames.
 */
const menuChoices = (tools: ToolDescriptor[]): Choice[] => menuScreens(tools).flat();

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
    // Per SCREEN, because a screen is what a wearer sees. Sorting the four
    // sites' menus end to end would be asserting about a list nobody is shown,
    // and it would fail for a reason that harms nobody: one site's read below
    // another site's write, on a frame they are not both on.
    const classes = new Set(menuChoices(ALL_TOOLS).map((c) => classify(toolFor(c.id))));
    expect(classes.size, "the corpus must reach every class or this asserts nothing").toBe(4);
    for (const screen of menuScreens(ALL_TOOLS)) {
      const ranks = screen.map((c) => CEREMONY[classify(toolFor(c.id))]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  /**
   * `useDpad` focuses row zero of whichever frame is on screen, so whatever
   * sits there is one Enter away from happening.
   *
   * Eleven tools across four sites do not fit, so the frame a wearer lands on
   * without asking is a row per site. Every row on it is navigation, which
   * cannot cost anybody anything: a stronger version of the guarantee than the
   * one this test was written for, where the best available was "the cheapest
   * tools come first".
   */
  it("fills the frame a wearer lands on with things that cannot cost them anything", () => {
    const f = idleFrame("Src", ALL_TOOLS, 0, true);
    if (f.kind !== "idle") throw new Error("unreachable");
    const rows = f.choices.filter((c) => c.id !== "__more" && c.id !== "__compose");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(siteFromChoice(row.id), row.id).not.toBe(null);

    // And inside a site, where a press does cost something, the cheapest still
    // comes first.
    for (const screen of menuScreens(ALL_TOOLS)) {
      const first = screen[0];
      if (!first) continue;
      const offersRead = screen.some((c) => classify(toolFor(c.id)) === "read");
      if (offersRead) expect(classify(toolFor(first.id))).toBe("read");
    }
  });
});
