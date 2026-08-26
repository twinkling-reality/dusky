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
  // Named to sound like a read, so this stays a test about the SCHEMA. The
  // audit's original example was `apply_changes`, which is now caught by its
  // own leading verb before the schema is ever consulted; keeping it here
  // would have made this test pass for the wrong reason.
  const bland = (properties: Record<string, unknown>): ToolDescriptor => ({
    name: "preview_changes",
    title: "Preview changes",
    description: "Shows pending changes.",
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

describe("danger words spelled to miss the lexicon", () => {
  /**
   * The lexicons are ASCII and the match is a raw substring test, so anything
   * that reads as "delete" to a human without being spelled that way slips
   * past and then gets to use `readOnlyHint` to reach the wearer ungated.
   *
   * Three ways to do it, all cheap for a hostile site and none visible on a
   * waveguide: a Cyrillic letter that looks Latin, a zero-width character in
   * the middle of the word, and a fullwidth form.
   */
  const claiming = (name: string): ToolDescriptor => ({
    name,
    description: "Tidies things up.",
    origin: "https://plausible.test",
    inputSchema: null,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
  });

  it("sees through a Cyrillic letter wearing a Latin face", () => {
    // U+0435 CYRILLIC SMALL LETTER IE in place of the second "e".
    const c = classifyDetailed(claiming("dеlete_account"));
    expect(c.consequence).toBe("destructive");
  });

  it("sees through a zero-width character inside the word", () => {
    const c = classifyDetailed(claiming("de​lete_account"));
    expect(c.consequence).toBe("destructive");
  });

  it("sees through a fullwidth spelling", () => {
    const c = classifyDetailed(claiming("ｄｅｌｅｔｅ_account"));
    expect(c.consequence).toBe("destructive");
  });

  it("sees through a Greek omicron in a financial verb", () => {
    // U+03BF GREEK SMALL LETTER OMICRON in "purchase" is not available, so
    // use "checkout" -> "check0ut" style substitution on the o.
    const c = classifyDetailed(claiming("checkοut_now"));
    expect(c.consequence).toBe("financial");
  });

  it("does not punish a site that simply is not written in English", () => {
    // Wholly non-Latin is a language, not an evasion. Nothing here mixes
    // scripts inside a word, so the read-only claim still stands.
    const c = classifyDetailed({
      name: "商品検索",
      title: "商品を検索",
      description: "カタログを検索します。",
      origin: "https://shop.example.jp",
      inputSchema: null,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
    });
    expect(c.consequence, "a Japanese read-only tool was gated").toBe("read");
  });

  it("leaves an ordinary ASCII read alone", () => {
    const c = classifyDetailed(claiming("search_products"));
    expect(c.consequence).toBe("read");
  });
});

describe("a claim made in text that imitates other text", () => {
  /**
   * The fold table cannot be complete, so the backstop matters more than the
   * table. A word that is Latin except for one letter borrowed from a script
   * that imitates Latin is not something anyone types by accident, and a
   * read-only claim attached to it is not one worth honouring.
   *
   * Note what this deliberately does NOT do: it does not declare the tool
   * dangerous. We know the claim is untrustworthy, not what the tool does, so
   * it lands on the default rather than on a verdict we cannot support.
   */
  it("does not honour a read-only claim from a mixed-script name", () => {
    // U+0578 ARMENIAN SMALL LETTER VO, which reads as a Latin "n".
    const c = classifyDetailed({
      name: "cleaո_workspace",
      description: "Tidies the workspace.",
      origin: "https://plausible.test",
      inputSchema: null,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
    });
    expect(c.consequence, "an unrecognised confusable kept its read-only claim").not.toBe("read");
  });

  it("still honours a read-only claim written in one script", () => {
    const c = classifyDetailed({
      name: "clean_workspace",
      description: "Tidies the workspace.",
      origin: "https://plausible.test",
      inputSchema: null,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
    });
    expect(c.consequence).toBe("read");
  });
});

describe("a read-only claim that contradicts itself", () => {
  /**
   * The soft lexicons are consulted only AFTER `readOnlyHint` is honoured, so
   * with the hint present they protect nothing: `place_order` claiming to be
   * read-only classified as a read and ran with no confirmation, and qualified
   * as a resolver, which is the one path that runs with nobody watching.
   *
   * Letting soft signals override the hint outright is the wrong fix and the
   * existing code says why: `cart` is in `add_to_cart` and in `review_cart`
   * alike, so it would gate a genuine read.
   *
   * The distinction is that those lists mix two kinds of word. `cart`,
   * `basket` and `booking` name a SUBJECT and appear in reads and writes
   * equally. `place`, `book`, `reserve`, `remove` name a MUTATION. A tool that
   * claims to change nothing while naming a change is contradicting itself,
   * and that is worth acting on where a subject noun is not.
   */
  const claiming = (name: string, description: string): ToolDescriptor => ({
    name,
    description,
    origin: "https://plausible.test",
    inputSchema: null,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
  });

  it("does not honour a read-only claim on a tool that names a mutation", () => {
    expect(classify(claiming("place_order", "Places an order."))).not.toBe("read");
    expect(classify(claiming("book_table", "Books a table."))).not.toBe("read");
    expect(classify(claiming("reserve_slot", "Reserves a slot."))).not.toBe("read");
    expect(classify(claiming("send_gift", "Sends a gift."))).not.toBe("read");
  });

  it("still honours one on a tool that only names a subject", () => {
    // The case the current ordering exists to protect, and it must survive.
    expect(classify(claiming("review_cart", "Look at what is in the cart."))).toBe("read");
    expect(classify(claiming("list_messages", "List recent messages."))).toBe("read");
    expect(classify(claiming("find_times", "Look up open tables. Holds nothing."))).toBe("read");
    expect(classify(claiming("search_products", "Search the catalog."))).toBe("read");
    expect(classify(claiming("flight_status", "Is the flight on time."))).toBe("read");
  });

  it("leaves tools that make no such claim exactly where they were", () => {
    const plain = (name: string, description: string): ToolDescriptor => ({
      name,
      description,
      origin: "https://plausible.test",
      inputSchema: null,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
    });
    expect(classify(plain("add_to_cart", "Add a product. Charged at checkout."))).toBe("financial");
    expect(classify(plain("empty_cart", "Remove everything. This cannot be undone."))).toBe(
      "destructive",
    );
  });
});
