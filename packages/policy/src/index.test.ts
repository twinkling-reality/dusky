import type { ToolDescriptor } from "@dusky/contracts";
import { describe, expect, it } from "vitest";
import { classify, classifyDetailed, gate, isAutoRetryable, isConfirmationFresh } from "./index.js";

const tool = (p: Partial<ToolDescriptor>): ToolDescriptor => ({
  name: "x",
  description: "",
  origin: "https://example.test",
  inputSchema: null,
  annotations: { readOnlyHint: false, untrustedContentHint: false },
  ...p,
});

describe("consequence classification", () => {
  it("honors a read-only annotation for an innocuous tool", () => {
    const t = tool({
      name: "search_products",
      annotations: { readOnlyHint: true, untrustedContentHint: false },
    });
    expect(classify(t)).toBe("read");
    expect(gate(t).requiresConfirmation).toBe(false);
  });

  it("defaults an unannotated, unrecognized tool to a gated write", () => {
    const t = tool({ name: "frobnicate_widget", description: "does a thing" });
    expect(classify(t)).toBe("write");
    expect(gate(t).requiresConfirmation).toBe(true);
  });

  it("gates a financial tool", () => {
    expect(classify(tool({ name: "add_to_cart", description: "Add a product to the cart" }))).toBe(
      "financial",
    );
  });

  it("gates a destructive tool", () => {
    expect(classify(tool({ name: "delete_account" }))).toBe("destructive");
  });

  it("gates outward-facing actions even when they cost nothing", () => {
    expect(classify(tool({ name: "send_message" }))).toBe("write");
  });

  // The adversarial case: a hostile or careless site claims read-only on a
  // tool that spends money. The annotation must not launder the consequence.
  it("refuses to let a read-only annotation launder a financial verb", () => {
    const t = tool({
      name: "purchase_item",
      description: "Buy the item immediately",
      annotations: { readOnlyHint: true, untrustedContentHint: false },
    });
    expect(classify(t)).toBe("financial");
    expect(gate(t).requiresConfirmation).toBe(true);
    expect(gate(t).reason).toMatch(/claims read-only/);
  });

  // The misleading-name case: nothing in the name signals danger, so the
  // default-deny rule is what protects the wearer.
  it("gates a deceptively named tool via default deny", () => {
    const t = tool({ name: "preview_order", description: "Shows the order" });
    expect(gate(t).requiresConfirmation).toBe(true);
  });
});

describe("retry safety", () => {
  it("never auto-retries a tool that may have charged a card", () => {
    expect(isAutoRetryable(tool({ name: "checkout" }))).toBe(false);
  });
  it("auto-retries reads", () => {
    const t = tool({
      name: "list_items",
      annotations: { readOnlyHint: true, untrustedContentHint: false },
    });
    expect(isAutoRetryable(t)).toBe(true);
  });
});

describe("confirmation freshness", () => {
  it("invalidates a confirmation when the tool set changed underneath", () => {
    expect(isConfirmationFresh(1000, 1500, 2000)).toBe(false);
  });
  it("invalidates a stale confirmation", () => {
    expect(isConfirmationFresh(0, 0, 200_000)).toBe(false);
  });
  it("accepts a fresh confirmation", () => {
    expect(isConfirmationFresh(1000, 500, 2000)).toBe(true);
  });
});

describe("danger declared in the schema rather than the name", () => {
  /**
   * The lexicons only ever read the tool's name, title and description, so a
   * tool could describe itself blandly, claim to be read-only, and declare
   * what it really does in its parameters. Nothing looked there.
   *
   * A site is not obliged to name itself honestly, which is the entire reason
   * `readOnlyHint` is treated as a claim rather than a permission slip. The
   * schema is the same kind of evidence and was being ignored.
   */
  const bland = (properties: Record<string, unknown>): ToolDescriptor => ({
    name: "apply_changes",
    title: "Apply changes",
    description: "Applies pending changes.",
    origin: "https://plausible.test",
    inputSchema: { type: "object", properties },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
  });

  it("sees a hard verb hiding in a parameter name", () => {
    const c = classifyDetailed(bland({ delete_everything: { type: "boolean" } }));
    expect(c.consequence, "a destructive parameter ran with no human").toBe("destructive");
    expect(c.overrodeAnnotation).toBe(true);
  });

  it("sees a hard verb hiding in a parameter description", () => {
    const c = classifyDetailed(
      bland({ mode: { type: "string", description: "Set to full to purchase the basket." } }),
    );
    expect(c.consequence).toBe("financial");
  });

  it("does not gate a read because a parameter mentions a domain word", () => {
    // `remove` is a SOFT verb. It names a domain rather than an action, and a
    // parameter is weaker evidence about what a TOOL does than its own name,
    // so soft signals still need the tool's own naming behind them.
    const c = classifyDetailed(
      bland({ remove_duplicates: { type: "boolean", description: "Drop repeated rows." } }),
    );
    expect(c.consequence, "a harmless search became a gated action").toBe("read");
  });

  it("survives a tool with no schema at all", () => {
    const c = classifyDetailed({
      name: "look",
      description: "Look at something.",
      origin: "https://plausible.test",
      inputSchema: null,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
    });
    expect(c.consequence).toBe("read");
  });
});

describe("the rule that keeps this package deterministic", () => {
  /**
   * AGENTS.md rule 6: `packages/policy` must stay dependency-free. If it ever
   * imports the agent or a transport, the deterministic guarantee is gone.
   *
   * That was prose with nothing enforcing it. An `import { fetch }`, a clock,
   * or a reach into `packages/frames` for `parameters()` would have failed
   * nothing. The pull is real: this file reads a JSON Schema by hand precisely
   * because the function that already does it lives in another package.
   */
  it("imports one type from one package, and nothing else", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("./index.ts", import.meta.url), "utf8");

    const lines = src.split("\n").filter((l) => /^\s*import\b/.test(l));
    expect(lines).toEqual(['import type { ToolDescriptor } from "@dusky/contracts";']);
  });

  it("declares no dependency but the shared types", async () => {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(new URL("../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["@dusky/contracts"]);
    expect(Object.keys(pkg.devDependencies ?? {})).toEqual([]);
  });

  it("reaches for no clock, no network and no DOM", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("./index.ts", import.meta.url), "utf8");
    // `isConfirmationFresh` takes `now` as an argument for exactly this reason.
    const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of [
      "Date.now",
      "new Date",
      "fetch(",
      "document.",
      "window.",
      "Math.random",
    ]) {
      expect(body, `policy reached for ${forbidden}`).not.toContain(forbidden);
    }
  });
});
