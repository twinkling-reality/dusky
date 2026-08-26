import type { AuditEntry } from "@dusky/contracts";
import { Session, type ToolRunner } from "@dusky/session";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { plannerFactory } from "./planner.js";

/**
 * The wiring this file creates, exercised as the server assembles it:
 * Session -> ModelPlanner -> AnthropicModelClient.
 *
 * The model is pointed at a port nothing is listening on, which is the shape
 * of every credential and connectivity failure a deployment can have. The
 * claim under test is the one the product rests on: a planner that cannot work
 * must cost the wearer latency, never a dead end.
 */

const TOOLS = [
  {
    name: "search_products",
    title: "Search catalog",
    description: "Search the product catalog by free text.",
    origin: "https://shop.test",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
  },
  {
    name: "add_to_cart",
    title: "Add to cart",
    description: "Add a product to the shopping cart by product id.",
    origin: "https://shop.test",
    inputSchema: {
      type: "object",
      properties: { product_id: { type: "string", description: "Which product?" } },
      required: ["product_id"],
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
  },
];

const env = { ...process.env };

beforeEach(() => {
  process.env["DUSKY_PLANNER"] = "on";
  process.env["ANTHROPIC_API_KEY"] = "stub-not-a-real-key";
  process.env["ANTHROPIC_BASE_URL"] = "http://127.0.0.1:1";
});

afterEach(() => {
  process.env = { ...env };
});

describe("the switch", () => {
  it("stays off unless asked for", () => {
    process.env["DUSKY_PLANNER"] = "";
    expect(plannerFactory()).toBeUndefined();
  });

  it("builds a planner when asked for", () => {
    expect(plannerFactory()).toBeInstanceOf(Function);
  });
});

describe("a planner whose model cannot be reached", () => {
  function session(record: (e: Omit<AuditEntry, "at" | "sessionId">) => void) {
    const calls: string[] = [];
    const runner: ToolRunner = {
      discover: async () => TOOLS,
      invoke: async (_o, name) => {
        calls.push(name);
        return JSON.stringify({ ok: true });
      },
    };
    const make = plannerFactory();
    if (!make) throw new Error("planner factory should exist with DUSKY_PLANNER=on");
    return {
      calls,
      s: new Session({ source: "Shop", runner, planner: make(record), onAudit: record }),
    };
  }

  it("leaves the wearer on the menu instead of stranded", async () => {
    const audit: AuditEntry[] = [];
    const { s, calls } = session((e) => audit.push(e as AuditEntry));
    await s.start();

    const f = await s.submitText("find me some oat milk");
    expect(f.kind).toBe("idle");
    expect(calls).toEqual([]);

    // Both tiers were tried and both failed, and the audit says so rather
    // than the wearer being shown a mystery.
    const failures = audit.filter((e) => e.kind === "error" && e.detail?.["stage"] === "planner");
    expect(failures.length).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it("still collects a parameter by asking, when the resolver cannot be planned", async () => {
    const audit: AuditEntry[] = [];
    const { s, calls } = session((e) => audit.push(e as AuditEntry));
    await s.start();

    const f = await s.handle("add_to_cart");
    expect(f.kind).toBe("choose");
    if (f.kind !== "choose") throw new Error("unreachable");
    expect(f.choices.map((c) => c.id)).toEqual(["__compose"]);
    // Nothing ran on the partner site on the way to asking.
    expect(calls).toEqual([]);
  }, 30_000);

  it("still stops at the gate afterwards", async () => {
    const { s, calls } = session(() => {});
    await s.start();
    await s.handle("add_to_cart");
    const f = await s.submitText("oat-1");
    expect(f.kind).toBe("confirm");
    expect(calls).toEqual([]);
    await s.handle("__confirm");
    expect(calls).toEqual(["add_to_cart"]);
  }, 30_000);
});
