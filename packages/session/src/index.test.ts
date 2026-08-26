import type { DisplayFrame, ToolDescriptor } from "@dusky/contracts";
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

/**
 * A planner is a port, so the machine cannot assume a careful implementation
 * behind it. These are the cases where a planner is wrong, hostile or simply
 * broken, and the machine has to be the thing that holds.
 */
describe("a planner the machine does not trust", () => {
  const consequentialResolver: Planner = {
    pickTool: async () => null,
    planResolver: async () => ({ name: "add_to_cart", args: { product_id: "oat-1" } }),
  };

  function recordingRunner() {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const runner: ToolRunner = {
      discover: async () => [SEARCH, ADD],
      invoke: async (_origin, name, args) => {
        calls.push({ name, args });
        return JSON.stringify({ ok: true, added: "Organic oat milk", cart_total: 4.29 });
      },
    };
    return { runner, calls };
  }

  it("falls back to the menu when the planner throws", async () => {
    const runner = fakeRunner();
    const audit: string[] = [];
    const exploding: Planner = {
      pickTool: async () => {
        throw new Error("model unreachable");
      },
      planResolver: async () => null,
    };
    const s = new Session({
      source: "Shop",
      runner,
      planner: exploding,
      onAudit: (e) => audit.push(`${e.kind}:${JSON.stringify(e.detail ?? {})}`),
    });
    await s.start();
    const f = await s.submitText("find me some oat milk");
    expect(f.kind).toBe("idle");
    expect(runner.calls).toEqual([]);
    expect(audit.some((a) => a.startsWith("plan:") && a.includes("model unreachable"))).toBe(true);
  });

  it("ignores a tool this session never discovered, and records that it tried", async () => {
    const runner = fakeRunner();
    const audit: { kind: string; toolName?: string }[] = [];
    const inventing: Planner = {
      pickTool: async () => ({ name: "wire_money", args: { amount: 5000 } }),
      planResolver: async () => null,
    };
    const s = new Session({
      source: "Shop",
      runner,
      planner: inventing,
      onAudit: (e) => audit.push({ kind: e.kind, toolName: e.toolName }),
    });
    await s.start();
    const f = await s.submitText("pay my rent");
    expect(f.kind).toBe("idle");
    expect(runner.calls).toEqual([]);
    expect(audit).toContainEqual({ kind: "plan", toolName: "wire_money" });
  });

  // The gate is not the only way an argument can do damage. An invented
  // `force` reaching a site would bypass the gate without touching the gate.
  it("strips arguments the tool never declared before anything can run", async () => {
    const { runner, calls } = recordingRunner();
    const smuggling: Planner = {
      pickTool: async () => ({
        name: "add_to_cart",
        args: { product_id: "oat-1", force: true, confirm: true, quantity: 99 },
      }),
      planResolver: async () => null,
    };
    const s = new Session({ source: "Shop", runner, planner: smuggling });
    await s.start();
    await s.submitText("add the oat milk");
    await s.handle("__confirm");
    expect(calls).toEqual([{ name: "add_to_cart", args: { product_id: "oat-1" } }]);
  });

  it("still stops at the gate when the planner supplies every argument", async () => {
    const { runner, calls } = recordingRunner();
    const eager: Planner = {
      pickTool: async () => ({ name: "add_to_cart", args: { product_id: "oat-1" } }),
      planResolver: async () => null,
    };
    const s = new Session({ source: "Shop", runner, planner: eager });
    await s.start();
    const f = await s.submitText("add the oat milk");
    // A complete proposal is still only a proposal.
    expect(f.kind).toBe("confirm");
    expect(calls).toEqual([]);
  });

  it("records a refused resolver rather than silently dropping it", async () => {
    // The one path where a proposal would run with no human in front of it,
    // so the refusal has to be visible in the audit trail afterwards.
    const runner = fakeRunner();
    const audit: { kind: string; toolName?: string; detail?: Record<string, unknown> }[] = [];
    const s = new Session({
      source: "Shop",
      runner,
      planner: consequentialResolver,
      onAudit: (e) => audit.push({ kind: e.kind, toolName: e.toolName, detail: e.detail }),
    });
    await s.start();
    await s.handle("add_to_cart");
    expect(runner.calls).toEqual([]);
    expect(audit).toContainEqual({
      kind: "plan",
      toolName: "add_to_cart",
      detail: { path: "planResolver", accepted: false, reason: "not read-only" },
    });
  });

  it("keeps collecting the parameter when the resolver planner throws", async () => {
    const runner = fakeRunner();
    const exploding: Planner = {
      pickTool: async () => null,
      planResolver: async () => {
        throw new Error("model unreachable");
      },
    };
    const s = new Session({ source: "Shop", runner, planner: exploding });
    await s.start();
    const f = await s.handle("add_to_cart");
    // The wearer is asked for the value instead of being stranded.
    expect(f.kind).toBe("choose");
    if (f.kind !== "choose") throw new Error("unreachable");
    expect(f.choices.map((c) => c.id)).toEqual(["__compose"]);
    expect(runner.calls).toEqual([]);
  });
});

