/**
 * OpenAI-specific implementation of the provider-neutral `ModelClient`.
 *
 * The adapter uses the Responses API with a stable strict JSON Schema. It does
 * not ask the API to call Dusky's WebMCP tools: a model only returns a bounded
 * proposal, which the planner and session validate independently.
 *
 * Written against openai 7.9.0 and the current Responses API declarations.
 */

import OpenAI from "openai";
import { DECISION_SCHEMA, declineDecision, normalizeDecision } from "./decision.js";
import type { Decision, ModelClient, ModelRequest, Tier } from "./planner.js";

export interface OpenAITierConfig {
  model: string;
  effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  maxOutputTokens?: number;
}

/**
 * Current documented Responses and Structured Outputs models.
 *
 * Luna keeps the ordinary route latency- and cost-sensitive. Terra is the
 * stronger second opinion. Reasoning is explicit because the GPT-5.6 family
 * otherwise defaults to medium effort, which is too expensive for a small
 * routing decision on a wearer-facing deadline.
 */
const FAST: OpenAITierConfig = {
  model: "gpt-5.6-luna",
  effort: "none",
  maxOutputTokens: 1_024,
};
const CAREFUL: OpenAITierConfig = {
  model: "gpt-5.6-terra",
  effort: "low",
  maxOutputTokens: 4_096,
};

export interface OpenAIModelClientOptions {
  /** Supply an injected client for tests, or a server-side API key in production. */
  client?: OpenAI;
  apiKey?: string;
  fastModel?: string;
  carefulModel?: string;
  fast?: OpenAITierConfig;
  careful?: OpenAITierConfig;
}

/** An in-band failed Responses object is a service failure, not a refusal. */
export class OpenAIResponseError extends Error {
  constructor(code?: string) {
    super(`OpenAI response failed${code ? ` (${code})` : ""}`);
    this.name = "OpenAIResponseError";
  }
}

/** A `ModelClient` backed by the OpenAI Responses API. */
export class OpenAIModelClient implements ModelClient {
  private readonly client: OpenAI;
  private readonly tiers: Record<Tier, OpenAITierConfig>;

  constructor(o: OpenAIModelClientOptions = {}) {
    this.client = o.client ?? new OpenAI(o.apiKey ? { apiKey: o.apiKey } : undefined);
    this.tiers = {
      fast: o.fast ?? { ...FAST, ...(o.fastModel ? { model: o.fastModel } : {}) },
      careful: o.careful ?? { ...CAREFUL, ...(o.carefulModel ? { model: o.carefulModel } : {}) },
    };
  }

  async decide(req: ModelRequest): Promise<Decision> {
    const tier = this.tiers[req.tier];
    const response = await this.client.responses.create(
      {
        model: tier.model,
        instructions: req.system,
        input: req.user,
        store: false,
        max_output_tokens: tier.maxOutputTokens ?? 1_024,
        ...(tier.effort ? { reasoning: { effort: tier.effort } } : {}),
        text: {
          format: {
            type: "json_schema",
            name: "dusky_planner_decision",
            description: "A bounded proposal for Dusky's deterministic planner.",
            strict: true,
            schema: DECISION_SCHEMA,
          },
        },
      },
      // The planner owns both the deadline and the careful-tier escalation.
      // Hidden SDK retries would spend that budget without planner visibility.
      { timeout: req.timeoutMs, maxRetries: 0 },
    );

    if (response.status === "failed" || response.error) {
      throw new OpenAIResponseError(response.error?.code);
    }

    // Refusals and incomplete answers are healthy safe declines. They do not
    // become outages, and they never leave a partial proposal to salvage.
    if (response.status !== "completed" || containsRefusal(response.output)) {
      return declineDecision();
    }

    try {
      if (!response.output_text.trim()) return declineDecision();
      return normalizeDecision(JSON.parse(response.output_text));
    } catch {
      return declineDecision();
    }
  }
}

function containsRefusal(output: unknown): boolean {
  if (!Array.isArray(output)) return false;
  return output.some((item) => {
    if (!isRecord(item) || !Array.isArray(item["content"])) return false;
    return item["content"].some((content) => isRecord(content) && content["type"] === "refusal");
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
