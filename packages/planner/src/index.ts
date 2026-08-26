/**
 * @dusky/planner
 *
 * An implementation of the `Planner` port from @dusky/session.
 *
 * The port is optional by design: Dusky works without a planner, degrading to
 * explicit menu navigation, so a model outage or a missing credential cannot
 * strand a wearer. Everything here only ever PROPOSES. Whether a proposal
 * needs a human is decided in @dusky/policy, which imports nothing from this
 * package and never will.
 */

export {
  AnthropicModelClient,
  type AnthropicModelClientOptions,
  type TierConfig,
} from "./anthropic.js";
export { CardCache, cardKey, renderCard, safeText } from "./cards.js";
export {
  accept,
  type Confidence,
  type Decision,
  type ModelClient,
  ModelPlanner,
  type ModelPlannerOptions,
  type ModelRequest,
  type PlanEvent,
  type PlanPath,
  type RejectReason,
  readArgs,
  type Tier,
} from "./planner.js";
export { intentTokens, type RankedTool, rank, scoreTool, shortlist, tokenize } from "./rank.js";