/**
 * On a cursorless display an unchanged screen is indistinguishable from a
 * crash, so every wait the wearer caused must be visible WHILE it happens.
 * Returning the final frame is not enough: a transport that only reads the
 * settled frame shows the wearer nothing for the whole of a model call and a
 * tool invocation.
 */
describe("what the wearer sees while waiting", () => {
  function watched(planner?: Planner) {
    const seen: DisplayFrame[] = [];
    const runner = fakeRunner();
    const s = new Session({
      source: "Shop",
      runner,
      planner,
      onTransition: (f) => seen.push(f),
    });
    return { s, seen, runner };
  }

  it("shows a working frame during the tool call, not just the result after it", async () => {
    const { s, seen } = watched();
    await s.start();
    await s.handle("add_to_cart");
    await s.handle("oat-1");
    seen.length = 0;
    await s.handle("__confirm");
    expect(seen.map((f) => f.kind)).toEqual(["working", "result"]);
  });

  it("echoes what it heard while the planner is thinking", async () => {
    const slow: Planner = {
      pickTool: async () => ({ name: "add_to_cart", args: { product_id: "oat-1" } }),
      planResolver: async () => null,
    };
    const { s, seen } = watched(slow);
    await s.start();
    seen.length = 0;
    await s.submitText("add the organic oat milk");

    const busy = seen[0];
    expect(busy?.kind).toBe("working");
    // The wearer must be able to catch a misheard request before it acts.
    expect(busy?.title).toBe("add the organic oat milk");
    expect(seen.map((f) => f.kind)).toEqual(["working", "confirm"]);
  });

  it("shows that it is looking up options before the candidates appear", async () => {
    const planner: Planner = {
      pickTool: async () => null,
      planResolver: async () => ({ name: "search_products", args: { query: "oat" } }),
    };
    const { s, seen } = watched(planner);
    await s.start();
    seen.length = 0;
    await s.handle("add_to_cart");
    expect(seen.map((f) => f.kind)).toEqual(["working", "choose"]);
    expect(seen[0]?.kind === "working" && seen[0].note).toBe("Looking up your options");
  });
});

/**
 * Rule 3 cuts both ways. "Asserted from a returned result" is broken just as
 * badly by calling every return a success as by never checking at all.
 */
describe("reporting what the site actually said", () => {
  function runnerReturning(value: string) {
    const calls: string[] = [];
    const runner: ToolRunner = {
      discover: async () => [SEARCH, ADD],
      invoke: async (_o, name) => {
        calls.push(name);
        return value;
      },
    };
    return { runner, calls };
  }

  async function runToResult(value: string) {
    const { runner } = runnerReturning(value);
    const s = new Session({ source: "Shop", runner });
    await s.start();
    await s.handle("add_to_cart");
    await s.handle("oat-1");
    return s.handle("__confirm");
  }

  it("does not call a returned failure a success", async () => {
    const f = await runToResult(JSON.stringify({ ok: false, message: "Out of stock" }));
    expect(f.kind).toBe("result");
    if (f.kind !== "result") throw new Error("unreachable");
    expect(f.ok).toBe(false);
    expect(f.title).toContain("did not work");
    expect(f.detail).toBe("Out of stock");
  });

  it("reports a success the site did confirm", async () => {
    const f = await runToResult(
      JSON.stringify({ ok: true, added: "Organic oat milk", total: 4.29 }),
    );
    if (f.kind !== "result") throw new Error("unreachable");
    expect(f.ok).toBe(true);
    expect(f.facts).toEqual([
      { label: "Added", value: "Organic oat milk" },
      { label: "Total", value: "$4.29" },
    ]);
  });

  // The old summarizer matched `added` and `cart_total`, which are the exact
  // keys the first-party test market returns. Any other site fell through to
  // truncated JSON, which quietly made the whole no-per-site-branching claim
  // untrue at the last frame of every flow.
  it("reads a site whose keys Dusky has never seen", async () => {
    const f = await runToResult(
      JSON.stringify({ reservation_id: "R-8841", restaurant: "Kaldi House", party_size: 2 }),
    );
    if (f.kind !== "result") throw new Error("unreachable");
    expect(f.ok).toBe(true);
    expect(f.facts).toEqual([
      { label: "Reservation id", value: "R-8841" },
      { label: "Restaurant", value: "Kaldi House" },
      { label: "Party size", value: "2" },
    ]);
  });

  it("falls back to the raw text rather than an empty frame", async () => {
    const f = await runToResult("done and dusted");
    if (f.kind !== "result") throw new Error("unreachable");
    expect(f.facts).toBeUndefined();
    expect(f.detail).toBe("done and dusted");
  });
});

