/**
 * The one place every Dusky surface agrees on shape.
 *
 * Nothing in here may import a browser API, a model provider, or a transport.
 * The Display client, the console bridge, and the server all compile against
 * this file, so a change here is a change to the whole system.
 */

/* ------------------------------------------------------------------ tools */

/** A JSON Schema as it arrives from a foreign site. Deliberately loose. */
export type JsonSchema = Record<string, unknown>;

/**
 * WebMCP exposes exactly two annotations. It does NOT carry MCP's
 * destructiveHint / idempotentHint / openWorldHint, so consequence has to be
 * classified by Dusky rather than read off the tool. See @dusky/policy.
 */
export interface ToolAnnotations {
  readOnlyHint: boolean;
  untrustedContentHint: boolean;
}

/** A tool discovered from a participating origin, normalized for our use. */
export interface ToolDescriptor {
  name: string;
  title?: string;
  description: string;
  /** Origin that registered the tool. Always present, always trusted (browser supplied). */
  origin: string;
  /** Parsed defensively: Chrome returns this as a JSON string, not an object. */
  inputSchema: JsonSchema | null;
  annotations: ToolAnnotations;
}

/* ------------------------------------------------------------- display UI */

export type ChoiceTone = "default" | "danger";

export interface Choice {
  id: string;
  label: string;
  /** Short right-aligned annotation: a price, an index, a key hint. */
  meta?: string;
  tone?: ChoiceTone;
}

/**
 * What the glasses render. One decision per frame, by construction:
 * every variant carries at most a handful of choices and a single question.
 *
 * The 600x600 waveguide cannot scroll, so a frame that does not fit is a bug
 * in frame construction, not something the client should paper over.
 */
export type DisplayFrame =
  | { kind: "idle"; source: string; title: string; note?: string; choices: Choice[] }
  | { kind: "working"; source: string; title: string; note?: string }
  | { kind: "choose"; source: string; title: string; note?: string; choices: Choice[] }
  | {
      kind: "confirm";
      source: string;
      title: string;
      /** The exact thing being acted on. Comes from the tool, never from prose. */
      target: string;
      /** Price, permanence, refundability. Omitted when genuinely unknown. */
      consequence?: string;
      choices: Choice[];
    }
  | {
      kind: "result";
      source: string;
      ok: boolean;
      title: string;
      detail?: string;
      choices: Choice[];
    }
  | {
      kind: "error";
      source: string;
      title: string;
      detail?: string;
      retryable: boolean;
      choices: Choice[];
    };

/** Progressive states the wearer can observe. Mirrors the frame kinds loosely. */
export type TaskState =
  | "idle"
  | "selected"
  | "working"
  | "confirm_required"
  | "completed"
  | "failed"
  | "cancelled";

/* ------------------------------------------------- display <-> server wire */

export type DisplayToServer =
  | { t: "hello"; sessionId: string; client: "display" }
  | { t: "choose"; frameId: string; choiceId: string }
  /** Text committed by the on-glasses composer (handwriting or dictation). */
  | { t: "text"; frameId: string; value: string }
  | { t: "cancel"; frameId: string }
  | { t: "ping" };

export type ServerToDisplay =
  /** Sent within 150ms of a choose, before any work happens. */
  | { t: "ack"; frameId: string; choiceId: string }
  | { t: "frame"; frameId: string; state: TaskState; frame: DisplayFrame }
  | { t: "bye"; reason: string };

/* ------------------------------------------------- console <-> server wire */

/**
 * The console is Dusky's WebMCP client. It holds the partner site in an
 * allow="tools" iframe and is the only surface that can reach modelContext.
 * The server never touches a tool directly.
 */
export type ServerToConsole =
  | { t: "discover"; requestId: string; origins: string[] }
  | { t: "invoke"; requestId: string; origin: string; toolName: string; args: unknown }
  | { t: "bye"; reason: string };

export type ConsoleToServer =
  | { t: "hello"; sessionId: string; client: "console" }
  | { t: "tools"; requestId: string; tools: ToolDescriptor[] }
  | { t: "invoked"; requestId: string; ok: true; value: string }
  | { t: "invoked"; requestId: string; ok: false; error: string }
  /** Fired from ontoolchange so the Display can refresh without polling. */
  | { t: "toolsChanged" };

/* ------------------------------------------------------------------ audit */

/**
 * Append only. This is a product feature, not plumbing: it is how a wearer
 * answers "what did it actually do" after the fact.
 */
export interface AuditEntry {
  at: string;
  sessionId: string;
  kind: "discover" | "gate" | "invoke" | "result" | "cancel" | "error";
  origin?: string;
  toolName?: string;
  /** Never contains credentials. Arguments are recorded, secrets are not. */
  detail?: Record<string, unknown>;
}

export const DISPLAY_VIEWPORT = { width: 600, height: 600 } as const;
/** Meta's documented minimum interactive target on the waveguide. */
export const MIN_TARGET_PX = 88;
