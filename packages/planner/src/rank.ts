/**
 * Deterministic tool ranking.
 *
 * This file exists so a model never sees a whole tool registry. A site may
 * register dozens of tools and a wearer's request concerns one of them, so we
 * narrow the field with lexical evidence first and spend model tokens only on
 * the shortlist.
 *
 * No model, no network, no DOM. Every score here is reproducible from its
 * inputs, which is what makes the escalation rules in `planner.ts` testable.
 *
 * Ranking is ADVERSARIAL INPUT HANDLING, not just relevance. A tool's name,
 * title and description are written by the site, and a site that wants to be
 * chosen for every request will stuff its description with likely words. Two
 * rules contain that:
 *
 *   1. Evidence is weighted by how hard it is to abuse. A tool NAME is what
 *      the site must also call itself in code and what the wearer sees on the
 *      confirmation frame, so it is worth the most. A description is free text
 *      and is worth the least.
 *   2. Description evidence is CAPPED. No amount of keyword stuffing can push
 *      a tool past one whose name genuinely matches.
 *
 * Ranking cannot make anything unsafe on its own: a high rank only buys a tool
 * a place on the shortlist. Whether it may run without a human is decided in
 * @dusky/policy, which never consults this file.
 */

import type { ToolDescriptor } from "@dusky/contracts";

/** Weights, highest first. Name evidence outranks any amount of prose. */
const NAME_WEIGHT = 3;
const TITLE_WEIGHT = 2;
const DESCRIPTION_WEIGHT = 1;

/**
 * The most a description may contribute, in units of DESCRIPTION_WEIGHT.
 * A stuffed description saturates here and can never outscore a real name
 * match, which is worth NAME_WEIGHT per matched token.
 */
const DESCRIPTION_CAP = 1.5;

/** Only this much of a description is read. Keyword walls buy nothing. */
const DESCRIPTION_SCAN_CHARS = 400;

/**
 * Words that carry no selection signal. Deliberately short: this is not
 * linguistics, it is stopping "the" from making everything look relevant.
 */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "get",
  "has",
  "have",
  "i",
  "if",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "s",
  "should",
  "so",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "up",
  "want",
  "was",
  "we",
  "were",
  "what",
  "when",
  "which",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

/** Lowercase word tokens, punctuation and separators removed. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Intent tokens worth matching on: no stopwords, no duplicates. */
export function intentTokens(intent: string): string[] {
  const seen = new Set<string>();
  for (const t of tokenize(intent)) {
    if (t.length < 2 || STOPWORDS.has(t)) continue;
    seen.add(t);
  }
  return [...seen];
}

/**
 * Match a token against a field's tokens.
 *
 * A full token match counts fully; a prefix match of at least four characters
 * counts half, so "search" still finds "searches" without "car" finding
 * "cart". Stemming would be more accurate and far less predictable.
 */
function tokenHit(needle: string, hay: Set<string>, hayList: string[]): number {
  if (hay.has(needle)) return 1;
  if (needle.length < 4) return 0;
  return hayList.some((h) => h.startsWith(needle) || needle.startsWith(h)) ? 0.5 : 0;
}

export interface RankedTool {
  tool: ToolDescriptor;
  score: number;
  /** Which intent tokens matched, for diagnostics and for tests. */
  matched: string[];
}

/**
 * Score one tool against an intent.
 *
 * Exported for tests. The absolute number means nothing on its own; only
 * comparisons between tools scored in the same call are meaningful.
 */
export function scoreTool(tool: ToolDescriptor, tokens: string[]): RankedTool {
  const nameList = tokenize(tool.name);
  const name = new Set(nameList);
  const titleList = tokenize(tool.title ?? "");
  const title = new Set(titleList);
  const descList = tokenize(tool.description.slice(0, DESCRIPTION_SCAN_CHARS));
  const desc = new Set(descList);

  let score = 0;
  let descriptionScore = 0;
  const matched: string[] = [];

  for (const t of tokens) {
    const n = tokenHit(t, name, nameList);
    const ti = tokenHit(t, title, titleList);
    const d = tokenHit(t, desc, descList);
    if (n === 0 && ti === 0 && d === 0) continue;
    matched.push(t);
    score += n * NAME_WEIGHT + ti * TITLE_WEIGHT;
    descriptionScore += d * DESCRIPTION_WEIGHT;
  }

  // The cap is the whole defence against a stuffed description.
  score += Math.min(descriptionScore, DESCRIPTION_CAP);

  // An intent that names the tool outright is not a keyword coincidence.
  if (tokens.length > 0 && nameList.length > 0 && nameList.every((n) => tokens.includes(n))) {
    score += NAME_WEIGHT;
  }

  return { tool, score, matched };
}

/**
 * Rank tools against an intent, best first.
 *
 * Ties are broken by name so the order is stable across calls. `getTools`
 * ordering is the browser's business and must never leak into a decision.
 */
export function rank(intent: string, tools: ToolDescriptor[]): RankedTool[] {
  const tokens = intentTokens(intent);
  return tools
    .map((t) => scoreTool(t, tokens))
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
}

/**
 * The tools a model is permitted to see for this intent.
 *
 * Tools with lexical evidence win the slots. When NOTHING matches we still
 * send the first `limit` tools rather than none, because a wearer phrasing a
 * request in words the site does not use is common and is exactly the case a
 * model is good at. The cap is what matters: the model never sees the whole
 * registry either way.
 */
export function shortlist(intent: string, tools: ToolDescriptor[], limit: number): RankedTool[] {
  const ranked = rank(intent, tools);
  const matched = ranked.filter((r) => r.score > 0);

  // Matches first, then fill the remaining slots in rank order.
  //
  // This used to return ONLY the matches whenever there was at least one, so
  // three matching tools meant a shortlist of three even with six slots free.
  // The right tool could then be excluded at every size, which `eval.test.ts`
  // caught: "find me some oat milk" matched `find_times` on the word "find"
  // and left `search_products` out of a list with four empty places in it.
  //
  // The cap is the point of this function, not the filter. A model seeing two
  // extra low-scoring cards costs a few dozen tokens; a model never being
  // shown the right tool costs the request.
  const rest = ranked.filter((r) => r.score <= 0);
  return [...matched, ...rest].slice(0, limit);
}
