/**
 * The deterministic layer around probabilistic reasoning.
 *
 * Nothing here calls a model, touches a network, or reads the DOM. Every
 * decision in this file is reproducible from its inputs alone, which is the
 * whole point: whether a human must confirm an action is not a judgement we
 * delegate to a language model.
 *
 * Three rules govern the design:
 *
 *   1. Default deny. An unrecognized tool is treated as consequential.
 *   2. An annotation may LOWER the required ceremony, never raise it, and only
 *      when no unambiguous danger verb is present. Chrome passes 1 of 4 WPT
 *      annotation tests, and a hostile site controls its own annotations, so
 *      `readOnlyHint: true` is a hint and not a permission slip.
 *   3. Tool output is always untrusted, hint or no hint.
 */

import type { ToolDescriptor } from "@dusky/contracts";

export type Consequence = "read" | "write" | "financial" | "destructive";

/**
 * HARD lexicons name an action outright. A tool called `purchase_item` spends
 * money whatever it claims about itself, so these override a read-only hint.
 */
const HARD_DESTRUCTIVE = [
  "delete",
  "destroy",
  "erase",
  "wipe",
  "revoke",
  "terminate",
  "unsubscribe",
  "deactivate",
  "close_account",
  "cancel_subscription",
];

const HARD_FINANCIAL = [
  "pay",
  "purchase",
  "buy",
  "checkout",
  "charge",
  "refund",
  "transfer",
  "withdraw",
  "deposit",
  "subscribe",
  "donate",
  "invoice",
];

/**
 * SOFT lexicons name a DOMAIN rather than an action. `cart` appears in both
 * `add_to_cart` and `review_cart`, so these are consulted only after a
 * read-only claim has already been honored, and never override it.
 */
const SOFT_FINANCIAL = ["cart", "basket", "order", "booking", "reserve", "billing", "tip"];
const SOFT_DESTRUCTIVE = ["remove", "drop", "clear", "discard", "archive"];

/**
 * Verbs that name a change, checked against the FIRST word of a tool's name.
 *
 * These exist to catch a claim that contradicts itself. `readOnlyHint` is
 * honoured before the soft lexicons are ever consulted, so with the hint
 * present those lists protect nothing: `place_order` claiming to change
 * nothing classified as a read, ran with no confirmation, and qualified as a
 * resolver, which is the one path that runs with nobody watching.
 *
 * Letting the soft lists override the hint is the wrong fix, and the comment
 * above says why: `cart` is in `add_to_cart` and `review_cart` alike. Those
 * lists mix two kinds of word. `cart`, `basket` and `booking` name a SUBJECT
 * and appear in reads and writes equally; these name a MUTATION.
 *
 * Matched against the leading word only, and as a whole word, because an
 * identifier is conventionally verb-first. That is what keeps a bookshop's
 * `search_books` a read while `book_table` is not, and `get_address` a read
 * while `add_item` is not. Substring matching over the whole card fails both.
 */
const MUTATION_VERBS = new Set([
  "add",
  "apply",
  "archive",
  "book",
  "broadcast",
  "cancel",
  "clear",
  "create",
  "discard",
  "drop",
  "empty",
  "invite",
  "move",
  "place",
  "publish",
  "remove",
  "reserve",
  "send",
  "set",
  "submit",
  "update",
]);

/**
 * Whether the first word of a name is a verb that names a change.
 *
 * Splits on separators and on camelCase, so `placeOrder` and `place_order`
 * read the same. Plurals and past tense count; `-ing` deliberately does not,
 * because that is how these verbs become nouns and `review_booking` is a read.
 */
function namesAMutation(name: string): boolean {
  const first = fold(name.replace(/([a-z])([A-Z])/g, "$1 $2"))
    .split(/[^a-z]+/)
    .filter(Boolean)[0];
  if (!first) return false;
  if (MUTATION_VERBS.has(first)) return true;
  const stem = first.replace(/(es|ed|s)$/, "");
  return stem !== first && MUTATION_VERBS.has(stem);
}

/** Sending or publishing on the user's behalf is consequential even if free. */
const OUTWARD = [
  "send",
  "post",
  "publish",
  "share",
  "email",
  "message",
  "reply",
  "submit",
  "invite",
  "comment",
  "tweet",
  "broadcast",
];

