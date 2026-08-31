import type { Choice, ToolDescriptor } from "@dusky/contracts";
import { classify } from "@dusky/policy";
import { describe, expect, it } from "vitest";
import {
  candidatesFromResult,
  confirmFrame,
  factsFromResult,
  idleFrame,
  isOperable,
  label,
  MAX_CHOICES,
  MAX_PROJECTIONS,
  MAX_RESULT_CHARS,
  nextMissingParam,
  outcomeFromResult,
  parameters,
  paramFrame,
  resultFrame,
  shareableProjectionsFromResult,
  siteFromChoice,
  textFromResult,
  toolId,
  transferFrame,
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
    expect(f.choices.map((c) => c.id)).toEqual(["morning", "afternoon", "evening", "__cancel"]);
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

  it("reads any <something>_id, from a site nobody has written", () => {
    // A suffix is the convention. Naming the nouns would mean the compiler
    // knew what kind of site it was looking at, which is the one thing it
    // must never know.
    const raw = JSON.stringify({
      departures: [
        { flight_id: "BA117", title: "London to New York", status: "on time" },
        { flight_id: "BA112", title: "London to Boston", status: "delayed" },
      ],
    });
    expect(candidatesFromResult(raw)).toEqual([
      { id: "BA117", label: "London to New York", meta: "on time" },
      { id: "BA112", label: "London to Boston", meta: "delayed" },
    ]);
  });

  it("prefers a plain id when an object carries both", () => {
    const raw = JSON.stringify([{ id: "ao-m-1930", booking_id: "AO-4417", name: "7:30 PM" }]);
    expect(candidatesFromResult(raw)[0]?.id).toBe("ao-m-1930");
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
    expect(f.choices.at(-1)?.id).toBe("__cancel");
  });
});

describe("an intermediate result in a longer task", () => {
  it("names the next action and the task position without inventing a success", () => {
    const frame = resultFrame("Amber & Oak", "Book table done", {
      ok: true,
      facts: [{ label: "Reservation id", value: "AO-4417" }],
      next: { label: "Add to cart", index: 2, total: 2 },
    });
    expect(frame).toMatchObject({
      kind: "result",
      choices: [{ id: "__next", label: "Next: Add to cart", meta: "2/2" }],
      note: "Each action is checked and approved separately",
    });
  });
});

