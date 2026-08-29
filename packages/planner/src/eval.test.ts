import { parameters, shareableProjectionsFromResult, valueForParam } from "@dusky/frames";
import { describe, expect, it } from "vitest";
import { ALL_TOOLS, COMPOUND_CORPUS, CORPUS, HANDOFF_CORPUS } from "./eval.fixtures.js";
import { shortlist } from "./rank.js";

/**
 * Measuring the one number here that can be measured for free.
 *
 * `shortlistSize: 6` decides what a model is even allowed to consider. A tool
 * that misses the shortlist cannot be picked however good the model is, so
 * recall at that size is the hard ceiling on planner accuracy, and it was
 * chosen by reasoning rather than by counting. Ranking is deterministic and
 * has no model in it, so this costs nothing and needs no credential.
 *
 * It is a floor, not a benchmark. Twenty-one labelled requests over thirteen tools
 * from four domains will not tell anyone the true recall of this ranker; it
 * will tell them whether six is obviously too small, and it will fail loudly
 * if somebody makes the ranking worse.
 */

const recallAt = (limit: number): { hit: number; missed: string[] } => {
  const missed: string[] = [];
  let hit = 0;
  for (const c of CORPUS) {
    const names = shortlist(c.intent, ALL_TOOLS, limit).map((r) => r.tool.name);
    if (names.includes(c.expect)) hit += 1;
    else missed.push(`${c.intent} -> wanted ${c.expect}, got ${names.join(", ") || "nothing"}`);
  }
  return { hit, missed };
};

describe("how much the shortlist has to hold", () => {
  it("reports recall at each size, so the choice is a measurement", () => {
    const table = [2, 3, 4, 6, 8, ALL_TOOLS.length].map((k) => {
      const { hit } = recallAt(k);
      return `  ${String(k).padStart(2)}: ${hit}/${CORPUS.length}`;
    });
    console.log(`recall by shortlist size over ${ALL_TOOLS.length} tools\n${table.join("\n")}`);
    expect(table.length).toBeGreaterThan(0);
  });

  /**
   * The measured value, as a regression guard rather than as a target.
   *
   * 18/21 at the shipped size of six. The communications source added two
   * labelled requests and two tools while keeping all but three answers in the
   * shortlist. Before that addition it was 16/19, up from 14 after both sides of lexical
   * matching reduced ordinary action synonyms to the same concept, so `find`
   * can admit a `search` tool and `tell` can admit a `send_message` tool without
   * adding a business noun to the ranker. The change also takes joint coverage
   * over the then-current compound corpus from 3/4 to 4/4 at the same size.
   *
   * The 14 was itself 13 until leftover slots started being shared between
   * origins instead of handed out in rank order, which with every score at
   * zero is alphabetical order. That change was made for a security reason,
   * because one site could otherwise name its way to every slot and starve the
   * others. Both gains were measured after the rule that produced them.
   *
   * Going to the whole registry still buys them all, so the binding constraint
   * is still not the SIZE: it is that lexical ranking puts `find_times` above
   * `search_products` for "find me some oat milk", because the word "find" is
   * in one name and nothing in the other matches at all.
   *
   * That is the case the model tier exists for, and it is also why this number
   * should not be read as planner accuracy. What it does say is that six slots
   * are not the thing to spend effort on next.
   */
  it("keeps the right tool reachable at the size actually shipped", () => {
    const { hit, missed } = recallAt(6);
    expect(hit, `missed:\n${missed.join("\n")}`).toBeGreaterThanOrEqual(18);
  });

  it("never drops a tool it had room for", () => {
    // A shortlist as large as the registry has no excuse: every tool fits.
    // It used to return only the tools with a nonzero score, so three matches
    // meant three cards even with the whole list available.
    const { hit, missed } = recallAt(ALL_TOOLS.length);
    expect(hit, `missed with every slot free:\n${missed.join("\n")}`).toBe(CORPUS.length);
  });

  it("is worth having at all, which means it must lose something", () => {
    // A shortlist that never drops the answer at size 2 would mean the corpus
    // is paraphrasing tool names rather than saying what a person says.
    const { hit } = recallAt(2);
    expect(hit, "the corpus is too easy to be measuring anything").toBeLessThan(CORPUS.length);
  });

  it("does not get worse as it gets bigger", () => {
    let last = -1;
    for (const k of [2, 3, 4, 6, 8]) {
      const { hit } = recallAt(k);
      expect(hit, `recall fell going to ${k}`).toBeGreaterThanOrEqual(last);
      last = hit;
    }
  });
});

describe("result-to-argument handoff coverage", () => {
  it("keeps an exact compatible projection for every fixture", () => {
    const missed: string[] = [];
    for (const fixture of HANDOFF_CORPUS) {
      const param = parameters(fixture.destination).find(
        (candidate) => candidate.name === fixture.argument,
      );
      if (!param) {
        missed.push(`${fixture.name} -> destination argument missing`);
        continue;
      }
      const compatible = shareableProjectionsFromResult(fixture.result).filter(
        (projection) => valueForParam(projection.value, param) !== undefined,
      );
      if (!compatible.some((projection) => projection.location === fixture.expectLocation)) {
        missed.push(
          `${fixture.name} -> wanted ${fixture.expectLocation}, got ${compatible.map((projection) => projection.location).join(", ")}`,
        );
      }
    }
    console.log(
      `result handoff coverage: ${HANDOFF_CORPUS.length - missed.length}/${HANDOFF_CORPUS.length}`,
    );
    expect(missed, missed.join("\n")).toEqual([]);
  });
});

describe("a shortlist for a task with several actions", () => {
  it("keeps every requested action reachable at the shipped size", () => {
    const missed: string[] = [];
    for (const task of COMPOUND_CORPUS) {
      const names = shortlist(task.intent, ALL_TOOLS, 6).map((ranked) => ranked.tool.name);
      const absent = task.expect.filter((name) => !names.includes(name));
      if (absent.length > 0) {
        missed.push(`${task.intent} -> missed ${absent.join(", ")}; got ${names.join(", ")}`);
      }
    }
    console.log(
      `compound shortlist coverage at 6: ${COMPOUND_CORPUS.length - missed.length}/${COMPOUND_CORPUS.length}`,
    );
    expect(missed, missed.join("\n")).toEqual([]);
  });
});
