import type { ToolDescriptor } from "@dusky/contracts";
import { describe, expect, it, vi } from "vitest";
import { type Planner, Session, type ToolRunner } from "./index.js";

const tool = (p: Partial<ToolDescriptor>): ToolDescriptor => ({
  name: "x",
  description: "",
  origin: "https://shop.test",
  inputSchema: null,
  annotations: { readOnlyHint: false, untrustedContentHint: false },
  ...p,
});

const SEARCH = tool({
  name: "search_products",
  description: "Search the catalog",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  annotations: { readOnlyHint: true, untrustedContentHint: false },
});

const ADD = tool({
  name: "add_to_cart",
  description: "Add a product to the cart, charged at checkout",
  inputSchema: {
    type: "object",
    properties: { product_id: { type: "string", description: "Which product?" } },
    required: ["product_id"],
  },
});

function fakeRunner(over: Partial<ToolRunner> = {}): ToolRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    discover: over.discover ?? (async () => [SEARCH, ADD]),
    invoke:
      over.invoke ??
      (async (_origin, name) => {
        calls.push(name);
        if (name === "search_products") {
          return JSON.stringify({
            results: [
              { id: "oat-1", name: "Organic oat milk", price: 4.29 },
              { id: "oat-2", name: "Barista oat milk", price: 5.1 },
            ],
          });
        }
        return JSON.stringify({ ok: true, added: "Organic oat milk", cart_total: 4.29 });
      }),
  } as ToolRunner & { calls: string[] };
}

describe("menu", () => {
  it("builds itself from discovered tools", async () => {
    const s = new Session({ source: "Verdant Market", runner: fakeRunner() });
    const f = await s.start();
    expect(f.kind).toBe("idle");
    if (f.kind !== "idle") throw new Error("unreachable");
    expect(f.choices.map((c) => c.id)).toEqual(["search_products", "add_to_cart"]);
    expect(f.choices[1]!.label).toBe("Add to cart");
  });
});

describe("the confirmation gate", () => {
  it("stops a consequential tool and does NOT invoke before approval", async () => {
    const runner = fakeRunner();
    const s = new Session({ source: "Shop", runner });
    await s.start();
    await s.handle("add_to_cart");
    const f = await s.handle("oat-1"); // supply product_id via the composer path

    expect(f.kind).toBe("confirm");
    if (f.kind !== "confirm") throw new Error("unreachable");
    expect(f.target).toBe("oat-1");
    // The critical assertion: nothing ran yet.
    expect(runner.calls).toEqual([]);
  });

  it("invokes only after an explicit confirm", async () => {
    const runner = fakeRunner();
    const s = new Session({ source: "Shop", runner });
    await s.start();
    await s.handle("add_to_cart");
    await s.handle("oat-1");
    const f = await s.handle("__confirm");

    expect(runner.calls).toEqual(["add_to_cart"]);
    expect(f.kind).toBe("result");
    if (f.kind !== "result") throw new Error("unreachable");
    // Reported from the site's own returned value, not from having called.
    expect(f.detail).toContain("Organic oat milk");
  });

  it("cancels without invoking", async () => {
    const runner = fakeRunner();
    const s = new Session({ source: "Shop", runner });
    await s.start();
    await s.handle("add_to_cart");
    await s.handle("oat-1");
    const f = await s.handle("__cancel");
    expect(runner.calls).toEqual([]);
    expect(f.kind).toBe("idle");
  });

  it("runs a read-only tool with no gate at all", async () => {
    const runner = fakeRunner();
    const s = new Session({ source: "Shop", runner });
    await s.start();
    await s.handle("search_products");
    const f = await s.submitText("oat");
    expect(runner.calls).toEqual(["search_products"]);
    expect(f.kind).toBe("result");
  });

  it("refuses a confirmation that went stale when tools changed", async () => {
    let t = 1000;
    const runner = fakeRunner();
    const s = new Session({ source: "Shop", runner, now: () => t });
    await s.start();
    await s.handle("add_to_cart");
    await s.handle("oat-1");
    t = 1500;
    await s.start(); // tools re-discovered underneath the wearer
    t = 2000;
    const f = await s.handle("__confirm");
    expect(runner.calls).toEqual([]);
    expect(f.kind).toBe("error");
  });
});

describe("resolving a parameter from a prior read", () => {
  const planner: Planner = {
    pickTool: async () => ({ name: "add_to_cart", args: {} }),
    planResolver: async () => ({ name: "search_products", args: { query: "oat" } }),
  };

  it("turns a read-only tool's results into choices", async () => {
    const runner = fakeRunner();
    const s = new Session({ source: "Shop", runner, planner });
    await s.start();
    const f = await s.handle("add_to_cart");

    expect(runner.calls).toEqual(["search_products"]);
    expect(f.kind).toBe("choose");
    if (f.kind !== "choose") throw new Error("unreachable");
    expect(f.choices).toEqual([
      { id: "oat-1", label: "Organic oat milk", meta: "$4.29" },
      { id: "oat-2", label: "Barista oat milk", meta: "$5.10" },
    ]);
  });

  // A hostile or confused planner must not be able to run a consequential
  // tool by naming it as a "resolver". Enforced in code, not by the model.
  it("ignores a planner that nominates a non-read-only resolver", async () => {
    const runner = fakeRunner();
    const bad: Planner = {
      pickTool: async () => null,
      planResolver: async () => ({ name: "add_to_cart", args: { product_id: "oat-1" } }),
    };
    const s = new Session({ source: "Shop", runner, planner: bad });
    await s.start();
    await s.handle("add_to_cart");
    expect(runner.calls).toEqual([]);
  });
});

describe("failure handling", () => {
  it("treats a timeout as unknown rather than as failure", async () => {
    vi.useFakeTimers();
    const runner = fakeRunner({ invoke: () => new Promise(() => {}) });
    const s = new Session({ source: "Shop", runner, invokeTimeoutMs: 50 });
    await s.start();
    await s.handle("add_to_cart");
    await s.handle("oat-1");
    const p = s.handle("__confirm");
    await vi.advanceTimersByTimeAsync(60);
    const f = await p;
    expect(f.kind).toBe("error");
    if (f.kind !== "error") throw new Error("unreachable");
    expect(f.detail).toContain("may still have run");
    // Never offer a one-tap retry for something that may have charged a card.
    expect(f.retryable).toBe(false);
    vi.useRealTimers();
  });

  it("offers retry for a failed read", async () => {
    const runner = fakeRunner({
      invoke: async () => {
        throw new Error("network");
      },
    });
    const s = new Session({ source: "Shop", runner });
    await s.start();
    await s.handle("search_products");
    const f = await s.submitText("oat");
    expect(f.kind).toBe("error");
    if (f.kind !== "error") throw new Error("unreachable");
    expect(f.retryable).toBe(true);
  });
});
