/**
 * Where the planner is switched on, and the only place a model credential is
 * read.
 *
 * OPT-IN ON PURPOSE. Dusky is menu-driven without a planner and fully usable
 * that way, so a model is an upgrade rather than a dependency. Defaulting it
 * on would mean the round-trip test, CI, and anyone cloning the repository all
 * needed a credential to see the product work, and it would make a model
 * outage look like a broken product. `DUSKY_PLANNER=on` turns it on.
 *
 * The credential never leaves this process. The Display holds attention, the
 * console holds the partner site's session, and neither is ever handed a key.
 */

import type { AuditEntry } from "@dusky/contracts";
import {
  AnthropicModelClient,
  CardCache,
  type ModelClient,
  ModelPlanner,
  OpenAIModelClient,
  type PlanEvent,
} from "@dusky/planner";
import type { Planner } from "@dusky/session";

type Record_ = (e: Omit<AuditEntry, "at" | "sessionId">) => void;

/**
 * Builds one planner per session so its decisions land in that session's own
 * audit trail. The compiled-card cache is shared across sessions, because a
 * tool's card depends on the tool and not on who is wearing the glasses.
 */
export type PlannerFactory = (record: Record_) => Planner;

export type ModelProvider = "openai" | "anthropic";

type ConfiguredModelClient =
  | { ok: true; provider: ModelProvider; client: ModelClient }
  | { ok: false; reason: string };

export interface PlannerFactoryOptions {
  env?: NodeJS.ProcessEnv;
  logger?: Pick<Console, "log" | "warn">;
}

/**
 * Resolve one explicitly selected server-side adapter.
 *
 * A key's presence never selects its provider. Missing or invalid
 * configuration returns a reason but no client, so startup can stay
 * menu-driven without leaking a credential or discovering one by trial.
 */
export function modelClientFromEnvironment(env: NodeJS.ProcessEnv): ConfiguredModelClient {
  const provider = env["DUSKY_MODEL_PROVIDER"]?.trim().toLowerCase();
  if (provider !== "openai" && provider !== "anthropic") {
    return {
      ok: false,
      reason: "DUSKY_MODEL_PROVIDER must be set to openai or anthropic",
    };
  }

  if (provider === "openai") {
    const apiKey = env["OPENAI_API_KEY"]?.trim();
    if (!apiKey) return { ok: false, reason: "OPENAI_API_KEY is not set" };
    return {
      ok: true,
      provider,
      client: new OpenAIModelClient({
        apiKey,
        fastModel: nonempty(env["DUSKY_OPENAI_FAST_MODEL"]),
        carefulModel: nonempty(env["DUSKY_OPENAI_CAREFUL_MODEL"]),
      }),
    };
  }

  const apiKey = env["ANTHROPIC_API_KEY"]?.trim();
  if (!apiKey) return { ok: false, reason: "ANTHROPIC_API_KEY is not set" };
  return {
    ok: true,
    provider,
    client: new AnthropicModelClient({
      apiKey,
      fastModel: nonempty(env["DUSKY_ANTHROPIC_FAST_MODEL"]),
      carefulModel: nonempty(env["DUSKY_ANTHROPIC_CAREFUL_MODEL"]),
    }),
  };
}

export function plannerFactory(options: PlannerFactoryOptions = {}): PlannerFactory | undefined {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  if (env["DUSKY_PLANNER"] !== "on") return undefined;

  let configured: ConfiguredModelClient;
  try {
    configured = modelClientFromEnvironment(env);
  } catch (err) {
    // Say so once and carry on menu-driven rather than failing every task.
    logger.warn(
      `dusky: DUSKY_PLANNER=on but no model client could be built, running menu-only (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return undefined;
  }

  if (!configured.ok) {
    logger.warn(`dusky: DUSKY_PLANNER=on but ${configured.reason}, running menu-only`);
    return undefined;
  }

  // A wrong, expired, or quota-limited credential surfaces on the first
  // request. ModelPlanner records the failure and returns the wearer to the
  // deterministic menu; no credential is logged or sent to another surface.
  const cache = new CardCache();
  logger.log(`dusky: planner enabled with ${configured.provider}`);
  return (record) =>
    new ModelPlanner({ client: configured.client, cache, onPlan: (e) => record(toAudit(e)) });
}

function nonempty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Every planning step, in the wearer's audit trail.
 *
 * A refusal is recorded as an event of its own. "The model proposes, code
 * disposes" is only a claim until the disposals are visible afterwards.
 */
function toAudit(e: PlanEvent): Omit<AuditEntry, "at" | "sessionId"> {
  switch (e.kind) {
    case "shortlist":
      return {
        kind: "plan",
        detail: { stage: "shortlist", path: e.path, considered: e.considered, sent: e.sent },
      };
    case "resolved":
      return {
        kind: "plan",
        toolName: e.tool,
        detail: {
          stage: "proposed",
          path: e.path,
          tier: e.tier,
          confidence: e.confidence,
          droppedArgCount: e.droppedArgCount,
          ...(e.step !== undefined ? { step: e.step } : {}),
          ...(e.total !== undefined ? { total: e.total } : {}),
          ms: e.ms,
        },
      };
    case "rejected":
      return {
        kind: "plan",
        ...(e.tool ? { toolName: e.tool } : {}),
        detail: { stage: "refused", path: e.path, tier: e.tier, reason: e.reason, ms: e.ms },
      };
    case "abstained":
      return {
        kind: "plan",
        detail: { stage: "abstained", path: e.path, tier: e.tier, ms: e.ms },
      };
    case "failed":
      return {
        kind: "error",
        detail: {
          stage: "planner",
          path: e.path,
          tier: e.tier,
          reason: "planner request failed",
          ms: e.ms,
        },
      };
  }
}
