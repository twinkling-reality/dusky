import type { ToolDescriptor } from "@dusky/contracts";
import { describe, expect, it } from "vitest";
import { classify, gate, isAutoRetryable, isConfirmationFresh } from "./index.js";

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
