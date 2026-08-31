import { describe, expect, it } from "vitest";
import { type CubicSegment, commandsForSegments } from "./TopologyConnections.js";

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
