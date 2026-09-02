/**
 * Stable provider-neutral structured output for every model adapter.
 *
 * The schema deliberately does not enumerate the tools offered on one turn.
 * A request-specific schema would lose provider-side schema caching, while the
 * planner must validate every returned identity against the actual shortlist
 * regardless. `arguments` stays serialized because its keys also vary by
 * request and are validated later against the selected WebMCP declaration.
 */

import type { Decision } from "./planner.js";

export const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tool", "arguments", "next", "confidence"],
  properties: {
    tool: {
      type: "string",
      description:
        'Exact origin-qualified identity of the first candidate tool, or "" to decline. A bare name is valid only when unique.',
    },
    arguments: {
      type: "string",
      description: 'A JSON object serialized as a string, for example {"query":"oat milk"}.',
    },
    next: {
      type: "array",
      maxItems: 3,
      description: "Additional requested actions after the first, in order.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tool", "arguments"],
        properties: {
          tool: {
            type: "string",
            description:
              "Exact origin-qualified candidate identity, or a bare name only when it is unique.",
          },
          arguments: { type: "string" },
        },
      },
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
  },
} as const;

/** A fresh safe decline, so callers cannot mutate a shared singleton. */
export function declineDecision(): Decision {
  return { tool: "", arguments: "{}", next: [], confidence: "low" };
}

/**
 * Convert a provider's parsed JSON into the one decision shape the planner
 * understands. Structured Outputs should make every field valid, but adapter
 * code treats any incomplete or malformed object as a decline instead of
 * salvaging a proposal from it.
 */
export function normalizeDecision(value: unknown): Decision {
  if (!isRecord(value)) return declineDecision();
  if (typeof value["tool"] !== "string" || typeof value["arguments"] !== "string") {
    return declineDecision();
  }
  if (
    value["confidence"] !== "high" &&
    value["confidence"] !== "medium" &&
    value["confidence"] !== "low"
  ) {
    return declineDecision();
  }
  if (!Array.isArray(value["next"]) || value["next"].length > 3) return declineDecision();

  const next: { tool: string; arguments: string }[] = [];
  for (const step of value["next"]) {
    if (
      !isRecord(step) ||
      typeof step["tool"] !== "string" ||
      typeof step["arguments"] !== "string"
    ) {
      return declineDecision();
    }
    next.push({ tool: step["tool"], arguments: step["arguments"] });
  }

  return {
    tool: value["tool"],
    arguments: value["arguments"],
    next,
    confidence: value["confidence"],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