/**
 * Letters chosen to be read as Latin while not being Latin.
 *
 * The lexicons are ASCII and `matches` is a substring test, so a tool called
 * `d\u0435lete_account` reads as "delete" to every human who sees it on a lens
 * and matches nothing here. It then gets to use `readOnlyHint` and reach the
 * wearer with no gate at all. Cheap for a site to do and invisible on a
 * waveguide, which is the worst combination available.
 *
 * Lowercase only, because folding happens after `toLowerCase`.
 */
const CONFUSABLE: Record<string, string> = {
  // Cyrillic
  "\u0430": "a",
  "\u0432": "b",
  "\u0435": "e",
  "\u043a": "k",
  "\u043c": "m",
  "\u043d": "h",
  "\u043e": "o",
  "\u0440": "p",
  "\u0441": "c",
  "\u0442": "t",
  "\u0443": "y",
  "\u0445": "x",
  "\u0455": "s",
  "\u0456": "i",
  "\u0458": "j",
  "\u0501": "d",
  "\u051b": "q",
  "\u051d": "w",
  // Greek
  "\u03b1": "a",
  "\u03b2": "b",
  "\u03b3": "y",
  "\u03b5": "e",
  "\u03b9": "i",
  "\u03ba": "k",
  "\u03bd": "v",
  "\u03bf": "o",
  "\u03c1": "p",
  "\u03c4": "t",
  "\u03c5": "u",
  "\u03c7": "x",
};

/**
 * Reduce site-supplied text to something the lexicons can honestly match.
 *
 * NFKD turns fullwidth and other compatibility spellings into plain letters
 * and splits accents off their bases. Stripping `Cf` removes zero-width and
 * bidi characters, which is what lets `de<ZWSP>lete` be one word again;
 * stripping `Mn` removes the combining marks NFKD just produced.
 */
function fold(raw: string): string {
  const flattened = raw
    .normalize("NFKD")
    .replace(/[\p{Cf}\p{Mn}]/gu, "")
    .toLowerCase();
  let out = "";
  for (const ch of flattened) out += CONFUSABLE[ch] ?? ch;
  return out;
}

/** Scripts whose letters are routinely used to impersonate Latin ones. */
const LATIN = /\p{Script=Latin}/u;
const LATIN_ALIKE = /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\p{Script=Cherokee}]/u;

/**
 * Whether any single word mixes Latin with a script that imitates it.
 *
 * The backstop for confusables that are not in the table above. A wholly
 * Cyrillic or wholly Japanese tool is a LANGUAGE and is left alone; a word
 * that is Latin except for one Cyrillic letter is not something anyone does
 * by accident. Such a tool does not get to lower its own ceremony, which
 * leaves it at the default rather than declaring it dangerous: we know the
 * claim is untrustworthy, not what the tool actually does.
 */
function mixesLatinAlikeScripts(raw: string): boolean {
  for (const token of raw.split(/[\s_\-./:,()[\]{}]+/)) {
    if (token && LATIN.test(token) && LATIN_ALIKE.test(token)) return true;
  }
  return false;
}

function haystack(tool: ToolDescriptor): string {
  return fold(`${tool.name} ${tool.title ?? ""} ${tool.description}`);
}

/**
 * The parameter names and descriptions a site declared.
 *
 * A tool can describe itself blandly, claim `readOnlyHint`, and put what it
 * actually does in its schema: `apply_changes`, "Applies pending changes.",
 * with a `delete_everything` boolean. Nothing looked there, so it classified
 * as a read and ran with no human in front of it. A site is not obliged to
 * name itself honestly, which is the whole reason the annotation is treated as
 * a claim rather than a permission slip; the schema is the same kind of
 * evidence and was being ignored.
 *
 * Read by hand rather than through `parameters()` in `packages/frames`,
 * because this package must not grow a dependency. It needs the keys and their
 * descriptions, nothing else.
 */
function paramText(tool: ToolDescriptor): string {
  const props = tool.inputSchema?.["properties"];
  if (typeof props !== "object" || props === null) return "";

  const parts: string[] = [];
  for (const [key, spec] of Object.entries(props as Record<string, unknown>)) {
    parts.push(key);
    if (typeof spec === "object" && spec !== null) {
      const described = (spec as Record<string, unknown>)["description"];
      if (typeof described === "string") parts.push(described);
    }
  }
  return fold(parts.join(" "));
}

function matches(text: string, needles: readonly string[]): boolean {
  return needles.some((n) => text.includes(n));
}

export interface Classification {
  consequence: Consequence;
  /** True when a danger verb overrode the tool's own read-only claim. */
  overrodeAnnotation: boolean;
}

