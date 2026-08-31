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
import { AnthropicModelClient, CardCache, ModelPlanner, type PlanEvent } from "@dusky/planner";
import type { Planner } from "@dusky/session";

type Record_ = (e: Omit<AuditEntry, "at" | "sessionId">) => void;

/**
 * Builds one planner per session so its decisions land in that session's own
 * audit trail. The compiled-card cache is shared across sessions, because a
 * tool's card depends on the tool and not on who is wearing the glasses.
 */
export type PlannerFactory = (record: Record_) => Planner;

export function plannerFactory(): PlannerFactory | undefined {
  if (process.env["DUSKY_PLANNER"] !== "on") return undefined;

  let client: AnthropicModelClient;
  try {
    client = new AnthropicModelClient();
  } catch (err) {
    // Say so once and carry on menu-driven rather than failing every task.
    console.warn(
      `dusky: DUSKY_PLANNER=on but no model client could be built, running menu-only (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return undefined;
  }

  // Deliberately NOT gated on ANTHROPIC_API_KEY being set. The SDK also
  // resolves ANTHROPIC_AUTH_TOKEN and an `ant auth login` profile, so checking
  // for the environment variable would refuse perfectly good credentials.
  //
  // Verified by running it: constructing the client with no credential at all
  // does not throw, so a missing one is not caught here. It surfaces on the
  // first request as an API error, the planner records the failure, and the
  // wearer gets the menu. Wrong credentials cost latency, never a dead end.
  const cache = new CardCache();
  console.log("dusky: planner enabled (credentials are checked on first use)");
  return (record) => new ModelPlanner({ client, cache, onPlan: (e) => record(toAudit(e)) });
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