/**
 * The menu said "Tap to speak" long before there was anything to tap.
 *
 * `__compose` was only ever produced by the parameter-collection frame, so
 * `submitIntent`, and with it the whole planner, was unreachable from the
 * glasses. It could only be driven by an agent through send_task_to_display.
 */
describe("speaking from the glasses", () => {
  const planner: Planner = {
    pickTool: async (intent) =>
      intent.includes("oat") ? { name: "add_to_cart", args: { product_id: "oat-1" } } : null,
    planResolver: async () => null,
  };

  it("offers a way to speak when a planner is attached", async () => {
    const s = new Session({ source: "Shop", runner: fakeRunner(), planner });
    const f = await s.start();
    if (f.kind !== "idle") throw new Error("unreachable");
    expect(f.choices.map((c) => c.id)).toContain("__compose");
  });

  it("offers none when nothing could interpret it", async () => {
    const s = new Session({ source: "Shop", runner: fakeRunner() });
    const f = await s.start();
    if (f.kind !== "idle") throw new Error("unreachable");
    expect(f.choices.map((c) => c.id)).not.toContain("__compose");
  });

  it("routes what the wearer says to the planner, not to a parameter", async () => {
    const runner = fakeRunner();
    const s = new Session({ source: "Shop", runner, planner });
    await s.start();
    const f = await s.submitText("add the organic oat milk");
    // Chosen by the planner and still stopped at the gate.
    expect(f.kind).toBe("confirm");
    expect(runner.calls).toEqual([]);
  });

  it("returns to the menu when the planner cannot tell what was meant", async () => {
    const s = new Session({ source: "Shop", runner: fakeRunner(), planner });
    await s.start();
    const f = await s.submitText("something completely unrelated");
    expect(f.kind).toBe("idle");
    if (f.kind !== "idle") throw new Error("unreachable");
    // And the way to try again is still on screen.
    expect(f.choices.map((c) => c.id)).toContain("__compose");
  });
});

/**
 * Everything the Display can send is text: a choice id, or whatever the
 * on-glasses composer committed. What reaches the SITE has to be what that
 * site declared it would receive.
 *
 * This went unnoticed while every parameter in the repository was a bare
 * string. A second source with an integer enum and a boolean is what made it
 * visible, which is the whole reason a second source exists.
 */
describe("argument types reaching a site", () => {
  const BOOK = tool({
    name: "book_table",
    description: "Hold a table under a booking",
    inputSchema: {
      type: "object",
      properties: {
        party_size: { type: "integer", enum: [1, 2, 3, 4], description: "How many?" },
        outdoor_seating: { type: "boolean", description: "Sit outside?" },
        seats_label: { type: "string", description: "Anything else?" },
      },
      required: ["party_size", "outdoor_seating", "seats_label"],
    },
  });

  async function argsFor(answers: string[]): Promise<Record<string, unknown>> {
    let sent: Record<string, unknown> = {};
    const runner: ToolRunner = {
      discover: async () => [BOOK],
      invoke: async (_o, _n, args) => {
        sent = args;
        return JSON.stringify({ ok: true, reservation_id: "AO-4417" });
      },
    };
    const s = new Session({ source: "Amber & Oak", runner });
    await s.start();
    await s.handle("book_table");
    for (const a of answers) {
      // A choice id and a composed string arrive by different doors, and both
      // have to end up as the declared type.
      if (a.startsWith("text:")) await s.submitText(a.slice(5));
      else await s.handle(a);
    }
    await s.handle("__confirm");
    return sent;
  }

  it("sends an integer enum as the declared number, not as its label", async () => {
    const args = await argsFor(["2", "false", "text:by the window"]);
    expect(args["party_size"]).toBe(2);
  });

  it("sends a declared boolean as a boolean", async () => {
    const args = await argsFor(["2", "false", "text:by the window"]);
    expect(args["outdoor_seating"]).toBe(false);
  });

  it("leaves a string parameter alone even when it reads like a literal", async () => {
    // "true" is a perfectly ordinary string. Only a parameter the site
    // declared as boolean may be turned into one.
    const args = await argsFor(["2", "true", "text:true"]);
    expect(args["seats_label"]).toBe("true");
    expect(args["outdoor_seating"]).toBe(true);
  });
});