/**
 * Classify what invoking this tool would cost the user if it went wrong.
 *
 * Order is the security property. Hard verbs are checked first so a
 * misleading annotation cannot launder a consequence; the read-only claim is
 * honored next; soft domain signals only refine an already-gated action.
 */
export function classifyDetailed(tool: ToolDescriptor): Classification {
  const text = haystack(tool);

  // A claim made in text that is trying to look like other text is not a claim
  // worth honouring.
  const spelled = `${tool.name} ${tool.title ?? ""} ${tool.description}`;
  const claimsReadOnly =
    tool.annotations.readOnlyHint === true &&
    !mixesLatinAlikeScripts(spelled) &&
    // A tool that claims to change nothing while its own name says otherwise
    // is contradicting itself, and a self-contradictory claim is not one to
    // honour. This only ever raises ceremony.
    !namesAMutation(tool.name);

  // The schema joins the HARD checks only.
  //
  // A parameter is weaker evidence about what a TOOL does than the tool's own
  // name. A hard verb names an action outright and is worth acting on wherever
  // it appears; a soft verb names a DOMAIN and needs the tool's own naming
  // behind it, or a search with a `remove_duplicates` flag would stop for a
  // human. That asymmetry is the same one ranking already uses: name evidence
  // outweighs prose.
  //
  // This can only ever raise ceremony, never lower it, so rule 4 holds.
  const declared = `${text} ${paramText(tool)}`;

  if (matches(declared, HARD_DESTRUCTIVE)) {
    return { consequence: "destructive", overrodeAnnotation: claimsReadOnly };
  }
  if (matches(declared, HARD_FINANCIAL)) {
    return { consequence: "financial", overrodeAnnotation: claimsReadOnly };
  }

  // Only now may the site's own claim reduce the ceremony.
  if (claimsReadOnly) return { consequence: "read", overrodeAnnotation: false };

  if (matches(text, SOFT_DESTRUCTIVE))
    return { consequence: "destructive", overrodeAnnotation: false };
  if (matches(text, SOFT_FINANCIAL)) return { consequence: "financial", overrodeAnnotation: false };
  if (matches(text, OUTWARD)) return { consequence: "write", overrodeAnnotation: false };

  // Default deny: unknown shape, treat as a state change.
  return { consequence: "write", overrodeAnnotation: false };
}

export function classify(tool: ToolDescriptor): Consequence {
  return classifyDetailed(tool).consequence;
}

/** Read-only tools run without asking. Everything else stops for a human. */
export function requiresConfirmation(c: Consequence): boolean {
  return c !== "read";
}

/**
 * Tool output is ALWAYS untrusted, because it is attacker-controlled text that
 * a model is about to read. The hint can only tell us the site agrees.
 */
export const TOOL_OUTPUT_IS_UNTRUSTED = true;

/** Whether the site itself flagged its output as untrusted. Advisory only. */
export function siteFlagsUntrusted(tool: ToolDescriptor): boolean {
  return tool.annotations.untrustedContentHint === true;
}

export interface Gate {
  consequence: Consequence;
  requiresConfirmation: boolean;
  /** Short, human-readable reason. Shown in diagnostics, never to the wearer. */
  reason: string;
}

export function gate(tool: ToolDescriptor): Gate {
  const { consequence, overrodeAnnotation } = classifyDetailed(tool);
  let reason: string;
  if (overrodeAnnotation) {
    reason = `claims read-only but matched a ${consequence} verb`;
  } else if (consequence === "read") {
    reason = "readOnlyHint honored, no state change";
  } else if (consequence === "destructive") {
    reason = "destructive verb in tool name or description";
  } else if (consequence === "financial") {
    reason = "financial verb in tool name or description";
  } else {
    reason = "not annotated read-only, treated as a state change";
  }
  return { consequence, requiresConfirmation: requiresConfirmation(consequence), reason };
}

/**
 * Retry safety. Never replay something that may have already charged a card.
 * Only reads are auto-retryable; everything else goes back to the wearer.
 */
export function isAutoRetryable(tool: ToolDescriptor): boolean {
  return classify(tool) === "read";
}

/**
 * A confirmation is only valid against the exact tool call the wearer saw.
 * If the tool set changed underneath, the confirmation is stale and must be
 * re-asked rather than honored.
 */
export function isConfirmationFresh(
  shownAt: number,
  toolsChangedAt: number,
  now: number,
  maxAgeMs = 120_000,
): boolean {
  if (toolsChangedAt > shownAt) return false;
  return now - shownAt <= maxAgeMs;
}