describe("the gate", () => {
  it("offers confirm and cancel, with cancel marked dangerous", () => {
    const f = confirmFrame("Shop", tool({ name: "add_to_cart" }), "Organic oat milk", "financial");
    if (f.kind !== "confirm") throw new Error("unreachable");
    expect(f.target).toBe("Organic oat milk");
    expect(f.choices.map((c) => c.id)).toEqual(["__confirm", "__cancel"]);
    expect(f.choices[1]!.tone).toBe("danger");
  });

  /*
   * The argument is the ceremony `packages/policy` assigned, not free text.
   * It used to be passed through verbatim, and this test handed it "$4.29",
   * which is not a consequence and which nothing in the product ever sent:
   * the session passed a field it never assigned, so every real confirm frame
   * carried `undefined` and the severity line never rendered at all.
   */
  it("says what approving it will do, in words the panel can show", () => {
    const say = (c?: string) => {
      const f = confirmFrame("Shop", tool({ name: "x" }), "target", c);
      return f.kind === "confirm" ? f.consequence : undefined;
    };
    expect(say("financial")).toMatch(/money/i);
    expect(say("destructive")).toMatch(/undone/i);
    expect(say("write")).toBeTruthy();
    // A read never reaches the gate, so it has nothing to say here.
    expect(say("read")).toBeUndefined();
    expect(say(undefined)).toBeUndefined();
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
    // Tool rows carry a qualified id, because a bare name belongs to whichever
    // origin registered it and two origins may register the same one.
    expect(f.choices.map((c) => c.id)).toEqual([toolId(t("a")), toolId(t("b")), "__compose"]);
    expect(f.note).toContain("speak");
  });

  // A control that looks like it works, takes what you say and does nothing
  // with it is worse than no control at all.
  it("offers nothing to speak into when nothing could interpret it", () => {
    const f = idleFrame("Shop", [t("a")], 0, false);
    if (f.kind !== "idle") throw new Error("unreachable");
    expect(f.choices.map((c) => c.id)).toEqual([toolId(t("a"))]);
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

  // The session increments `page` forever and never asks how many there are,
  // so paging has to terminate here or not at all. It used to clamp, which
  // meant the last page answered "More" with a byte-identical frame.
  it("wraps to the first page rather than redrawing the last one", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map(t);
    const labels = (page: number) => {
      const f = idleFrame("Shop", many, page, true);
      if (f.kind !== "idle") throw new Error("unreachable");
      return f.choices.filter((c) => c.id !== "__more" && c.id !== "__compose").map((c) => c.label);
    };

    // Two tools a page once the composer and "More" have taken their slots.
    expect(labels(0)).toEqual(["A", "B"]);
    expect(labels(1)).toEqual(["C", "D"]);
    expect(labels(2)).toEqual(["E", "F"]);
    // The press that used to do nothing.
    expect(labels(3)).toEqual(["A", "B"]);
    expect(labels(7)).toEqual(["C", "D"]);
  });

  // Two adjacent pages that both say "2/2" tell a wearer nothing about where
  // they are, on a panel with no scrollbar to tell them instead.
  it("numbers the page the wearer is on, not the one the button leads to", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map(t);
    const meta = (page: number) => {
      const f = idleFrame("Shop", many, page, true);
      if (f.kind !== "idle") throw new Error("unreachable");
      return f.choices.find((c) => c.id === "__more")?.meta;
    };
    expect(meta(0)).toBe("1/3");
    expect(meta(1)).toBe("2/3");
    expect(meta(2)).toBe("3/3");
    expect(meta(3)).toBe("1/3");
  });
});

/**
 * The order the wearer's menu is in.
 *
 * `getTools` ordering is the browser's business, so a menu built by mapping
 * over discovery is a menu that can come back different on a reload of the
 * same shop. Every assertion here is about what a wearer can actually reach
 * and in what order, which is why it pages through the frames rather than
 * reaching for the comparator behind them: the comparator is an implementation
 * detail and the sequence of rows is the product.
 */
