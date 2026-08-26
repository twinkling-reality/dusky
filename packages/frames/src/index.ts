/**
 * The schema-to-frame compiler.
 *
 * This is the part of Dusky that replaces per-site integration work. Given a
 * tool nobody has ever seen, it produces frames a wearer can operate with six
 * keys. There is no site-specific branch anywhere in this file, and there must
 * never be one: the moment a frame depends on WHICH site registered a tool,
 * Dusky has become a hardcoded integration wearing a protocol costume.
 *
 * Deterministic by design. No model calls live here, so every frame is a pure
 * function of (tool, schema, args, candidates) and is testable without a
 * network. Choosing WHICH tool to run is probabilistic and lives in the agent.
 */

import type { Choice, DisplayFrame, Fact, JsonSchema, ToolDescriptor } from "@dusky/contracts";

/**
 * 600x600 cannot scroll, and Meta requires 88px interactive targets. With a
 * title and a footer note that leaves room for four choices. A fifth is a
 * pagination affordance, never a squeezed fifth option.
 */
export const MAX_CHOICES = 4;

/* ------------------------------------------------------- schema inspection */

export type ParamKind = "enum" | "boolean" | "text" | "number" | "unsupported";

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** What kind of frame can collect this parameter, if any. */
export function paramKind(schema: unknown): ParamKind {
  const s = asRecord(schema);
  if (!s) return "unsupported";
  if (Array.isArray(s["enum"]) && s["enum"].length > 0) return "enum";
  const type = s["type"];
  if (type === "boolean") return "boolean";
  if (type === "string") return "text";
  if (type === "number" || type === "integer") return "number";
  // Objects and arrays cannot be collected in one glance. The agent must
  // resolve them from context, or Dusky declines the action honestly.
  return "unsupported";
}

export interface ParamSpec {
  name: string;
  schema: JsonSchema;
  required: boolean;
  kind: ParamKind;
  description?: string;
}

/** Flatten a tool's inputSchema into an ordered list of parameters. */
export function parameters(tool: ToolDescriptor): ParamSpec[] {
  const s = tool.inputSchema;
  if (!s) return [];
  const props = asRecord(s.properties);
  if (!props) return [];
  const required = new Set(
    Array.isArray(s["required"])
      ? (s["required"] as unknown[]).filter((x) => typeof x === "string")
      : [],
  );
  return Object.entries(props).map(([name, raw]) => {
    const rec = asRecord(raw) ?? {};
    return {
      name,
      schema: rec as JsonSchema,
      required: required.has(name),
      kind: paramKind(rec),
      description: typeof rec["description"] === "string" ? rec["description"] : undefined,
    };
  });
}

/** The next required parameter still missing from args, or null when ready. */
export function nextMissingParam(
  tool: ToolDescriptor,
  args: Record<string, unknown>,
): ParamSpec | null {
  for (const p of parameters(tool)) {
    if (!p.required) continue;
    const v = args[p.name];
    if (v === undefined || v === null || v === "") return p;
  }
  return null;
}

/** True when this tool can be driven to completion on a six-key display. */
export function isOperable(tool: ToolDescriptor): boolean {
  return parameters(tool).every((p) => !p.required || p.kind !== "unsupported");
}

/* ----------------------------------------------------------- humanization */

/** `add_to_cart` becomes `Add to cart`. Titles win when the site supplies one. */
/**
 * A tool's identity.
 *
 * The name alone is not one. Any origin may register any name, so two sources
 * can both publish `checkout` and neither is more entitled to it than the
 * other. Resolving a choice by name meant taking whichever the browser
 * happened to return first, and `getTools` ordering is explicitly not
 * something to depend on: a site that registered a familiar name could have
 * its own tool run when the wearer picked somebody else's.
 *
 * The origin is the part a site cannot forge, because the browser supplies it.
 */
/**
 * The single answer to "may this value be sent for this declared parameter?"
 *
 * Returns the value to send, or `undefined` to drop it.
 *
 * It lives here because BOTH `packages/planner` and `packages/session` have to
 * ask, and they must not answer differently. The planner validates what a
 * model proposed; the session validates again before invoking, because a
 * `Planner` is a port and a different implementation reaches the session
 * without ever passing through the planner's code. Two implementations of one
 * rule is the arrangement AGENTS.md disowns: a guarantee that only holds while
 * two files agree is not a guarantee.
 *
 * Rejecting is always safe here. The worst case is a parameter the wearer is
 * asked for instead, which is the menu-driven path the product already has.
 */
