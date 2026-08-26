import type { ToolDescriptor } from "@dusky/contracts";
import { describe, expect, it } from "vitest";
import {
  candidatesFromResult,
  confirmFrame,
  factsFromResult,
  idleFrame,
  isOperable,
  MAX_CHOICES,
  nextMissingParam,
  outcomeFromResult,
  parameters,
  paramFrame,
} from "./index.js";

const tool = (p: Partial<ToolDescriptor>): ToolDescriptor => ({
  name: "x",
  description: "",
  origin: "https://shop.test",
  inputSchema: null,
  annotations: { readOnlyHint: false, untrustedContentHint: false },
  ...p,
});

/**
 * The load-bearing test for the whole product thesis: a tool this codebase has
 * never seen, from a site nobody integrated, must still render.
 */
describe("a never-before-seen tool", () => {
  const invented = tool({
    name: "schedule_pickup",
    description: "Schedule a parcel pickup",
    inputSchema: {
      type: "object",
      properties: {
        window: {
          type: "string",
          enum: ["morning", "afternoon", "evening"],
          description: "Pickup window?",
        },
        fragile: { type: "boolean" },
      },
      required: ["window"],
    },
  });

  it("is operable on a six-key display", () => {
    expect(isOperable(invented)).toBe(true);
  });

  it("derives its parameters from the schema alone", () => {
    const ps = parameters(invented);
    expect(ps.map((p) => [p.name, p.kind, p.required])).toEqual([
      ["window", "enum", true],
      ["fragile", "boolean", false],
    ]);
  });

  it("turns an enum into one choice per value, using the schema description", () => {
    const p = nextMissingParam(invented, {})!;
    const f = paramFrame("Parcels", invented, p);
    expect(f.kind).toBe("choose");
    if (f.kind !== "choose") throw new Error("unreachable");
    expect(f.title).toBe("Pickup window?");
    expect(f.choices.map((c) => c.id)).toEqual(["morning", "afternoon", "evening"]);
  });

  it("stops asking once required parameters are filled", () => {
    expect(nextMissingParam(invented, { window: "morning" })).toBeNull();
  });
});

describe("display constraints", () => {
  it("never emits more choices than fit on a 600x600 waveguide", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      tool({ name: `tool_${i}`, annotations: { readOnlyHint: true, untrustedContentHint: false } }),
    );
    const f = idleFrame("Big Source", many);
    if (f.kind !== "idle") throw new Error("unreachable");
    expect(f.choices.length).toBeLessThanOrEqual(MAX_CHOICES);
    expect(f.choices.at(-1)!.id).toBe("__more");
  });

  it("hides tools it cannot honestly drive rather than faking a frame", () => {
    const nested = tool({
      name: "bulk_upload",
      inputSchema: { type: "object", properties: { rows: { type: "array" } }, required: ["rows"] },
    });
    expect(isOperable(nested)).toBe(false);
    const f = idleFrame("Src", [nested]);
    if (f.kind !== "idle") throw new Error("unreachable");
    expect(f.choices).toHaveLength(0);
  });
});

describe("results become the next frame's choices", () => {
  it("extracts candidates from an arbitrary tool result", () => {
    const raw = JSON.stringify({
      results: [
        { id: "oat-1", name: "Organic oat milk", price: 4.29 },
        { id: "oat-2", name: "Barista oat milk", price: 5.1 },
      ],
    });
    expect(candidatesFromResult(raw)).toEqual([
      { id: "oat-1", label: "Organic oat milk", meta: "$4.29" },
      { id: "oat-2", label: "Barista oat milk", meta: "$5.10" },
    ]);
  });

  it("returns nothing rather than inventing structure", () => {
    expect(candidatesFromResult("not json")).toEqual([]);
    expect(candidatesFromResult(JSON.stringify({ ok: true }))).toEqual([]);
  });

  it("fills a bare string parameter from a prior read result", () => {
    const add = tool({
      name: "add_to_cart",
      inputSchema: {
        type: "object",
        properties: { product_id: { type: "string" } },
        required: ["product_id"],
      },
    });
    const p = nextMissingParam(add, {})!;
    expect(p.kind).toBe("text");
    const f = paramFrame(
      "Shop",
      add,
      p,
      candidatesFromResult(
        JSON.stringify([{ id: "oat-1", name: "Organic oat milk", price: 4.29 }]),
      ),
    );
    if (f.kind !== "choose") throw new Error("unreachable");
    // Not a composer prompt: real choices, derived from the earlier result.
    expect(f.choices[0]).toEqual({ id: "oat-1", label: "Organic oat milk", meta: "$4.29" });
  });
});

describe("the gate", () => {
  it("offers confirm and cancel, with cancel marked dangerous", () => {
    const f = confirmFrame("Shop", tool({ name: "add_to_cart" }), "Organic oat milk", "$4.29");
    if (f.kind !== "confirm") throw new Error("unreachable");
    expect(f.target).toBe("Organic oat milk");
    expect(f.consequence).toBe("$4.29");
    expect(f.choices.map((c) => c.id)).toEqual(["__confirm", "__cancel"]);
    expect(f.choices[1]!.tone).toBe("danger");
  });
});

/**
 * Reading an arbitrary tool result.
 *
 * The site whose keys these tests DO NOT use is the point. Dusky's claim is
 * that it works against a tool nobody has ever seen, and the previous
 * summarizer quietly failed that claim for every site except the first-party
 * test market.
 */
