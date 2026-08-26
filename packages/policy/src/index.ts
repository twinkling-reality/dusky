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

function haystack(tool: ToolDescriptor): string {
  return `${tool.name} ${tool.title ?? ""} ${tool.description}`.toLowerCase();
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
  return parts.join(" ").toLowerCase();
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
  const claimsReadOnly = tool.annotations.readOnlyHint === true;

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
