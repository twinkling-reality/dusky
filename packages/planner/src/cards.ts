/**
 * Tool cards: the only representation of a tool a model is ever shown.
 *
 * Two jobs, and the second is the important one.
 *
 * COMPACTION. A `ToolDescriptor` carries a full JSON Schema. Sending that
 * verbatim, for every tool, on every turn, is how a planner becomes slow and
 * expensive. A card is a few lines of text, compiled once per tool version and
 * cached, so re-planning against an unchanged registry costs no new work.
 *
 * CONTAINMENT. Everything except `origin` in a `ToolDescriptor` was written by
 * a third-party website with an interest in what the model decides. A tool
 * description is therefore untrusted input being placed into a prompt, which
 * is the textbook prompt-injection surface. The renderer treats it as data:
 *
 *   - control characters are stripped,
 *   - ALL whitespace collapses to single spaces, so injected text cannot open
 *     a new line and impersonate a card field or an additional card,
 *   - the text is truncated,
 *   - and the value is quoted, with quotes removed from the text first so it
 *     cannot close its own delimiter and write freely after it.
 *
 * The result is that a hostile description can still ARGUE with the model,
 * which no amount of escaping prevents, but it cannot forge structure. Arguing
 * is survivable because nothing the model says is trusted: @dusky/policy
 * decides ceremony and `planner.ts` re-checks every name the model returns.
 */

import type { ToolDescriptor } from "@dusky/contracts";
import { type ParamSpec, parameters } from "@dusky/frames";
import { classify } from "@dusky/policy";

const MAX_DESCRIPTION = 240;
const MAX_PARAM_DESCRIPTION = 96;
const MAX_ENUM_VALUES = 8;

/**
 * Render site-authored text as a single-line, quoted value.
 *
 * Quotes are stripped from the text before wrapping, which is what stops a
 * description from closing its own delimiter and writing instructions after.
 */
export function safeText(raw: string, max: number): string {
  const flat = raw
    // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/"/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const clipped = flat.length > max ? `${flat.slice(0, max).trimEnd()}...` : flat;
  return `"${clipped}"`;
}

/** How much ceremony this tool costs the wearer, in the model's terms. */
function ceremony(tool: ToolDescriptor): string {
  const c = classify(tool);
  return c === "read" ? "runs immediately" : `stops for the wearer's approval (${c})`;
}

function renderParam(p: ParamSpec): string {
  const bits = [`${p.name}: ${p.kind}`];
  if (p.required) bits.push("required");
  if (p.kind === "unsupported") bits.push("cannot be collected on the display");
  const en = p.schema["enum"];
  if (Array.isArray(en) && en.length > 0) {
    const shown = en.slice(0, MAX_ENUM_VALUES).map((v) => String(v));
    bits.push(`one of ${shown.join(", ")}${en.length > shown.length ? ", ..." : ""}`);
  }
  const head = `  - ${bits.join(", ")}`;
  return p.description ? `${head} ${safeText(p.description, MAX_PARAM_DESCRIPTION)}` : head;
}

/**
 * Compile one tool into the lines a model sees.
 *
 * `origin` is on the card because it is the one field the BROWSER supplies
 * rather than the site, so it is the only identity here that cannot be forged.
 */
export function renderCard(tool: ToolDescriptor): string {
  const lines = [`- tool: ${tool.name}`, `  from: ${tool.origin}`, `  ${ceremony(tool)}`];
  if (tool.title?.trim()) lines.push(`  titled ${safeText(tool.title, MAX_DESCRIPTION)}`);
  lines.push(`  says ${safeText(tool.description, MAX_DESCRIPTION)}`);
  const params = parameters(tool);
  if (params.length === 0) {
    lines.push("  takes no arguments");
  } else {
    lines.push("  arguments:");
    for (const p of params) lines.push(renderParam(p));
  }
  return lines.join("\n");
}

/**
 * Identity of a tool VERSION.
 *
 * Anything that can change the rendered card must change this key, or the
 * cache serves a card describing a tool that no longer exists. A site may
 * replace a tool's schema without changing its name, so the schema is in here.
 */
export function cardKey(tool: ToolDescriptor): string {
  return JSON.stringify([
    tool.origin,
    tool.name,
    tool.title ?? "",
    tool.description,
    tool.inputSchema,
    tool.annotations.readOnlyHint,
  ]);
}

/**
 * A bounded cache of compiled cards.
 *
 * Keyed by tool version, so a registry that has not changed compiles once no
 * matter how many turns a task takes. Bounded because the key space is
 * controlled by the sites we visit, and an unbounded map keyed on foreign
 * input is a memory leak with extra steps.
 */
export class CardCache {
  private readonly entries = new Map<string, string>();
  private hitCount = 0;
  private missCount = 0;

  constructor(private readonly limit = 256) {}

  card(tool: ToolDescriptor): string {
    const key = cardKey(tool);
    const hit = this.entries.get(key);
    if (hit !== undefined) {
      // Re-insert so the most recently used entry is the last to be evicted.
      this.entries.delete(key);
      this.entries.set(key, hit);
      this.hitCount += 1;
      return hit;
    }
    this.missCount += 1;
    const built = renderCard(tool);
    this.entries.set(key, built);
    if (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    return built;
  }

  /** Render a shortlist as one block, in the caller's ranking order. */
  block(tools: ToolDescriptor[]): string {
    return tools.map((t) => this.card(t)).join("\n");
  }

  stats(): { hits: number; misses: number; size: number } {
    return { hits: this.hitCount, misses: this.missCount, size: this.entries.size };
  }
}
