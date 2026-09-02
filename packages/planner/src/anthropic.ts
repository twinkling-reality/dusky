/**
 * Anthropic-specific implementation of the provider-neutral `ModelClient`.
 *
 * Everything above the adapters works against that port, so the planner's
 * behaviour, including every adversarial case, is tested without a network and
 * a different provider means a different file rather than a different design.
 *
 * Three choices here are load-bearing rather than incidental.
 *
 * ONE STABLE SCHEMA. Every planning path returns the same four-field object.
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
 * NO PROMPT-CACHE BREAKPOINT. The system prompts here are only a few hundred
 * tokens, below the fast tier's cacheable prefix floor, so a `cache_control`
 * marker would cache nothing there while implying otherwise.
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
import { DECISION_SCHEMA, declineDecision, normalizeDecision } from "./decision.js";
import type { Decision, ModelClient, ModelRequest, Tier } from "./planner.js";

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
 * Careful runs at low effort deliberately. The task is choosing from six
 * described tools, not open-ended reasoning, and the ceiling that matters is
 * a person standing still waiting for a frame. Raise it if evaluation says
 * otherwise.
 */
const FAST: TierConfig = { model: "claude-haiku-4-5", maxTokens: 512 };
/**
 * `maxTokens` here is NOT the size of the answer. On claude-sonnet-5 adaptive
 * thinking is on by default, and `max_tokens` is a hard cap on thinking PLUS
 * response text. The answer is only a few dozen tokens, but a 512 ceiling left
 * almost nothing for thinking: the model hit the cap and returned no usable
 * structured answer.
 *
 * Billing is on tokens generated, not on the ceiling, so the headroom is free
 * unless it is used. Do not lower this to save money; it does not.
 */
const CAREFUL: TierConfig = { model: "claude-sonnet-5", effort: "low", maxTokens: 4096 };

export interface AnthropicModelClientOptions {
  /** Supply your own configured client, or let the SDK read the environment. */
  client?: Anthropic;
  apiKey?: string;
  fastModel?: string;
  carefulModel?: string;
  fast?: TierConfig;
  careful?: TierConfig;
}

/** A `ModelClient` backed by the Anthropic Messages API. */
export class AnthropicModelClient implements ModelClient {
  private readonly client: Anthropic;
  private readonly tiers: Record<Tier, TierConfig>;

  constructor(o: AnthropicModelClientOptions = {}) {
    this.client = o.client ?? new Anthropic(o.apiKey ? { apiKey: o.apiKey } : undefined);
    this.tiers = {
      fast: o.fast ?? { ...FAST, ...(o.fastModel ? { model: o.fastModel } : {}) },
      careful: o.careful ?? { ...CAREFUL, ...(o.carefulModel ? { model: o.carefulModel } : {}) },
    };
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
      if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") {
        return declineDecision();
      }

      const parsed = message.parsed_output;
      if (!parsed) return declineDecision();

      return normalizeDecision(parsed);
    } catch (err) {
      // Verified by running it against a stub: `messages.parse` THROWS when the
      // content does not satisfy the schema. It does not hand back a null
      // `parsed_output`, whatever the return type suggests. An answer we cannot
      // read is the model declining, so it must not be reported to the wearer
      // as an outage. A transport or quota failure genuinely is one, and is
      // rethrown so the planner records it and escalates.
      if (err instanceof Anthropic.APIError) throw err;
      return declineDecision();
    }
  }
}
