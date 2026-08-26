/**
 * The only file in Dusky that knows a model provider exists.
 *
 * Everything above it works against the `ModelClient` port, so the planner's
 * behaviour, including every adversarial case, is tested without a network and
 * a different provider means a different file rather than a different design.
 *
 * Three choices here are load-bearing rather than incidental.
 *
 * ONE STABLE SCHEMA. Both planning paths return the same three-field object.
 * Structured outputs compile a schema on first use and cache it for 24 hours,
 * so a schema that varied per request, for instance an enum of that request's
 * candidate names, would pay compilation on nearly every call. Constraining
 * the answer that way would also be redundant: `planner.ts` re-checks every
 * name against the candidates it actually offered, and has to whether or not
 * the schema helped.
 *
 * NO SDK RETRIES. The SDK retries twice by default, so a request carrying a
 * 2.5s timeout can occupy 7.5s of a wearer's attention. Retrying is the tier
 * escalation's job, and it is accounted for in the planner's budget.
 *
 * NO PROMPT-CACHE BREAKPOINT, and the threshold is per-model rather than one
 * number: 4096 tokens on claude-haiku-4-5, 512 on claude-opus-5. The system
 * prompts here are a few hundred tokens, so a `cache_control` marker would
 * cache nothing on the fast tier while implying otherwise.
 *
 * Fixing that ceiling is not enough on its own. Caching is a PREFIX match and
 * the volatile request line is rendered before the cards, so the stable part
 * is not a prefix; the shortlist also varies per intent, so the cards are not
 * stable across turns either. Caching would need the whole registry in
 * `system` with no shortlist, which at these card sizes needs roughly 55 tools
 * to clear the fast tier's floor. The demo sites declare 7. The savings this
 * planner actually gets come from the shortlist and the compiled-card cache.
 *
 * Written against @anthropic-ai/sdk 0.120.0. The request shape was verified
 * against that package's shipped type declarations. It has NOT been executed
 * against the live API in this repository, because tests here run without
 * credentials; the `ModelClient` fakes cover everything downstream of it.
 */

import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import type { Confidence, Decision, ModelClient, ModelRequest, Tier } from "./planner.js";

/**
 * The answer shape, identical for both planning paths.
 *
 * `arguments` is a JSON object serialized as a string because structured
 * outputs cannot describe an object whose keys differ per request. WebMCP
 * itself passes arguments as a string in Chrome today for unrelated reasons,
 * so the parsing discipline was already required.
 */
const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tool", "arguments", "confidence"],
  properties: {
    tool: {
      type: "string",
      description: 'Exact name of one candidate tool, or "" to decline.',
    },
    arguments: {
      type: "string",
      description: 'A JSON object serialized as a string, for example {"query":"oat milk"}.',
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
  },
} as const;

export interface TierConfig {
  model: string;
  /**
   * Thinking depth. Omit for models that reject `output_config.effort`;
   * Haiku 4.5 is one of them.
   */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
}

/**
 * Defaults.
 *
 * The fast tier answers first and is right most of the time. The careful tier
 * is asked when the fast one is unsure, names something that is not on offer,
 * or reaches for a tool that would cost the wearer money, so it runs on a
 * fraction of turns and a stronger model is affordable there.
 *
 * Careful runs at low effort deliberately. The task is picking one of six
 * described tools, not reasoning, and the ceiling that matters is a person
 * standing still waiting for a frame. Raise it if evaluation says otherwise.
 */
const FAST: TierConfig = { model: "claude-haiku-4-5", maxTokens: 512 };
/**
 * `maxTokens` here is NOT the size of the answer. On claude-opus-5 thinking is
 * on by default when `thinking` is omitted, unlike opus-4-8 and opus-4-7, and
 * `max_tokens` is a hard cap on thinking PLUS response text. The answer is a
 * few dozen tokens, so a 512 ceiling left almost nothing for thinking: the
 * model hit the cap, `stop_reason` came back `max_tokens`, and the branch
 * below read that as the model declining. The careful tier abstained on
 * exactly the low-confidence and consequential picks it exists to handle, and
 * it did so silently, because an abstention is recorded as an abstention.
 *
 * Billing is on tokens generated, not on the ceiling, so the headroom is free
 * unless it is used. Do not lower this to save money; it does not.
 */
const CAREFUL: TierConfig = { model: "claude-opus-5", effort: "low", maxTokens: 4096 };

export interface AnthropicModelClientOptions {
  /** Supply your own configured client, or let the SDK read the environment. */
  client?: Anthropic;
  fast?: TierConfig;
  careful?: TierConfig;
}

/** A `ModelClient` backed by the Anthropic Messages API. */
export class AnthropicModelClient implements ModelClient {
  private readonly client: Anthropic;
  private readonly tiers: Record<Tier, TierConfig>;

  constructor(o: AnthropicModelClientOptions = {}) {
    this.client = o.client ?? new Anthropic();
    this.tiers = { fast: o.fast ?? FAST, careful: o.careful ?? CAREFUL };
  }

  async decide(req: ModelRequest): Promise<Decision> {
    const tier = this.tiers[req.tier];
    try {
      const message = await this.client.messages.parse(
        {
          model: tier.model,
          max_tokens: tier.maxTokens ?? 512,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
          output_config: {
            ...(tier.effort ? { effort: tier.effort } : {}),
            format: jsonSchemaOutputFormat(DECISION_SCHEMA),
          },
        },
        // The planner owns the deadline and the escalation, so the SDK must
        // not quietly triple the wall clock by retrying underneath it.
        { timeout: req.timeoutMs, maxRetries: 0 },
      );

      // A refusal or a truncated answer is an abstention, not a failure: the
      // wearer gets the menu, which they can already drive.
      if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") return DECLINE;

      const parsed = message.parsed_output;
      if (!parsed) return DECLINE;

      return {
        tool: typeof parsed.tool === "string" ? parsed.tool : "",
        arguments: typeof parsed.arguments === "string" ? parsed.arguments : "{}",
        confidence: asConfidence(parsed.confidence),
      };
    } catch (err) {
      // Verified by running it against a stub: `messages.parse` THROWS when the
      // content does not satisfy the schema. It does not hand back a null
      // `parsed_output`, whatever the return type suggests. An answer we cannot
      // read is the model declining, so it must not be reported to the wearer
      // as an outage. A transport or quota failure genuinely is one, and is
      // rethrown so the planner records it and escalates.
      if (err instanceof Anthropic.APIError) throw err;
      return DECLINE;
    }
  }
}

const DECLINE: Decision = { tool: "", arguments: "{}", confidence: "low" };

/** The schema constrains this, but an unexpected value must not read as high. */
function asConfidence(v: unknown): Confidence {
  return v === "high" || v === "medium" ? v : "low";
}