describe("the order of the wearer's menu", () => {
  const readOnly = { readOnlyHint: true, untrustedContentHint: false } as const;

  /** Every row on one menu, following "More" but not stepping into a site. */
  const rowsOf = (tools: ToolDescriptor[], canSpeak: boolean, site?: string): Choice[] => {
    const out: Choice[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < 64; page += 1) {
      const f = idleFrame("Src", tools, page, canSpeak, undefined, site ? { site } : {});
      if (f.kind !== "idle") throw new Error("unreachable");
      let wrapped = false;
      for (const c of f.choices) {
        if (c.id === "__more" || c.id === "__compose" || c.id === "__home") continue;
        // Pagination wraps, so a repeat is the end of the list.
        if (seen.has(c.id)) {
          wrapped = true;
          break;
        }
        seen.add(c.id);
        out.push(c);
      }
      if (wrapped || !f.choices.some((c) => c.id === "__more")) break;
    }
    return out;
  };

  /**
   * Every tool row a wearer can reach, in the order they can reach it.
   *
   * Follows "More" AND site rows, because a menu that will not fit on one
   * screen shows a row per site and puts that site's actions behind it. What
   * these tests are about is what a wearer can actually get to and in what
   * order, so the walk has to go wherever they can.
   */
  const menuChoices = (tools: ToolDescriptor[], canSpeak = false): Choice[] =>
    rowsOf(tools, canSpeak).flatMap((c) => {
      const site = siteFromChoice(c.id);
      return site ? rowsOf(tools, canSpeak, site) : [c];
    });

  /** Each screen of tool rows the wearer can land on, kept apart. */
  const menuScreens = (tools: ToolDescriptor[], canSpeak = false): Choice[][] => {
    const top = rowsOf(tools, canSpeak);
    const sites = top.map((c) => siteFromChoice(c.id)).filter((o): o is string => o !== null);
    return sites.length > 0 ? sites.map((site) => rowsOf(tools, canSpeak, site)) : [top];
  };

  const menuLabels = (tools: ToolDescriptor[], canSpeak = false): string[] =>
    menuChoices(tools, canSpeak).map((c) => c.label);

  /**
   * Four sites nobody in this repository built, on purpose.
   *
   * A single first-party source teaches you that the code runs and cannot tell
   * you which branches never execute, which is the lesson `apps/reservations`
   * was added for. These reach all four consequence classes and not one of
   * them is a shop.
   *
   * Declared here rather than imported from the corpus in `packages/planner`,
   * because `@dusky/planner` depends on `@dusky/frames` and that edge does not
   * run the other way. The corpus is used from the side that may import it, in
   * `packages/planner/src/menu-order.test.ts`.
   */
  const ELSEWHERE: ToolDescriptor[] = [
    tool({
      origin: "https://bank.test",
      name: "transfer_funds",
      description: "Move money between two accounts.",
    }),
    tool({
      origin: "https://bank.test",
      name: "account_balance",
      title: "Balance",
      description: "What is in the account right now.",
      annotations: readOnly,
    }),
    tool({
      origin: "https://clinic.test",
      name: "delete_record",
      description: "Erase a patient record permanently.",
    }),
    tool({
      origin: "https://clinic.test",
      name: "list_appointments",
      description: "Appointments already in the diary.",
      annotations: readOnly,
    }),
    tool({
      origin: "https://helpdesk.test",
      name: "reply_to_ticket",
      description: "Answer a support ticket.",
    }),
    tool({
      origin: "https://library.test",
      name: "search_catalogue",
      title: "Search the catalogue",
      description: "Look for a book by title or author.",
      annotations: readOnly,
    }),
    tool({
      origin: "https://library.test",
      name: "renew_loan",
      description: "Extend a loan by two weeks.",
    }),
  ];

  const CEREMONY = { read: 0, write: 1, financial: 2, destructive: 3 } as const;
  const toolFor = (id: string): ToolDescriptor => {
    const hit = ELSEWHERE.find((t) => toolId(t) === id);
    if (!hit) throw new Error(`no tool for ${id}`);
    return hit;
  };

  it("does not change when the browser hands the same tools back in another order", () => {
    const forwards = menuChoices(ELSEWHERE).map((c) => c.id);
    // Seven tools across four sites do not fit four rows, so the wearer meets
    // a row per site first. Every one of them is still reachable, which is the
    // property; how many presses away is the layout's business.
    expect(forwards, "every operable tool stays reachable").toHaveLength(ELSEWHERE.length);

    const rotate = (n: number) => [...ELSEWHERE.slice(n), ...ELSEWHERE.slice(0, n)];
    for (let n = 1; n < ELSEWHERE.length; n += 1) {
      expect(
        menuChoices(rotate(n)).map((c) => c.id),
        `rotated by ${n}`,
      ).toEqual(forwards);
    }
    expect(
      menuChoices([...ELSEWHERE].reverse()).map((c) => c.id),
      "reversed",
    ).toEqual(forwards);
  });

  /**
   * `useDpad` focuses choice zero on every new frame, so the first row is one
   * Enter away from whatever happens to be sitting there. What sits there used
   * to be whichever tool the browser listed first.
   */
  it("puts a read under the wearer's thumb, whatever discovery returned first", () => {
    for (const led of ELSEWHERE) {
      const shuffled = [led, ...ELSEWHERE.filter((t) => t !== led)];
      // Row zero of the TOP menu is a site row here, which is navigation and
      // costs nothing at all: a stronger version of the same guarantee, since
      // nothing on that screen can be run by accident.
      const top = idleFrame("Src", shuffled, 0, true);
      if (top.kind !== "idle") throw new Error("unreachable");
      expect(siteFromChoice(top.choices[0]?.id ?? ""), `discovery led with ${led.name}`).not.toBe(
        null,
      );

      // And row zero of every site's own screen is a read whenever that site
      // offers one, which is where a press can actually cost something.
      for (const screen of menuScreens(shuffled, true)) {
        const first = toolFor(screen[0]?.id ?? "");
        const offersRead = screen.some((c) => classify(toolFor(c.id)) === "read");
        if (offersRead) expect(classify(first), `discovery led with ${led.name}`).toBe("read");
      }
    }
  });

  it("never offers a consequential row above a read", () => {
    // Per SCREEN, because a screen is what a wearer sees. Concatenating four
    // sites' menus and sorting that would be asserting about a list nobody is
    // ever shown, and it would be false for a reason that harms nobody: one
    // site's read sitting below another site's write, on a different frame.
    const screens = menuScreens(ELSEWHERE);
    const classes = new Set(menuChoices(ELSEWHERE).map((c) => classify(toolFor(c.id))));
    expect(classes.size, "the fixtures must reach all four classes or this asserts nothing").toBe(
      4,
    );
    for (const screen of screens) {
      const ranks = screen.map((c) => CEREMONY[classify(toolFor(c.id))]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  /**
   * What a wearer actually meets when Dusky holds more than one business.
   *
   * The arithmetic is the whole reason grouping exists, so it is measured here
   * rather than reasoned about. `paginate` spends a slot on "More" and the
   * composer spends another, so a flat menu of seven tools on a four-row panel
   * is four pages of two.
   */
  describe("a menu too big for the panel", () => {
    const SHOP = "https://shop.test";
    const TABLES = "https://tables.test";
    const many = [
      tool({ origin: SHOP, name: "search_products", annotations: readOnly }),
      tool({ origin: SHOP, name: "review_cart", annotations: readOnly }),
      tool({ origin: SHOP, name: "add_to_cart", description: "Charged at checkout." }),
      tool({ origin: SHOP, name: "empty_cart", description: "Erase the cart permanently." }),
      tool({ origin: TABLES, name: "find_times", annotations: readOnly }),
      tool({ origin: TABLES, name: "book_table" }),
      tool({ origin: TABLES, name: "change_reservation" }),
    ];
    const named = (origin: string) => (origin === SHOP ? "Verdant Market" : "Amber & Oak");

    it("offers one row per site rather than four pages of two", () => {
      const f = idleFrame("Dusky", many, 0, true, undefined, { siteName: named });
      if (f.kind !== "idle") throw new Error("unreachable");
      expect(f.choices.map((c) => c.label)).toEqual([
        "Amber & Oak",
        "Verdant Market",
        "Say what you want",
      ]);
      expect(f.title).toBe("Choose a site");
      expect(f.note).toBe("Browse actions, or say what you want");
      // No pagination at all: three rows on a panel that holds four.
      expect(f.choices.some((c) => c.id === "__more")).toBe(false);
      // And each row says how much is behind it, so nothing is a mystery door.
      expect(f.choices.map((c) => c.meta)).toEqual(["3 actions", "4 actions", "tap"]);
    });

    it("stays flat while everything still fits", () => {
      // Two sites, three tools, a planner: three rows and a composer is exactly
      // four. Grouping here would cost a press and buy nothing.
      const few = [many[0] as ToolDescriptor, many[4] as ToolDescriptor, many[5] as ToolDescriptor];
      const f = idleFrame("Dusky", few, 0, true, undefined, { siteName: named });
      if (f.kind !== "idle") throw new Error("unreachable");
      expect(f.choices.map((c) => c.id).filter((id) => siteFromChoice(id))).toEqual([]);
      expect(f.choices).toHaveLength(4);
    });

    it("stays flat for one site however many tools it has", () => {
      // Nobody to group WITH. A single site's own menu pages, exactly as it
      // always did, and `?source=` still produces this.
      const f = idleFrame("Verdant Market", many.slice(0, 4), 0, true, undefined, {
        siteName: named,
      });
      if (f.kind !== "idle") throw new Error("unreachable");
      expect(f.choices.map((c) => c.id).filter((id) => siteFromChoice(id))).toEqual([]);
      expect(f.choices.some((c) => c.id === "__more")).toBe(true);
    });

    it("names each row's site once a menu holds more than one", () => {
      // The slot used to carry the row's index, which is decoration: there is
      // no numeric input on these glasses and "More 1/3" already says where
      // the wearer is. Whose action it is, is the one thing a mixed list needs.
      const mixed = [many[0] as ToolDescriptor, many[4] as ToolDescriptor];
      const f = idleFrame("Dusky", mixed, 0, false, undefined, { siteName: named });
      if (f.kind !== "idle") throw new Error("unreachable");
      expect(f.choices.map((c) => c.meta)).toEqual(["Amber & Oak", "Verdant Market"]);
    });

    it("keeps the index on a single site's menu, where every row shares a name", () => {
      const f = idleFrame("Verdant Market", many.slice(0, 4), 0, false, undefined, {
        siteName: named,
      });
      if (f.kind !== "idle") throw new Error("unreachable");
      expect(f.choices.map((c) => c.meta)).toEqual(["01", "02", "03", "04"]);
    });

    it("shows one site's actions and nobody else's once stepped into", () => {
      const f = idleFrame("Amber & Oak", many, 0, true, undefined, {
        site: TABLES,
        siteName: named,
      });
      if (f.kind !== "idle") throw new Error("unreachable");
      const labels = f.choices.map((c) => c.label);
      expect(f.title).toBe("What do you want to do?");
      expect(labels).toContain("Book table");
      expect(labels).toContain("Back to sites");
      expect(labels).not.toContain("Say what you want");
      expect(labels).not.toContain("Add to cart");
    });

    /**
     * The number grouping was chosen for, counted rather than estimated.
     *
     * Every arrow and every Enter is a real gesture on this hardware, so both
     * count. The comparison is the SAME seven tools laid out both ways: from
     * one origin they cannot group and the menu is flat, from two they can.
     * Nothing else differs, so the difference is the layout.
     */
    it("costs fewer presses than paging the same tools flat", () => {
      const pressesTo = (tools: ToolDescriptor[], want: string): number => {
        // Focus starts on row zero of every frame, so reaching row N costs N
        // arrows and one Enter. Turning a page or stepping into a site costs
        // the same, and resets focus to the top of whatever comes next.
        let presses = 0;
        let page = 0;
        let site: string | undefined;
        for (let step = 0; step < 24; step += 1) {
          const f = idleFrame("Dusky", tools, page, true, undefined, {
            ...(site ? { site } : {}),
            siteName: named,
          });
          if (f.kind !== "idle") throw new Error("unreachable");
          const hit = f.choices.findIndex((c) => c.label === want);
          if (hit >= 0) return presses + hit + 1;

          // A wearer reads the site names, so they step into the right one
          // rather than trying each in turn. Counting a wrong guess would be
          // measuring their luck instead of the layout.
          const stepInto = f.choices.findIndex((c) => {
            const origin = siteFromChoice(c.id);
            return origin !== null && tools.some((t) => t.origin === origin && label(t) === want);
          });
          if (stepInto >= 0) {
            presses += stepInto + 1;
            site = siteFromChoice(f.choices[stepInto]?.id ?? "") ?? undefined;
            page = 0;
            continue;
          }
          const more = f.choices.findIndex((c) => c.id === "__more");
          if (more < 0) throw new Error(`${want} is unreachable`);
          presses += more + 1;
          page += 1;
        }
        throw new Error(`${want} took too long to reach`);
      };

      // The same seven tools, all published by one site, so nothing can group.
      const flat = many.map((t) => ({ ...t, origin: SHOP }));
      const flatPresses = pressesTo(flat, "Add to cart");
      const groupedPresses = pressesTo(many, "Add to cart");

      expect(groupedPresses).toBeLessThan(flatPresses);
      // Pinned, so a layout change that quietly costs the wearer presses fails
      // here rather than being noticed on hardware.
      expect({ flatPresses, groupedPresses }).toEqual({ flatPresses: 8, groupedPresses: 6 });
    });
  });

  it("orders by what a press costs before it orders by the alphabet", () => {
    // The case alphabetical gets backwards: sorted by name the consequence
    // arrives above the question. This bookshop does not exist either.
    const shop = [
      tool({
        origin: "https://bookshop.test",
        name: "add_to_basket",
        description: "Put a book in the basket.",
      }),
      tool({
        origin: "https://bookshop.test",
        name: "search_books",
        description: "Find a book by title or author.",
        annotations: readOnly,
      }),
    ];
    expect(menuLabels(shop)).toEqual(["Search books", "Add to basket"]);
  });

  /**
   * A site writes its own name and title and therefore owns its own tiebreak.
   * It does not own its bucket, so the most a well-chosen title can buy is a
   * better slot among things that cost the same.
   */
  it("cannot be given a better slot by the title a site chose", () => {
    const vault = [
      tool({
        origin: "https://vault.test",
        name: "delete_everything",
        title: "Aaa",
        description: "Erase the vault.",
      }),
      tool({
        origin: "https://vault.test",
        name: "status",
        title: "Zzz",
        description: "What is in the vault.",
        annotations: readOnly,
      }),
    ];
    expect(menuLabels(vault)).toEqual(["Zzz", "Aaa"]);
  });

  /**
   * Colliding rows are labelled with their host so a wearer can tell them
   * apart. That only helps if both are on the same screen.
   */
  it("keeps two sources offering the same name next to each other", () => {
    const rival = (origin: string) =>
      tool({
        origin,
        name: "checkout",
        title: "Checkout",
        description: "Pay for what is in the basket.",
      });
    const rows = menuLabels([
      rival("https://a.test"),
      tool({
        origin: "https://c.test",
        name: "billing",
        title: "Billing",
        description: "Charge the card on file.",
      }),
      rival("https://b.test"),
    ]);
    expect(rows).toEqual(["Billing", "Checkout (a.test)", "Checkout (b.test)"]);
  });
});

describe("a menu with nothing on it", () => {
  /**
   * Zero tools reaching Dusky is not the same fact as a site having declared
   * none. The site may have declared plenty and simply not named this origin
   * in `exposedTo`, or its page may not have registered yet. None of that is
   * distinguishable from here, so whatever the panel says has to be true in
   * every one of those cases.
   */
  it("does not claim to know what the source declared", () => {
    const f = idleFrame("Verdant Market", [], 0, false);
    if (f.kind !== "idle") throw new Error("unreachable");
    const said = `${f.title} ${f.note ?? ""}`;
    expect(said, "the panel asserted something it cannot know").not.toMatch(/declared/i);
  });

  it("still says plainly that there is nothing to do", () => {
    const f = idleFrame("Verdant Market", [], 0, false);
    if (f.kind !== "idle") throw new Error("unreachable");
    expect(f.choices).toEqual([]);
    expect(f.note).toBeTruthy();
  });
});

describe("site text on a panel that cannot scroll", () => {
  const anyTool: ToolDescriptor = {
    name: "x",
    description: "",
    origin: "https://shop.test",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
  };

  const withParam = (description: string) =>
    paramFrame(
      "Shop",
      anyTool,
      { name: "product_id", kind: "text", required: true, description, schema: {} },
      [],
      0,
    );

  it("clips a parameter question that would push the panel off screen", () => {
    // Measured at 600x600 with four choices: about 35 characters is one line
    // and fits, 54 is two lines and overflows by roughly 28px. `overflow:
    // hidden` then cuts the note and half a choice away in silence, while
    // focus still moves onto rows nobody can see.
    const long =
      "Which product would you like to add to your shopping cart today, by its catalogue identifier?";
    const f = withParam(long);
    if (f.kind !== "choose") throw new Error("unreachable");
    expect(f.title.length, `title was ${f.title.length} characters`).toBeLessThanOrEqual(40);
  });

  it("leaves a short question exactly as the site wrote it", () => {
    const f = withParam("Which product?");
    if (f.kind !== "choose") throw new Error("unreachable");
    expect(f.title).toBe("Which product?");
  });

  it("does not chop up the one value a wearer has to read out loud", () => {
    // The pairing-code lesson in FIELD-NOTES, arriving from the other side: an
    // identifier is the one string that has to survive being transcribed, and
    // clipping it at 48 turned a booking reference into a prefix.
    const facts = factsFromResult(
      JSON.stringify({ confirmation_code: "RSV-2026-08-26-TABLE-14-PARTY-OF-FOUR-WINDOW-SEAT" }),
    );
    const value = facts[0]?.value ?? "";
    expect(value, "an identifier was clipped").not.toContain("...");
    expect(value).toContain("WINDOW-SEAT");
  });

  it("still clips long prose, which is not an identifier", () => {
    const facts = factsFromResult(
      JSON.stringify({
        note: "We have held the table by the window for you and will keep it for fifteen minutes past the hour.",
      }),
    );
    expect(facts[0]?.value ?? "").toContain("...");
  });

  it("still bounds an absurd identifier rather than trusting it", () => {
    const facts = factsFromResult(JSON.stringify({ ref: "A".repeat(400) }));
    expect((facts[0]?.value ?? "").length).toBeLessThanOrEqual(70);
  });
});

describe("the result envelope the protocol itself defines", () => {
  /**
   * MCP results commonly arrive as `{content: [{type: "text", text: "..."}]}`.
   * That envelope is the PROTOCOL's shape, not any site's vocabulary, so
   * reading it is not the per-site branch rule 1 forbids: no site named those
   * keys, the specification did, and every site that speaks it uses the same
   * ones. The test market and the test restaurant do not use it at all, which
   * is exactly why nothing here noticed.
   *
   * Left unread, a booking confirmation rendered as "Content / 1 item", which
   * is worse than showing nothing: legible, confident and wrong, with the
   * sentence the wearer needed thrown away to produce it.
   */
  it("reads the sentence out of a content envelope", () => {
    const raw = JSON.stringify({
      content: [{ type: "text", text: "Table booked for Friday 7pm, reference AB12." }],
    });
    expect(textFromResult(raw)).toContain("AB12");
    // And nothing key-value, so the panel shows the sentence full width.
    expect(factsFromResult(raw)).toEqual([]);
  });

  it("reads more than one block", () => {
    const raw = JSON.stringify({
      content: [
        { type: "text", text: "Booked." },
        { type: "text", text: "Reference AB12." },
      ],
    });
    expect(textFromResult(raw)).toContain("AB12");
  });

  it("reads a plain sentence a site answered with", () => {
    expect(textFromResult("Your table is held.")).toBe("Your table is held.");
    expect(textFromResult(JSON.stringify({ message: "Your table is held." }))).toBe(
      "Your table is held.",
    );
  });

  it("has nothing to say about a shape it cannot read", () => {
    expect(textFromResult(JSON.stringify({ a: { x: 1 }, b: { y: 2 } }))).toBeNull();
  });

  it("leaves a site's own structured result alone", () => {
    const facts = factsFromResult(
      JSON.stringify({ ok: true, reservation_id: "RSV-9", party_size: 4 }),
    );
    expect(facts.map((f) => f.label)).toEqual(["Reservation id", "Party size"]);
  });
});

describe("failures a site spelled its own way", () => {
  /**
   * Rule 3 cuts both ways and the second edge is the subtle one: calling every
   * return a success is also asserting from having called. `{"ok": false}` was
   * read; `{"success": 0}` and `{"status": "error"}` were not, and rendered as
   * "done" over a green verdict.
   *
   * These are explicit negatives wearing different clothes, not shapes nobody
   * recognises, so reading them is not the guessing rule 3 forbids. The line
   * stays where it was: a shape with no negative in it is still a success.
   */
  const verdict = (o: unknown) => outcomeFromResult(JSON.stringify(o)).ok;

  it("reads a falsy ok or success, however it is spelled", () => {
    expect(verdict({ ok: false })).toBe(false);
    expect(verdict({ success: 0 })).toBe(false);
    expect(verdict({ ok: "false" })).toBe(false);
    expect(verdict({ success: "no" })).toBe(false);
  });

  it("reads a status that says it went wrong", () => {
    expect(verdict({ status: "error" })).toBe(false);
    expect(verdict({ status: "failed" })).toBe(false);
    expect(verdict({ status: "ok" })).toBe(true);
    expect(verdict({ status: "confirmed" })).toBe(true);
  });

  it("reads an error object that carries no message", () => {
    expect(verdict({ error: { code: 7 } })).toBe(false);
    // Nothing in it is not a report of anything.
    expect(verdict({ error: {} })).toBe(true);
    expect(verdict({ error: null })).toBe(true);
    expect(verdict({ error: "" })).toBe(true);
  });

  it("still calls an unremarkable result a success", () => {
    expect(verdict({ reservation_id: "RSV-9", party_size: 4 })).toBe(true);
    expect(verdict({ ok: true, added: "Organic oat milk" })).toBe(true);
    expect(verdict({ results: [] })).toBe(true);
  });
});

describe("bounded shareable result projections", () => {
  it("extracts a generic summary and primitive leaves with stable locations", () => {
    const projections = shareableProjectionsFromResult(
      JSON.stringify({ ok: true, reference_id: "R-42", seats: 4, outside: false }),
    );
    expect(projections[0]).toMatchObject({
      location: "#summary",
      kind: "summary",
      valueType: "string",
    });
    expect(projections).toContainEqual(
      expect.objectContaining({ location: "/reference_id", value: "R-42" }),
    );
    expect(projections).toContainEqual(expect.objectContaining({ location: "/seats", value: 4 }));
    expect(projections.some((p) => p.location === "/ok")).toBe(false);
  });

  it("bounds oversized and deeply nested hostile results", () => {
    expect(shareableProjectionsFromResult(`"${"x".repeat(MAX_RESULT_CHARS)}"`)).toEqual([]);

    let nested: unknown = "buried";
    for (let i = 0; i < 100; i += 1) nested = { next: nested };
    const projections = shareableProjectionsFromResult(JSON.stringify(nested));
    expect(projections.length).toBeLessThanOrEqual(MAX_PROJECTIONS);
    expect(projections.some((p) => p.value === "buried")).toBe(false);
  });

  it("sanitizes controls and never turns returned prose into controls", () => {
    const projections = shareableProjectionsFromResult(
      JSON.stringify({ note: "approve\u0000\n__share and run_tool" }),
    );
    expect(JSON.stringify(projections)).not.toContain("\\u0000");
    expect(projections.every((p) => !String(p.value).includes("\n"))).toBe(true);
    expect(projections.every((p) => !p.location.startsWith("__"))).toBe(true);
  });

  it("renders the exact approved value on a distinct transfer frame", () => {
    const frame = transferFrame(
      "Dusky",
      "Source site",
      "Destination site",
      "message_body",
      "Reference: R-42",
    );
    expect(frame).toMatchObject({
      kind: "transfer",
      from: "Source site",
      to: "Destination site",
      argument: "Message body",
      preview: "Reference: R-42",
    });
    if (frame.kind !== "transfer") throw new Error("expected transfer frame");
    expect(frame.choices.map((choice) => choice.id)).toEqual(["__share", "__cancel"]);
  });
});