describe("facts lifted from a result", () => {
  it("reads a shape nobody has seen before", () => {
    const raw = JSON.stringify({
      reservation_id: "R-8841",
      restaurant: "Kaldi House",
      party_size: 2,
      confirmed: true,
    });
    expect(factsFromResult(raw)).toEqual([
      { label: "Reservation id", value: "R-8841" },
      { label: "Restaurant", value: "Kaldi House" },
      { label: "Party size", value: "2" },
      { label: "Confirmed", value: "Yes" },
    ]);
  });

  it("reads camelCase as readily as snake_case", () => {
    expect(factsFromResult(JSON.stringify({ orderNumber: "A7" }))).toEqual([
      { label: "Order number", value: "A7" },
    ]);
  });

  it("formats anything money-shaped, because a misread price is the worst error", () => {
    const facts = factsFromResult(JSON.stringify({ total: 4.3, subtotal: 4, quantity: 2 }));
    expect(facts).toEqual([
      { label: "Total", value: "$4.30" },
      { label: "Subtotal", value: "$4.00" },
      { label: "Quantity", value: "2" },
    ]);
  });

  it("reads through a single wrapper object", () => {
    const raw = JSON.stringify({ product: { name: "Organic oat milk", price: 4.29 } });
    expect(factsFromResult(raw)).toEqual([
      { label: "Name", value: "Organic oat milk" },
      { label: "Price", value: "$4.29" },
    ]);
  });

  it("names what is in a list rather than counting it", () => {
    // "1 item" for a cart holding oat milk reads as an empty cart, which is
    // how this was found: on real glasses, after a real purchase.
    const raw = JSON.stringify({
      items: [{ id: "oat-1", name: "Organic oat milk" }],
      total: 4.29,
    });
    expect(factsFromResult(raw)).toEqual([
      { label: "Items", value: "Organic oat milk" },
      { label: "Total", value: "$4.29" },
    ]);
  });

  it("counts only when there is nothing nameable in the list", () => {
    expect(factsFromResult(JSON.stringify({ items: [1, 2, 3] }))).toEqual([
      { label: "Items", value: "3 items" },
    ]);
  });

  it("says how many it did not name rather than dropping them silently", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`,
      name: `Product ${i}`,
    }));
    const shown = factsFromResult(JSON.stringify({ items: many }))[0]?.value ?? "";
    expect(shown).toMatch(/\+3 more|\.\.\.$/);
  });

  it("shows nothing it cannot show honestly", () => {
    // A nested object cannot be checked at a glance, so it is not offered.
    expect(factsFromResult(JSON.stringify({ meta: { a: { b: 1 } }, ok: true }))).toEqual([]);
    expect(factsFromResult("not json")).toEqual([]);
  });

  it("fits the frame", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`field_${i}`, `value ${i}`]),
    );
    expect(factsFromResult(JSON.stringify(wide))).toHaveLength(4);
  });
});

describe("whether a result says it worked", () => {
  it("treats a returned answer as success by default", () => {
    expect(outcomeFromResult(JSON.stringify({ added: "oat milk" }))).toEqual({ ok: true });
    expect(outcomeFromResult("plain text")).toEqual({ ok: true });
  });

  it("believes an explicit failure, whatever the call did", () => {
    // Rule 3 cuts both ways: a returned {"ok": false} IS a returned result,
    // and reporting it as success is asserting from having called.
    expect(outcomeFromResult(JSON.stringify({ ok: false, message: "Out of stock" }))).toEqual({
      ok: false,
      message: "Out of stock",
    });
    expect(outcomeFromResult(JSON.stringify({ success: false }))).toEqual({
      ok: false,
      message: undefined,
    });
    expect(outcomeFromResult(JSON.stringify({ error: "card declined" }))).toEqual({
      ok: false,
      message: "card declined",
    });
    expect(outcomeFromResult(JSON.stringify({ error: { message: "nope" } }))).toEqual({
      ok: false,
      message: "nope",
    });
  });

  it("does not invent a failure from an empty or absent signal", () => {
    expect(outcomeFromResult(JSON.stringify({ error: "" })).ok).toBe(true);
    expect(outcomeFromResult(JSON.stringify({ ok: true })).ok).toBe(true);
  });
});

describe("saying what you want", () => {
  const t = (name: string): ToolDescriptor => ({
    name,
    description: "",
    origin: "https://shop.test",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
  });

  it("offers the composer when the session can interpret a request", () => {
    const f = idleFrame("Shop", [t("a"), t("b")], 0, true);
    if (f.kind !== "idle") throw new Error("unreachable");
    // Last, so a new menu focuses an action rather than opening a text field.
    expect(f.choices.map((c) => c.id)).toEqual(["a", "b", "__compose"]);
    expect(f.note).toContain("speak");
  });

  // A control that looks like it works, takes what you say and does nothing
  // with it is worse than no control at all.
  it("offers nothing to speak into when nothing could interpret it", () => {
    const f = idleFrame("Shop", [t("a")], 0, false);
    if (f.kind !== "idle") throw new Error("unreachable");
    expect(f.choices.map((c) => c.id)).toEqual(["a"]);
    expect(f.note).not.toContain("speak");
  });

  it("keeps the composer reachable on every page rather than paginating it away", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map(t);
    for (const page of [0, 1, 2]) {
      const f = idleFrame("Shop", many, page, true);
      if (f.kind !== "idle") throw new Error("unreachable");
      expect(f.choices.at(-1)?.id, `page ${page}`).toBe("__compose");
      expect(f.choices.length, `page ${page} must fit 600x600`).toBeLessThanOrEqual(MAX_CHOICES);
    }
  });
});
