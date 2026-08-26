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
  const pages = Math.max(1, Math.ceil(all.length / (budget - 1)));
  if (all.length <= budget) return { choices: all, pages: 1 };
  const size = budget - 1;
  const start = Math.min(page, pages - 1) * size;
  const slice = all.slice(start, start + size);
  slice.push({
    id: "__more",
    label: "More",
    meta: `${Math.min(page + 1, pages - 1) + 1}/${pages}`,
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
    id: t.name,
    label: label(t),
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
      : "This source declared no usable tools",
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
  const title = param.description?.trim() || `${humanizeParam(param.name)}?`;

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
export function confirmFrame(
  source: string,
  tool: ToolDescriptor,
  target: string,
  consequence?: string,
): DisplayFrame {
  return {
    kind: "confirm",
    source,
    title: label(tool),
    target,
    consequence,
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
    return v.length > 48 ? `${v.slice(0, 47)}...` : v;
  }
  if (Array.isArray(value)) {
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

  const ID_KEYS = ["id", "product_id", "sku", "key", "uid", "slug", "value"];
  const LABEL_KEYS = ["name", "title", "label", "summary", "text", "description"];
  const META_KEYS = ["price", "amount", "cost", "total", "count", "date", "status"];

  const out: Choice[] = [];
  for (const item of arr.slice(0, limit)) {
    const o = asRecord(item);
    if (!o) continue;
    const idKey = ID_KEYS.find((k) => typeof o[k] === "string" || typeof o[k] === "number");
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