export function valueForParam(value: unknown, spec: ParamSpec): unknown {
  if (value === null || value === undefined) return undefined;

  switch (spec.kind) {
    case "enum": {
      const allowed = spec.schema["enum"];
      if (!Array.isArray(allowed)) return undefined;
      // The DECLARED member, not a parsed copy of the label, which is how an
      // integer enum survives a Display that can only send text.
      const hit = allowed.find((a) => String(a) === String(value));
      return hit === undefined ? undefined : hit;
    }
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      return undefined;
    case "number": {
      if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
      if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
      }
      return undefined;
    }
    case "text":
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      return undefined;
    // An object or an array cannot be shown on a confirmation frame, so it can
    // never be part of something the wearer is asked to approve.
    case "unsupported":
      return undefined;
  }
}

export function toolId(tool: ToolDescriptor): string {
  return `${tool.origin} ${tool.name}`;
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/**
 * What to call a tool on a menu that may contain another tool called the same.
 *
 * Only collisions pay the extra width, because on a panel this size a row is
 * expensive. A wearer being shown two identical rows has no way to make an
 * informed choice, which is worse than a long row.
 */
function menuLabel(tool: ToolDescriptor, among: readonly ToolDescriptor[]): string {
  const mine = label(tool);
  const collides = among.some((t) => t !== tool && label(t) === mine);
  return collides ? `${mine} (${hostOf(tool.origin)})` : mine;
}

export function label(tool: ToolDescriptor): string {
  if (tool.title?.trim()) return tool.title.trim();
  const words = tool.name.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function humanizeParam(name: string): string {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function paginate(
  all: Choice[],
  page: number,
  budget = MAX_CHOICES,
): { choices: Choice[]; pages: number } {
  if (all.length <= budget) return { choices: all, pages: 1 };
  const size = budget - 1;
  const pages = Math.ceil(all.length / size);

  // Wrap rather than clamp. Clamping made "More" redraw the frame the wearer
  // was already on once they reached the last page: it looks live, it accepts
  // the press, and nothing moves. There is no scrollbar and no cursor here, so
  // a control that does nothing is the only feedback they get, and it reads as
  // a hang. Wrapping to the first page is always a visible answer.
  const p = ((page % pages) + pages) % pages;
  const slice = all.slice(p * size, p * size + size);
  slice.push({
    id: "__more",
    label: "More",
    // Where the wearer IS, not where the button leads. Numbering the
    // destination made the last two pages both read "2/2", which is how you
    // lose your place on a panel that cannot scroll.
    meta: `${p + 1}/${pages}`,
  });
  return { choices: slice, pages };
}

/* --------------------------------------------------------------- builders */

/**
 * The menu: everything this source can currently do. Fully tool-derived.
 *
 * `canSpeak` adds the affordance for saying what you want rather than picking
 * from the list, and it is passed rather than assumed because a session
 * without a planner cannot interpret a spoken request. Offering the composer
 * anyway would be the worst kind of dead control: one that looks like it
 * works, accepts what you say, and silently does nothing with it.
 */
export function idleFrame(
  source: string,
  tools: ToolDescriptor[],
  page = 0,
  canSpeak = false,
): DisplayFrame {
  const operable = tools.filter(isOperable);
  const all: Choice[] = operable.map((t, i) => ({
    id: toolId(t),
    label: menuLabel(t, operable),
    meta: String(i + 1).padStart(2, "0"),
  }));

  // Speaking never occupies a paginated slot. Having to page through actions
  // to reach the affordance the whole product is built around would be
  // absurd, so it costs one slot from the tool list and is always present.
  // It sits LAST so a new menu focuses an action: focus lands on choice zero,
  // and opening a text field in someone's eye every time they return to the
  // menu is not what anyone wants.
  const { choices } = paginate(all, page, canSpeak ? MAX_CHOICES - 1 : MAX_CHOICES);
  if (canSpeak) choices.push({ id: "__compose", label: "Say what you want", meta: "tap" });

  return {
    kind: "idle",
    source,
    title: operable.length ? "What do you want to do?" : "No actions available here",
    note: operable.length
      ? canSpeak
        ? "Tap to speak, or choose an action"
        : "Choose an action"
      : // What reached us, never what the site chose.
        //
        // This used to read "This source declared no usable tools", which is a
        // confident claim about somebody else's page and is only one of the
        // reasons a menu comes back empty. The site may have declared plenty
        // and not named this origin in `exposedTo`; its page may not have
        // registered yet; the browser may not speak WebMCP at all. None of
        // those are distinguishable from here, so the sentence has to be true
        // in all of them. "Offered" is about what arrived, which is the only
        // thing this code actually observed.
        "This source has not offered any actions",
    choices,
  };
}

/**
 * Collect one parameter. `candidates` come from a prior read-only tool result,
 * which is what turns a bare `product_id: string` into a real list of choices.
 */
export function paramFrame(
  source: string,
  tool: ToolDescriptor,
  param: ParamSpec,
  candidates: Choice[] = [],
  page = 0,
): DisplayFrame {
  // The site wrote this question and it goes straight into the panel's largest
  // text. Measured at 600x600 with four choices, about 35 characters is one
  // line and fits; 54 is two lines and runs roughly 28px past the bottom,
  // where `overflow: hidden` removes the note and part of a choice without
  // saying so, while focus still moves onto rows nobody can see.
  const asked = param.description?.trim() || `${humanizeParam(param.name)}?`;
  const title = asked.length > 40 ? `${asked.slice(0, 37)}...` : asked;

  if (candidates.length > 0) {
    const { choices } = paginate(candidates, page);
    return { kind: "choose", source, title, choices, note: label(tool) };
  }

  if (param.kind === "enum") {
    const values = (param.schema["enum"] as unknown[]) ?? [];
    const all: Choice[] = values.map((v) => ({ id: String(v), label: String(v) }));
    const { choices } = paginate(all, page);
    return { kind: "choose", source, title, choices, note: label(tool) };
  }

  if (param.kind === "boolean") {
    return {
      kind: "choose",
      source,
      title,
      note: label(tool),
      choices: [
        { id: "true", label: "Yes" },
        { id: "false", label: "No" },
      ],
    };
  }

  // text and number both route to the on-glasses composer, which the wearer
  // opens with focus then tap. Handwriting or dictation, their choice.
  return {
    kind: "choose",
    source,
    title,
    note: "Tap to write or speak",
    choices: [{ id: "__compose", label: "Enter a value", meta: "tap" }],
  };
}

/**
 * The gate. Built from the tool result and the classified consequence, never
 * from model prose, so the wearer reads the same target the code will send.
 */
/**
 * Plain words for what approving this will actually do.
 *
 * This panel cannot signal severity the way a screen does. An additive
 * waveguide has no background, so there is no colour to go red and no
 * darkening to lean on, and dimmer text does not read as graver text, it
 * reads as text competing with the room. Severity therefore has to be
 * SAID, or it is not communicated at all.
 *
 * Without this, approving `delete_account` and approving `review_cart`
 * rendered as the same frame: a title, a target and two buttons.
 *
 * The words describe the ceremony `packages/policy` assigned, never anything
 * the site claimed about itself.
 */
function consequenceNote(consequence?: string): string | undefined {
  switch (consequence) {
    case "financial":
      return "This spends money";
    case "destructive":
      return "This cannot be undone";
    case "write":
      return "This changes something on the site";
    default:
      return undefined;
  }
}

export function confirmFrame(
  source: string,
  tool: ToolDescriptor,
  target: string,
  consequence?: string,
): DisplayFrame {
  const note = consequenceNote(consequence);
  return {
    kind: "confirm",
    source,
    title: label(tool),
    target,
    ...(note !== undefined ? { consequence: note } : {}),
    choices: [
      { id: "__confirm", label: "Confirm", meta: "enter" },
      { id: "__cancel", label: "Cancel", meta: "esc", tone: "danger" },
    ],
  };
}

export function workingFrame(source: string, tool: ToolDescriptor): DisplayFrame {
  return { kind: "working", source, title: label(tool), note: `invoking ${tool.name}` };
}

/**
 * Work that is not about one tool yet: understanding a request, looking up
 * options to offer.
 *
 * On a cursorless display an unchanged screen is indistinguishable from a
 * hang, so every wait a wearer caused has to be visible while it happens.
 * The title echoes what Dusky heard, because a misheard request is the failure
 * a wearer most needs to catch early.
 */
export function busyFrame(source: string, title: string, note?: string): DisplayFrame {
  const clipped = title.length > 60 ? `${title.slice(0, 59)}...` : title;
  return { kind: "working", source, title: clipped, note };
}

export interface ResultOptions {
  /** Read from the returned result, never from the fact that a call returned. */
  ok: boolean;
  detail?: string;
  facts?: Fact[];
}

export function resultFrame(source: string, title: string, o: ResultOptions): DisplayFrame {
  return {
    kind: "result",
    source,
    ok: o.ok,
    title,
    detail: o.detail,
    facts: o.facts?.length ? o.facts : undefined,
    choices: [{ id: "__home", label: "Do something else", meta: "enter" }],
  };
}

export function errorFrame(
  source: string,
  title: string,
  detail: string,
  retryable: boolean,
): DisplayFrame {
  const choices: Choice[] = [];
  if (retryable) choices.push({ id: "__retry", label: "Try again", meta: "enter" });
  choices.push({ id: "__home", label: "Back", meta: "esc" });
  return { kind: "error", source, title, detail, retryable, choices };
}

/* ------------------------------------------------------- reading a result */

/**
 * What a tool's returned JSON says about whether it worked.
 *
 * Load-bearing rule 3 says success is asserted from a returned result, never
 * from having called. Treating every return as a success breaks that rule just
 * as thoroughly as never checking at all, because a site that answers
 * `{"ok": false, "error": "out of stock"}` has returned a RESULT and that
 * result is a failure.
 *
 * The reading is deliberately one-directional: only an EXPLICIT negative flips
 * the verdict. An unrecognised shape stays a success, because we did get an
 * answer back and inventing a failure from silence would be guessing. These
 * key names are ordinary JSON convention rather than knowledge of any site,
 * the same basis on which `candidatesFromResult` reads `id` and `name`.
 */
export function outcomeFromResult(raw: string): { ok: boolean; message?: string } {
  const rec = asRecord(safeParse(raw));
  if (!rec) return { ok: true };

  const err = rec["error"];
  if (typeof err === "string" && err.trim() !== "") return { ok: false, message: err.trim() };
  const errRec = asRecord(err);
  if (errRec && typeof errRec["message"] === "string") {
    return { ok: false, message: String(errRec["message"]) };
  }

  for (const key of ["ok", "success"]) {
    if (rec[key] === false) {
      const m = rec["message"];
      return { ok: false, message: typeof m === "string" ? m : undefined };
    }
  }
  return { ok: true };
}

/** Keys that describe the call rather than the outcome, so never shown as facts. */
const VERDICT_KEYS = new Set(["ok", "success", "error", "status", "code"]);

/** Money is the one value a wearer must never misread, so it is formatted. */
const MONEY_KEY = /(price|amount|cost|total|subtotal|fee|balance|charge)/;

function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function factValue(key: string, value: unknown): string | null {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return MONEY_KEY.test(key.toLowerCase()) ? `$${value.toFixed(2)}` : String(value);
  }
  if (typeof value === "string") {
    const v = value.trim();
    if (v === "") return null;
    // A value with no spaces in it is an identifier, and an identifier is the
    // one string a wearer may have to read off the lens and type somewhere
    // else. Clipping a booking reference to a prefix is the same mistake as
    // rendering the pairing code in the smallest text on the panel, which
    // FIELD-NOTES already cost us twenty minutes. `.factValue` wraps, so it
    // gets room. Prose does not have to survive transcription.
    const limit = /\s/.test(v) ? 48 : 64;
    return v.length > limit ? `${v.slice(0, limit - 3)}...` : v;
  }
  if (Array.isArray(value)) {
    // A list of things a wearer could NAME is worth naming. Reporting "1 item"
    // for a cart containing oat milk is technically true and useless: it reads
    // as though the cart were empty, which is how this was found. The same
    // reader that turns a search result into choices turns a list into words.
    const named = candidatesFromResult(JSON.stringify(value), 4).map((c) => c.label);
    if (named.length > 0) {
      const rest = value.length - named.length;
      const text = rest > 0 ? `${named.join(", ")} +${rest} more` : named.join(", ");
      return text.length > 48 ? `${text.slice(0, 47)}...` : text;
    }
    // Nothing nameable in it, so the count is the most honest thing left.
    return value.length === 1 ? "1 item" : `${value.length} items`;
  }
  // An object cannot be read at a glance, and a wearer must never be shown
  // something they cannot actually check.
  return null;
}

/**
 * Lift a few short labelled values out of an arbitrary tool result.
 *
 * There is no site-specific key in here and there must never be one. Given a
 * result nobody has seen before, this produces something a wearer can read in
 * one glance; given a shape it cannot read, it produces nothing and the caller
 * falls back to the raw text rather than inventing structure.
 */
export function factsFromResult(raw: string, limit = 4): Fact[] {
  const rec = asRecord(safeParse(raw));
  if (!rec) return [];

  // A result that is a single wrapper around one object, `{"product": {...}}`,
  // is describing that object. Read through it rather than reporting nothing.
  const entries = Object.entries(rec);
  const inner = entries.length === 1 && entries[0] ? asRecord(entries[0][1] as unknown) : null;
  const source = inner ?? rec;

  const out: Fact[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (out.length >= limit) break;
    if (VERDICT_KEYS.has(key.toLowerCase())) continue;
    const v = factValue(key, value);
    if (v === null) continue;
    out.push({ label: humanizeKey(key), value: v });
  }
  return out;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Exact keys that conventionally hold an identifier, in preference order. */
const ID_KEYS = ["id", "sku", "key", "uid", "slug", "value"];

/**
 * The field in an object that identifies it, if it has one.
 *
 * A suffix rule rather than a list of nouns. `product_id` used to be an entry
 * in ID_KEYS, which is a shop-shaped word sitting in the one file that must
 * not know what kind of site it is looking at. It had also never once matched,
 * because both test sites return a plain `id`, so it was a guess about a
 * vocabulary rather than knowledge of a convention.
 *
 * `<something>_id` IS the convention, and stating it that way covers
 * `reservation_id`, `slot_id`, `booking_id` and every site nobody has written
 * yet, without naming a single domain.
 */
function idKeyOf(o: Record<string, unknown>): string | undefined {
  const usable = (k: string) => typeof o[k] === "string" || typeof o[k] === "number";
  return ID_KEYS.find(usable) ?? Object.keys(o).find((k) => /_id$/i.test(k) && usable(k));
}

/**
 * Turn an arbitrary tool result into candidate choices for a later parameter.
 *
 * Best effort and deliberately conservative: it looks for an array of objects
 * and picks an id-ish field and a label-ish field. When it cannot find them it
 * returns nothing, and the caller falls back to the composer rather than
 * inventing structure that is not there.
 */
export function candidatesFromResult(raw: string, limit = 8): Choice[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const rec = asRecord(parsed);
  const arr: unknown[] | null = Array.isArray(parsed)
    ? parsed
    : rec
      ? ((Object.values(rec).find((v) => Array.isArray(v)) as unknown[] | undefined) ?? null)
      : null;
  if (!arr) return [];

  const LABEL_KEYS = ["name", "title", "label", "summary", "text", "description"];
  const META_KEYS = ["price", "amount", "cost", "total", "count", "date", "status"];

  const out: Choice[] = [];
  for (const item of arr.slice(0, limit)) {
    const o = asRecord(item);
    if (!o) continue;
    const idKey = idKeyOf(o);
    const labelKey = LABEL_KEYS.find((k) => typeof o[k] === "string");
    if (!idKey || !labelKey) continue;
    const metaKey = META_KEYS.find((k) => o[k] !== undefined && o[k] !== null);
    const metaVal = metaKey ? o[metaKey] : undefined;
    out.push({
      id: String(o[idKey]),
      label: String(o[labelKey]),
      meta:
        typeof metaVal === "number" && metaKey && /price|amount|cost|total/.test(metaKey)
          ? `$${metaVal.toFixed(2)}`
          : metaVal !== undefined
            ? String(metaVal)
            : undefined,
    });
  }
  return out;
}
