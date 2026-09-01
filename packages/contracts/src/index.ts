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

/**
 * One labelled value read out of a tool result.
 *
 * Facts are extracted from the site's own returned JSON, never written by a
 * model and never composed as prose. A wearer reading a fact is reading what
 * the site actually said, which is the only reason a glanceable summary can be
 * trusted at all.
 */
export interface Fact {
  label: string;
  value: string;
}

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
      /**
       * The exact thing being acted on. Comes from the tool, never from prose.
       *
       * Optional, because a tool that takes no arguments has nothing to name.
       * It used to fall back to the tool's own label, which the title above is
       * already set from, so `empty_cart` asked a wearer to confirm
       * "Empty cart / Empty cart".
       */
      target?: string;
      /** Price, permanence, refundability. Omitted when genuinely unknown. */
      consequence?: string;
      choices: Choice[];
    }
  | {
      /** A distinct consent boundary for information crossing origins. */
      kind: "transfer";
      source: string;
      title: string;
      /** Readable names only. Trusted provenance remains the browser-supplied origins. */
      from: string;
      to: string;
      /** The destination field that will receive the approved value. */
      argument: string;
      /** The exact bounded value that will be applied, rendered as inert text. */
      preview: string;
      note?: string;
      choices: Choice[];
    }
  | {
      kind: "result";
      source: string;
      /** Read from the returned result. A returned error is NOT a success. */
      ok: boolean;
      title: string;
      detail?: string;
      /** Guidance for an intermediate result in a longer task. */
      note?: string;
      /** Short labelled values lifted from the result, for a glance. */
      facts?: Fact[];
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
  | "transfer_required"
  | "confirm_required"
  | "completed"
  | "failed"
  | "cancelled";

/** Provider-neutral identity used by runtime activity and visual evidence. */
export interface RuntimeToolRef {
  origin: string;
  name: string;
}

/**
 * Why the current Display frame exists.
 *
 * `DisplayFrame.kind` deliberately stays small for rendering. A working frame
 * can mean planning, resolving an argument, or invoking a provider, though,
 * and those are materially different claims in a runtime topology.
 */
export type SessionPhase =
  | "idle"
  | "planning"
  | "parameters"
  | "approval"
  | "transfer"
  | "resolving"
  | "invoking"
  | "result"
  | "error";

/** Semantic outcome derived by the session, never inferred from a return alone. */
export type SessionOutcome = "succeeded" | "failed" | "unknown";

export interface SessionTaskRef {
  current: number;
  total: number;
}

/** Latest non-sensitive state sent when a console attaches or reconnects. */
export interface SessionActivitySnapshot {
  /** Monotonic within one SessionActor. Consumers use it to ignore old events. */
  revision: number;
  displayConnected: boolean;
  frameId: string;
  frameKind: DisplayFrame["kind"];
  phase: SessionPhase;
  tool?: RuntimeToolRef;
  task?: SessionTaskRef;
  outcome?: SessionOutcome;
}

/**
 * Bounded evidence for the console topology.
 *
 * Raw choices, text, arguments, results, and provider prose are intentionally
 * absent. The stream says which boundary changed, not what private value moved.
 */
export type SessionActivityEvent =
  | { kind: "display_presence"; revision: number; connected: boolean }
  | {
      kind: "display_input";
      revision: number;
      frameId: string;
      input: "choice" | "text" | "cancel";
    }
  | {
      kind: "frame";
      revision: number;
      frameId: string;
      frameKind: DisplayFrame["kind"];
      phase: SessionPhase;
      tool?: RuntimeToolRef;
      task?: SessionTaskRef;
      outcome?: SessionOutcome;
    };

/* ------------------------------------------------- display <-> server wire */

export type DisplayToServer =
  | { t: "hello"; sessionId: string; client: "display" }
  | { t: "choose"; frameId: string; choiceId: string }
  /** Text committed by the on-glasses composer (handwriting or dictation). */
  | { t: "text"; frameId: string; value: string }
  | { t: "cancel"; frameId: string }
  /**
   * Liveness, and the reason it cannot be left to the socket.
   *
   * When the glasses sleep, the page is suspended rather than closed. The
   * radio goes quiet with no FIN and no RST, so `readyState` stays OPEN, sends
   * disappear into a dead socket, and no `close` event ever fires: the Display
   * keeps rendering a stale frame with dead controls and does not know it.
   * Only traffic can tell the difference, so the Display sends these and
   * expects an answer.
   */
  | { t: "ping" };

export type ServerToDisplay =
  /** Sent within 150ms of a choose, before any work happens. */
  | { t: "ack"; frameId: string; choiceId: string }
  | { t: "frame"; frameId: string; state: TaskState; frame: DisplayFrame }
  /** The answer to a `ping`. Its only job is to be inbound traffic. */
  | { t: "pong" }
  | { t: "bye"; reason: string };

/* ------------------------------------------------- console <-> server wire */

/**
 * One site a console is holding, as the relay is told about it.
 *
 * A console holds every site at once rather than one at a time, so what it
 * announces on connect is a LIST. That was always half true: `origins` has
 * been an array since the bridge was written, and only the label beside it was
 * singular, which is why the relay could serve several origins and still tell
 * the wearer it was somewhere else.
 *
 * The origin decides everything and the browser supplies it, so a site cannot
 * forge one. The name decides nothing: it is written by whoever configured the
 * console, it is what a wearer reads in a frame's eyebrow, and no gate, audit
 * entry or frame behaviour consults it. Absent when the console has no name to
 * offer, in which case the host is used, because a host is derived rather than
 * claimed.
 */
export interface SiteRef {
  origin: string;
  name?: string;
}

/**
 * The console is Dusky's WebMCP client. It holds every participating site in
 * an allow="tools" iframe and is the only surface that can reach
 * modelContext. The server never touches a tool directly.
 */
export type ServerToConsole =
  | { t: "discover"; requestId: string; origins: string[] }
  /** Hydrates topology state without replaying old motion on reconnect. */
  | { t: "sessionSnapshot"; snapshot: SessionActivitySnapshot }
  /** Live, ordered evidence of accepted Display input and visible transitions. */
  | { t: "sessionActivity"; event: SessionActivityEvent }
  | {
      t: "invoke";
      requestId: string;
      origin: string;
      toolName: string;
      args: unknown;
      /** The exact declaration whose policy and parameter screens the wearer saw. */
      expectedTool: ToolDescriptor;
    }
  | { t: "cancelInvoke"; requestId: string }
  /** Answer to an outside agent's request, routed back through the console. */
  | { t: "agentReply"; requestId: string; reply: AgentReply }
  | { t: "bye"; reason: string };

export type ConsoleToServer =
  | { t: "hello"; sessionId: string; client: "console" }
  /**
   * The answer to a `discover`.
   *
   * `error` is what makes "we could not look" different from "there was
   * nothing to see". Without it the console had to launder a thrown bridge
   * into an empty list, and the relay could not tell the two apart, so a
   * browser without WebMCP produced "This source declared no usable tools" on
   * the wearer's lens: a confident statement about a site, from a failure that
   * never reached one.
   */
  | { t: "tools"; requestId: string; tools: ToolDescriptor[]; error?: string }
  | { t: "invoked"; requestId: string; ok: true; value: string }
  | { t: "invoked"; requestId: string; ok: false; error: string }
  /**
   * Whether the current multi-origin discovery pass is quiet enough to plan
   * against as a whole. False does not hide deterministic menu choices already
   * discovered; it only prevents a new interpreted task from racing a partial
   * registry.
   */
  | { t: "discoverySettled"; settled: boolean }
  /** Fired from ontoolchange so the Display can refresh without polling. */
  | { t: "toolsChanged" }
  /**
   * An agent in the console's browser called one of Dusky's own tools.
   *
   * The console is a transport here, not an authority. The server owns the
   * task state, so the server is what decides whether a request is allowed.
   */
  | { t: "agent"; requestId: string; request: AgentRequest };

/* ------------------------------------------- an outside agent <-> a session */

/**
 * What an agent driving Dusky from the browser may ask of a session.
 *
 * NOTE WHAT IS ABSENT: there is no session identifier anywhere in this type,
 * and there must never be one. These requests arrive through tools registered
 * by a console page that is already paired to exactly one session, so the
 * session is implied by which document the call arrived in. The moment a
 * caller can NAME a session, anyone able to reach the tool can drive any
 * session whose pairing code they can guess, and those codes are six
 * characters long because a wearer has to read them off a lens.
 */
export type AgentRequest =
  | { op: "status" }
  | { op: "actions" }
  | { op: "task"; text: string }
  | { op: "cancel" };

export type AgentReply =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

/** One thing the wearer's current source can do, as an outside agent sees it. */
export interface AgentAction {
  name: string;
  title: string;
  origin: string;
  /** From @dusky/policy, so an agent is told the ceremony code will enforce. */
  consequence: string;
  needsApproval: boolean;
}

/* ------------------------------------------------------------------ audit */

/**
 * Append only. This is a product feature, not plumbing: it is how a wearer
 * answers "what did it actually do" after the fact.
 */
export interface AuditEntry {
  at: string;
  sessionId: string;
  /** `plan` records what a model proposed, including proposals code refused. */
  kind: "discover" | "plan" | "transfer" | "gate" | "invoke" | "result" | "cancel" | "error";
  origin?: string;
  toolName?: string;
  /** Never contains credentials, raw transfer values, or message bodies. */
  detail?: Record<string, unknown>;
}

/**
 * The alphabet a pairing code is drawn from.
 *
 * Letters only, minus I, L and O. The code is read by a human off a waveguide
 * and typed somewhere else, so dropping digits kills every digit-letter
 * confusion at once (0/O, 1/I, 5/S, 8/B, 2/Z, 3/J) and dropping those three
 * letters kills the ones that look like each other. See the note in
 * apps/display/src/App.tsx for what this cost to learn.
 *
 * It lives here because two surfaces now mint codes: the Display, when a
 * wearer opens it on the glasses, and the website, when someone starts a demo
 * with no glasses at all. Two alphabets that drifted apart would produce codes
 * one of them could not display legibly.
 */
export const SESSION_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";

/** Six places over 23 symbols, which is about 148 million codes. */
export const SESSION_CODE_LENGTH = 6;

/**
 * Why a socket was closed: something else took this session.
 *
 * One session holds one console and one display, and attaching a second closes
 * the first. Without a way to say WHY, the loser saw an ordinary close and did
 * the ordinary thing, which is reconnect a quarter of a second later and evict
 * the winner in turn. Neither side backs off after a successful open, so the
 * exchange never slowed down, and every console attach re-runs discovery and
 * pushes a frame: two tabs on one pairing code rebuilt the wearer's screen
 * several times a second, indefinitely.
 *
 * A code in the 4000-4999 range is the application's to define, and it is the
 * only part of a close a browser client can read.
 */
export const CLOSE_SUPERSEDED = 4001;

/**
 * Why a socket was closed: what it asked for is not a pairing code.
 *
 * Terminal, unlike a dropped link. A code that is not a code will not become
 * one by asking again, so a client that treats this as an ordinary close
 * reconnects forever against a relay that will keep refusing it. Found by
 * writing a test whose own session id contained an `I`, which the alphabet
 * excludes precisely because it is hard to read off a lens.
 */
export const CLOSE_NOT_A_CODE = 4400;

/**
 * Whether a string could have come off a lens.
 *
 * Here rather than in either surface because both have to ask and they must
 * not answer differently. The browser asked before typing a code into a form;
 * the relay did not ask at all, and took `msg.sessionId.toUpperCase()` for any
 * string of any length, minting a session actor for each distinct one. A check
 * that only exists in the browser is a check enforced in the layer an attacker
 * is already standing in.
 */
export function isSessionCode(raw: string): boolean {
  const v = raw.trim().toUpperCase();
  if (v.length !== SESSION_CODE_LENGTH) return false;
  return [...v].every((c) => SESSION_CODE_ALPHABET.includes(c));
}

export const DISPLAY_VIEWPORT = { width: 600, height: 600 } as const;
/** Meta's documented minimum interactive target on the waveguide. */
export const MIN_TARGET_PX = 88;
