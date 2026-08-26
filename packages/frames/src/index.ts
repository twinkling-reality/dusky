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

import type { Choice, DisplayFrame, JsonSchema, ToolDescriptor } from "@dusky/contracts";

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

function paginate(all: Choice[], page: number): { choices: Choice[]; pages: number } {
  const pages = Math.max(1, Math.ceil(all.length / (MAX_CHOICES - 1)));
  if (all.length <= MAX_CHOICES) return { choices: all, pages: 1 };
  const size = MAX_CHOICES - 1;
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

/** The menu: everything this source can currently do. Fully tool-derived. */
export function idleFrame(source: string, tools: ToolDescriptor[], page = 0): DisplayFrame {
  const operable = tools.filter(isOperable);
  const all: Choice[] = operable.map((t, i) => ({
    id: t.name,
    label: label(t),
    meta: String(i + 1).padStart(2, "0"),
  }));
  const { choices } = paginate(all, page);
  return {
    kind: "idle",
    source,
    title: operable.length ? "What do you want to do?" : "No actions available here",
    note: operable.length
      ? "Tap to speak, or choose an action"
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

export function resultFrame(source: string, title: string, detail?: string): DisplayFrame {
  return {
    kind: "result",
    source,
    ok: true,
    title,
    detail,
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
