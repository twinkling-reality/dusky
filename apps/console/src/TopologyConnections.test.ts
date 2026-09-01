import { describe, expect, it } from "vitest";
import {
  activityRouteIds,
  type CubicSegment,
  commandsForSegments,
  type TopologyActivityVisualState,
  traceCueState,
  traceDurationMs,
} from "./TopologyConnections.js";

function segment(fromX: number, toX: number): CubicSegment {
  return {
    from: { x: fromX, y: 10 },
    controlA: { x: fromX + 2, y: 10 },
    controlB: { x: toX - 2, y: 10 },
    to: { x: toX, y: 10 },
  };
}

describe("topology path commands", () => {
  it("starts a new subpath when a later route begins at a different terminal", () => {
    const commands = commandsForSegments([segment(0, 10), segment(30, 40)]);
    expect(commands.map((command) => command.kind)).toEqual(["move", "curve", "move", "curve"]);
    expect(commands[2]).toEqual({ kind: "move", point: { x: 30, y: 10 } });
  });

  it("keeps genuinely continuous cubic segments in one subpath", () => {
    const commands = commandsForSegments([segment(0, 10), segment(10, 24)]);
    expect(commands.map((command) => command.kind)).toEqual(["move", "curve", "curve"]);
  });
});

function activity(partial: Partial<TopologyActivityVisualState> = {}): TopologyActivityVisualState {
  return {
    origin: "https://market.test",
    toolName: "reserve_inventory",
    phase: "invoking",
    direction: "request",
    cueRevision: 1,
    ...partial,
  };
}

describe("causal activity routes", () => {
  it("keeps the idle canvas static", () => {
    expect(activityRouteIds(null)).toEqual([]);
  });

  it("uses only the Display-runtime leg before a provider invocation exists", () => {
    expect(
      activityRouteIds(
        activity({ origin: undefined, toolName: undefined, phase: "intent", direction: "request" }),
      ),
    ).toEqual(["display-runtime"]);
    expect(activityRouteIds(activity({ phase: "awaiting-approval", direction: "return" }))).toEqual(
      ["display-runtime"],
    );
  });

  it("does not invent a provider route from a partial tool identity", () => {
    expect(activityRouteIds(activity({ toolName: undefined }))).toEqual(["display-runtime"]);
    expect(activityRouteIds(activity({ origin: undefined }))).toEqual(["display-runtime"]);
  });

  it("targets the exact provider, action group, and action row only when invoking", () => {
    expect(activityRouteIds(activity())).toEqual([
      "provider:https://market.test",
      "actions:https://market.test",
      "tool:https://market.test::reserve_inventory",
    ]);
  });

  it("returns over the exact provider route without inventing a Display leg", () => {
    expect(activityRouteIds(activity({ phase: "returned", direction: "return" }))).toEqual([
      "tool:https://market.test::reserve_inventory",
      "actions:https://market.test",
      "provider:https://market.test",
    ]);
  });
});

describe("causal trace timing", () => {
  it("uses distance-based timing within the brief motion budget", () => {
    expect(traceDurationMs(0)).toBe(160);
    expect(traceDurationMs(324)).toBe(360);
    expect(traceDurationMs(2_000)).toBe(520);
  });

  it("fades the energized route for 900ms and then returns to static idle", () => {
    expect(traceCueState(200, 520, false)).toEqual({ state: "travel", strength: 1 });
    expect(traceCueState(970, 520, false)).toEqual({ state: "residual", strength: 0.5 });
    expect(traceCueState(1_421, 520, false)).toEqual({ state: "idle", strength: 0 });
  });

  it("uses a brief static residual instead of travel for reduced motion", () => {
    expect(traceCueState(100, 520, true)).toEqual({ state: "residual", strength: 1 });
    expect(traceCueState(901, 520, true)).toEqual({ state: "idle", strength: 0 });
  });
});
