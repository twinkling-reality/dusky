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
import { type Consequence, classify } from "@dusky/policy";

/**
 * 600x600 cannot scroll, and Meta requires 88px interactive targets. With a
 * title and a footer note that leaves room for four choices. A fifth is a
 * pagination affordance, never a squeezed fifth option.
 */
export const MAX_CHOICES = 4;

/**
 * Hard bounds for untrusted tool output that may survive beyond one frame.
 *
 * JSON is parsed only inside the character ceiling, traversal is iterative and
 * capped, and a string is shareable only when the entire sanitized value fits
 * on the transfer frame. A clipped field would ask the wearer to approve text
 * they could not fully inspect, so long fields are excluded rather than hidden.
 */
export const MAX_RESULT_CHARS = 32_768;
export const MAX_RESULT_DEPTH = 6;
export const MAX_RESULT_NODES = 128;
export const MAX_PROJECTION_CHARS = 120;
export const MAX_PROJECTIONS = 12;

export type ShareableValue = string | number | boolean;

export interface ShareableProjection {
  /** Stable JSON Pointer, or #summary for a summary derived by generic code. */
  location: string;
  label: string;
  value: ShareableValue;
  valueType: "string" | "number" | "boolean";
  kind: "summary" | "field" | "text";
}

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

export function humanizeParam(name: string): string {
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
 * The order the wearer's menu is in, which is a decision and not a sort call.
 *
 * The rows used to come out in whatever order `getTools` returned. AGENTS.md
 * says that ordering is the browser's business and never to depend on it, and
 * this menu depended on it completely: the same shop could produce a different
 * menu on a reload, so there was nothing for a wearer to learn. At four tools
 * that is invisible. At twenty it is ten screens, because pagination spends a
 * slot on "More" and the composer spends another, and `useDpad` focuses row
 * zero of every frame, so whichever tool happened to land first was one Enter
 * away from being started.
 *
 * An idle menu has no intent behind it, so there is nothing to rank against
 * and anything calling itself relevance here is guessing. What IS available is
 * what a press would COST, which `packages/policy` already decides from the
 * tool's own text and schema, deterministically, with no model and no
 * knowledge of any site. Ordering by that is the whole change. This file adds
 * no lexicon of its own and learns nothing new about language, because the
 * classification it sorts by already exists and is already tested.
 *
 * Reads first, then writes, then money, then destruction. Four things follow:
 *
 *  - Row zero, the one under the wearer's thumb, is a read whenever the source
 *    offers one. Nothing that spends or deletes is ever the default press.
 *  - The menu TEACHES the gate. Rows near the top run when you pick them; rows
 *    near the bottom stop and ask. On a panel with no cursor, no hover and no
 *    room for a chip on every line, order is the only channel that fact has,
 *    and because it is the same function `Session` consults, what the order
 *    implies is true rather than decorative.
 *  - It matches the order a person works in. You look before you act, which is
 *    exactly the sequence alphabetical inverts: sorted by name the consequence
 *    arrives above the question that should have preceded it.
 *  - Presses to reach a tool rise with what the tool costs. That friction is
 *    proportional to what is at stake rather than arbitrary, which is the only
 *    kind worth having, and the composer sits on every page for a wearer who
 *    already knows what they want.
 *
 * Ties break on the label, folded with `toLowerCase` and compared by code unit
 * rather than by locale, because a menu that depends on where the glasses
 * think they are is not deterministic either. Alphabetical is a poor primary
 * key and a good secondary one: inside a bucket it is how a wearer predicts
 * which page a name is on, which is the entire problem at twenty tools.
 * Remaining ties break on `toolId`, which is unique by construction, so this
 * is a total order and a stable sort never has to fall back on the browser's.
 *
 * A site writes its own name and title and therefore owns its own tiebreak. It
 * does not own its bucket, so the most a well-chosen title can buy is a better
 * slot among things that cost the same. Calling a destructive tool "Aaa" moves
 * it nowhere.
 *
 * Three alternatives were rejected, and the reasons are the argument:
 *
 *  - Alphabetical alone. Deterministic, and says nothing. It would have fixed
 *    the reload and left the shop's `add_to_basket` above its `search_books`.
 *  - Zero-argument tools first. One press to something useful, but "cheap to
 *    invoke" is a proxy for "close at hand", never for "wanted", and it buries
 *    every tool that does real work behind every tool that does very little.
 *  - Ranking against the last intent. The idle menu after a finished task is
 *    the common case and by then the intent is spent. It also costs the exact
 *    property this is buying: a menu that depends on history is one that
 *    differs between two wearers on the same site, and between Tuesday and
 *    Wednesday for one of them.
 *
 * This is not relevance ranking and must not grow into one. It is a total
 * order over a classification that was already there.
 */
const CEREMONY: Record<Consequence, number> = {
  read: 0,
  write: 1,
  financial: 2,
  destructive: 3,
};

/** Locale-independent, so the same tools order the same on any runtime. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function menuOrder(tools: readonly ToolDescriptor[]): ToolDescriptor[] {
  // Classify once each rather than once per comparison: `classify` normalizes
  // several strings, and this runs on every frame the menu is pushed.
  return tools
    .map((tool) => ({ tool, cost: CEREMONY[classify(tool)], name: label(tool).toLowerCase() }))
    .sort(
      (a, b) =>
        a.cost - b.cost ||
        compare(a.name, b.name) ||
        // Two rows called the same thing land next to each other, which is
        // what makes the host suffix `menuLabel` adds worth reading.
        compare(toolId(a.tool), toolId(b.tool)),
    )
    .map((entry) => entry.tool);
}

/**
 * The id of a row that opens one site's actions rather than running something.
 *
 * Prefixed like every other control row, so it can never be mistaken for a
 * parameter value. That is not hypothetical caution: pressing "Done" on an
 * empty field once set `product_id` to the literal string `"__submit"` and
 * walked on to a confirmation with it, because reserved ids were being coerced
 * into answers by the branch that collects them.
 */
export const SITE_PREFIX = "__site:";

/** The origin a site row opens, or null if this id is not one. */
export function siteFromChoice(id: string): string | null {
  return id.startsWith(SITE_PREFIX) ? id.slice(SITE_PREFIX.length) : null;
}

export interface MenuOptions {
  /**
   * The one site being browsed, when the wearer has stepped into one.
   *
   * Absent means the top of the menu, which is either every tool at once or a
   * row per site, depending on whether they fit. See below.
   */
  site?: string;
  /** What to call a site on a row. Falls back to its host, which is derived. */
  siteName?: (origin: string) => string;
}

/**
 * The menu: everything the wearer can currently do. Fully tool-derived.
 *
 * FLAT WHEN IT FITS, GROUPED WHEN IT DOES NOT.
 *
 * A panel four rows tall holding several businesses at once cannot show a flat
 * list of everything, and the arithmetic is worse than it looks: `paginate`
 * spends a slot on "More" and the composer spends another, so at seven tools
 * with a planner configured a flat menu is FOUR pages of two rows. Measured,
 * by running this function. Reaching `add_to_cart` from a cold menu took
 * eleven presses that way, against four today.
 *
 * So when the list will not fit AND more than one site is offering, the top of
 * the menu becomes one row per site and choosing one opens its actions. At two
 * sites that is three rows and no pagination anywhere, and it costs nothing:
 * the press that opens a site replaces the press that would have turned a
 * page, so `add_to_cart` is still four presses away.
 *
 * This is NOT the restriction coming back. What was removed is Dusky holding
 * one site at a time, so an agent could reach one business and a sentence could
 * not cross two. The registry is combined regardless of what the menu draws:
 * the planner ranks every site's tools together, `actions()` reports them
 * together, and one spoken request still crosses two businesses. Grouping is
 * navigation over a combined registry, not a partition of it.
 *
 * Grouping by `origin` is not a per-site branch. Nothing here learns which
 * origin, only that two rows came from different ones, exactly as `menuLabel`
 * already appends a host when two labels would collide.
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
  /**
   * Why the wearer is looking at this menu, when it is not simply where they
   * are. A request that could not be interpreted returns them here, and
   * without a word it is indistinguishable from a request that was carried
   * out: same frame, same note, on a panel with no history to scroll back
   * through.
   */
  note?: string,
  o: MenuOptions = {},
): DisplayFrame {
  const every = menuOrder(tools.filter(isOperable));
  // Stepped into a site: only its actions, and nobody else's.
  const operable = o.site ? every.filter((t) => t.origin === o.site) : every;

  // Speaking never occupies a paginated slot. Having to page through actions
  // to reach the affordance the whole product is built around would be
  // absurd, so it costs one slot from the tool list and is always present.
  const budget = canSpeak ? MAX_CHOICES - 1 : MAX_CHOICES;

  const origins = [...new Set(operable.map((t) => t.origin))];
  const grouped = !o.site && origins.length > 1 && operable.length > budget;

  const all: Choice[] = grouped
    ? origins.map((origin) => {
        const n = operable.filter((t) => t.origin === origin).length;
        return {
          id: `${SITE_PREFIX}${origin}`,
          label: o.siteName?.(origin) ?? hostOf(origin),
          meta: `${n} action${n === 1 ? "" : "s"}`,
        };
      })
    : operable.map((t, i) => ({
        id: toolId(t),
        label: menuLabel(t, operable),
        // Whose action this is, when the list holds more than one site's. The
        // slot used to carry the row's index, which is decoration: there is no
        // numeric input on these glasses, and "More 1/3" already says where
        // the wearer is. Naming the business is the one thing a mixed list
        // needs that a single site's never did.
        meta:
          origins.length > 1
            ? (o.siteName?.(t.origin) ?? hostOf(t.origin))
            : String(i + 1).padStart(2, "0"),
      }));

  // It sits LAST so a new menu focuses an action: focus lands on choice zero,
  // and opening a text field in someone's eye every time they return to the
  // menu is not what anyone wants.
  const { choices } = paginate(all, page, budget);
  if (canSpeak) choices.push({ id: "__compose", label: "Say what you want", meta: "tap" });

  return {
    kind: "idle",
    source,
    // A grouped frame contains navigation, not actions. Asking what somebody
    // wants to DO above rows named after sites makes those names read like
    // verbs. Ask the action question only after the wearer enters a site and
    // the rows beneath it are actions again.
    title: operable.length
      ? grouped
        ? "Choose a site"
        : "What do you want to do?"
      : "No actions available here",
    note: operable.length
      ? (note ??
        (grouped
          ? canSpeak
            ? "Browse actions, or say what you want"
            : "Each site contains its actions"
          : canSpeak
            ? "Tap to speak, or choose an action"
            : "Choose an action"))
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

  /*
   * text and number both route to the on-glasses composer, which the wearer
   * opens with focus then tap. Handwriting or dictation, their choice.
   *
   * TWO rows, and the second one is not decoration.
   *
   * The composer commits on Enter or on blur, and on real glasses neither was
   * reachable from a frame that offered only the composer. A tap on a focused
   * text field is taken by the OS to open its own writing surface, so it never
   * arrives as `Enter`; tapping again just reopens that surface. And `useDpad`
   * moves focus with `(i +/- 1 + count) % count`, which for `count === 1` is
   * always 0, so focus could not leave the input and blur could not fire
   * either. A wearer could write `oat`, see it sitting in the field, and have
   * no way whatsoever to send it. Verified on hardware 2026-08-28.
   *
   * A second row fixes it at the root rather than by adding a third commit
   * path: arrowing to it moves real DOM focus off the input, which fires the
   * blur that was always supposed to commit. Selecting it is then a no-op that
   * the session ignores, because by then the value has already gone.
   */
  return {
    kind: "choose",
    source,
    title,
    note: "Tap to write or speak, then Done",
    choices: [
      { id: "__compose", label: "Enter a value", meta: "tap" },
      { id: "__submit", label: "Done", meta: "enter" },
    ],
  };
}

/** Choice ids for retained projections are opaque and never contain a value. */
export const PROJECTION_PREFIX = "__projection:";

export interface ProjectionChoice {
  id: string;
  label: string;
  preview: string;
}

/** Choose one exact retained projection before any cross-origin consent step. */
export function projectionFrame(
  source: string,
  from: string,
  to: string,
  param: ParamSpec,
  projections: ProjectionChoice[],
  page = 0,
): DisplayFrame {
  const all = projections.map((p) => ({
    id: `${PROJECTION_PREFIX}${p.id}`,
    label: p.label,
    meta: p.preview,
  }));
  const { choices } = paginate(all, page);
  return {
    kind: "choose",
    source,
    title: `Fill ${humanizeParam(param.name)}?`,
    note: `${from} to ${to}`,
    choices,
  };
}

/**
 * The consent boundary for moving one bounded value between origins.
 *
 * This is deliberately not a tool confirmation. Sharing information and
 * authorizing the destination action are separate decisions in the machine.
 */
export function transferFrame(
  source: string,
  from: string,
  to: string,
  argument: string,
  preview: string,
): DisplayFrame {
  return {
    kind: "transfer",
    source,
    title: "Share this information?",
    from,
    to,
    argument: humanizeParam(argument),
    preview,
    note: "This shares data only. The action is checked next.",
    choices: [
      { id: "__share", label: "Share", meta: "enter" },
      { id: "__cancel", label: "Cancel", meta: "esc", tone: "danger" },
    ],
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
  target?: string,
  consequence?: string,
): DisplayFrame {
  const note = consequenceNote(consequence);
  return {
    kind: "confirm",
    source,
    title: label(tool),
    ...(target !== undefined && target !== "" ? { target } : {}),
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
  /** Another independently gated action remains in the spoken task. */
  next?: { label: string; index: number; total: number };
}

export function resultFrame(source: string, title: string, o: ResultOptions): DisplayFrame {
  const nextLabel = o.next?.label.trim() ?? "";
  const clippedNext = nextLabel.length > 28 ? `${nextLabel.slice(0, 25)}...` : nextLabel;
  return {
    kind: "result",
    source,
    ok: o.ok,
    title,
    detail: o.detail,
    facts: o.facts?.length ? o.facts : undefined,
    choices: o.next
      ? [
          {
            id: "__next",
            label: `Next: ${clippedNext || "continue task"}`,
            meta: `${o.next.index}/${o.next.total}`,
          },
        ]
      : [{ id: "__home", label: "Do something else", meta: "enter" }],
    ...(o.next ? { note: "Each action is checked and approved separately" } : {}),
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

function cleanResultText(raw: string): string {
  return (
    raw
      // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Inert, single-line display text with a deterministic ceiling. */
export function safeResultText(raw: string, max = MAX_PROJECTION_CHARS): string {
  const clean = cleanResultText(raw);
  if (clean.length <= max) return clean;
  if (max <= 3) return clean.slice(0, max);
  return `${clean.slice(0, max - 3)}...`;
}

/** A complete field value that fits on a transfer frame, never a clipped one. */
function completeResultText(raw: string): string | null {
  const clean = cleanResultText(raw);
  if (clean === "" || clean.length > MAX_PROJECTION_CHARS) return null;
  return clean;
}

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
  if (raw.length > MAX_RESULT_CHARS) return { ok: true };
  const rec = asRecord(safeParse(raw));
  if (!rec) return { ok: true };

  const said = (): string | undefined => {
    const m = rec["message"];
    return typeof m === "string" && cleanResultText(m) !== "" ? safeResultText(m) : undefined;
  };

  const err = rec["error"];
  if (typeof err === "string" && cleanResultText(err) !== "") {
    return { ok: false, message: safeResultText(err) };
  }
  const errRec = asRecord(err);
  if (errRec) {
    if (typeof errRec["message"] === "string") {
      return { ok: false, message: safeResultText(String(errRec["message"])) };
    }
    // An error object with something in it is a report of a failure even when
    // it does not carry prose. An empty one reports nothing.
    if (Object.keys(errRec).length > 0) return { ok: false, message: said() };
  }

  // A site says no in whichever way its own house style says no. These are
  // explicit negatives, not shapes nobody recognises, so reading them is not
  // the guessing rule 3 forbids. Anything not listed here is still a success.
  for (const key of ["ok", "success"]) {
    const v = rec[key];
    if (v === undefined) continue;
    const no =
      v === false ||
      v === 0 ||
      (typeof v === "string" && ["false", "no", "0"].includes(v.trim().toLowerCase()));
    if (no) return { ok: false, message: said() };
  }

  const status = rec["status"];
  if (
    typeof status === "string" &&
    /^(error|failed|failure|denied|rejected)$/i.test(status.trim())
  ) {
    return { ok: false, message: said() };
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
    const v = cleanResultText(value);
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
/**
 * A sentence the site meant a person to read, if there is one.
 *
 * Three shapes, in order. The result envelope the PROTOCOL defines,
 * `{content: [{type: "text", text: "..."}]}`, which is not a per-site branch:
 * no site chose those keys, the specification did, and every site speaking it
 * uses the same ones. Then a top-level `message` or `text`. Then plain words,
 * for a site that answered with prose rather than JSON.
 *
 * `null` means there is nothing here a person can read at a glance, which is
 * a better thing to know than to paper over: the caller used to flatten the
 * raw JSON instead, so a wearer got braces and quotes on a waveguide.
 */
export function textFromResult(raw: string): string | null {
  if (raw.length > MAX_RESULT_CHARS) return null;
  const parsed = safeParse(raw);
  const rec = asRecord(parsed);

  if (!rec) {
    // A JSON string is still a sentence.
    if (typeof parsed === "string") return completeResultText(parsed);
    // `safeParse` answers `null` both for "not JSON" and for a literal null,
    // and neither of those is a fact, so only unparseable text falls through
    // to being read as prose.
    if (parsed !== null) return null;
    const flat = completeResultText(raw);
    return flat === null || flat === "null" ? null : flat;
  }

  const said = contentText(rec);
  if (said.length > 0) return said.join(" ");

  for (const key of ["message", "text", "summary"]) {
    const v = rec[key];
    if (typeof v === "string") {
      const clean = completeResultText(v);
      if (clean !== null) return clean;
    }
  }
  return null;
}

/** The text blocks of a protocol content envelope, if this is one. */
function contentText(rec: Record<string, unknown>): string[] {
  const content = rec["content"];
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null) continue;
    const text = (item as Record<string, unknown>)["text"];
    if (typeof text === "string") {
      const clean = completeResultText(text);
      if (clean !== null) out.push(clean);
    }
  }
  return out;
}

export function factsFromResult(raw: string, limit = 4): Fact[] {
  if (raw.length > MAX_RESULT_CHARS) return [];
  const rec = asRecord(safeParse(raw));
  if (!rec) return [];

  // A result that is a single wrapper around one object, `{"product": {...}}`,
  // is describing that object. Read through it rather than reporting nothing.
  // A protocol content envelope carries a sentence, not fields. Counting its
  // blocks produced "Content / 1 item" and threw the sentence away.
  // `textFromResult` reads it; there is nothing key-value to add here.
  if (contentText(rec).length > 0) return [];

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
  if (raw.length > MAX_RESULT_CHARS) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function projectionValue(value: unknown): ShareableValue | null {
  if (typeof value === "string") return completeResultText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return typeof value === "boolean" ? value : null;
}

function pointerPart(raw: string): string | null {
  if (raw.length > 64 || cleanResultText(raw) !== raw) return null;
  return raw.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Extract the only result material a later task step is allowed to retain.
 *
 * No raw result survives this function. It returns a bounded generic summary
 * and bounded primitive leaves with stable locations. Traversal is iterative,
 * depth-limited and node-limited, so hostile nesting cannot grow the task
 * state or the call stack. Site names, tool names and domain keys are never
 * consulted.
 */
export function shareableProjectionsFromResult(
  raw: string,
  limit = MAX_PROJECTIONS,
): ShareableProjection[] {
  if (limit <= 0 || raw.length > MAX_RESULT_CHARS) return [];
  const parsed = safeParse(raw);
  if (parsed === null) return [];

  const out: ShareableProjection[] = [];
  const facts = factsFromResult(raw, 4);
  const factSummary = facts.map((f) => `${f.label}: ${f.value}`).join("; ");
  const readable = factSummary || textFromResult(raw) || "";
  if (readable) {
    out.push({
      location: "#summary",
      label: "Summary",
      value: safeResultText(readable),
      valueType: "string",
      kind: "summary",
    });
  }

  interface Node {
    value: unknown;
    location: string;
    label: string;
    depth: number;
    key?: string;
  }

  const queue: Node[] = [{ value: parsed, location: "", label: "Result", depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && out.length < limit && visited < MAX_RESULT_NODES) {
    const node = queue.shift() as Node;
    visited += 1;

    const primitive = projectionValue(node.value);
    if (primitive !== null) {
      if (node.key && VERDICT_KEYS.has(node.key.toLowerCase())) continue;
      if (!out.some((p) => p.valueType === typeof primitive && p.value === primitive)) {
        out.push({
          location: node.location || "#value",
          label: node.label,
          value: primitive,
          valueType: typeof primitive as "string" | "number" | "boolean",
          kind: node.location ? "field" : "text",
        });
      }
      continue;
    }

    if (node.depth >= MAX_RESULT_DEPTH) continue;
    if (Array.isArray(node.value)) {
      for (const [index, value] of node.value.slice(0, 12).entries()) {
        queue.push({
          value,
          location: `${node.location}/${index}`,
          label: `Item ${index + 1}`,
          depth: node.depth + 1,
        });
      }
      continue;
    }

    const rec = asRecord(node.value);
    if (!rec) continue;
    for (const [key, value] of Object.entries(rec).slice(0, 24)) {
      const part = pointerPart(key);
      if (part === null) continue;
      queue.push({
        value,
        location: `${node.location}/${part}`,
        label: humanizeKey(key),
        depth: node.depth + 1,
        key,
      });
    }
  }
  return out.slice(0, limit);
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
  if (raw.length > MAX_RESULT_CHARS) return [];
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
    const id = String(o[idKey]);
    const safeId = completeResultText(id);
    const safeLabel = completeResultText(String(o[labelKey]));
    // An identifier is sent onward exactly as selected. If making it safe to
    // display would change it, it cannot be offered honestly.
    if (safeId === null || safeId !== id || safeId.startsWith("__") || safeLabel === null) {
      continue;
    }
    out.push({
      id: safeId,
      label: safeLabel,
      meta:
        typeof metaVal === "number" && metaKey && /price|amount|cost|total/.test(metaKey)
          ? `$${metaVal.toFixed(2)}`
          : metaVal !== undefined
            ? safeResultText(String(metaVal), 32)
            : undefined,
    });
  }
  return out;
}
