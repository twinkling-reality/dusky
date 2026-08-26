import { randomUUID } from "node:crypto";
import type { AuditStore } from "@dusky/audit";
import type {
  AgentReply,
  AgentRequest,
  AuditEntry,
  ConsoleToServer,
  DisplayFrame,
  DisplayToServer,
  ServerToConsole,
  ServerToDisplay,
  ToolDescriptor,
} from "@dusky/contracts";
import { Session, type ToolRunner } from "@dusky/session";
import type { WebSocket } from "ws";
import type { PlannerFactory } from "./planner.js";

/**
 * The session hub.
 *
 * One `SessionActor` per paired wearer. The actor owns the task state, which
 * is what lets a console reload or a dropped socket happen without losing the
 * wearer's place: on reconnect we replay the current frame rather than
 * restarting the task.
 *
 * The boundary here is deliberate. This file holds transport and lifetime; all
 * task logic lives in @dusky/session and all trust decisions in @dusky/policy.
 * When this moves to a Cloudflare Durable Object, only this file changes.
 */

const INVOKE_REPLY_TIMEOUT_MS = 20_000;

/**
 * Reaches WebMCP by asking the paired console to do it.
 *
 * The server can never touch a tool directly: tools live in the partner site's
 * document inside the user's own browser session, which is exactly why Dusky
 * never holds a partner's credentials.
 */
class RemoteToolRunner implements ToolRunner {
  private waiting = new Map<
    string,
    { resolve: (v: never) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(private readonly send: (msg: ServerToConsole) => boolean) {}

  private request<T>(build: (requestId: string) => ServerToConsole): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const requestId = randomUUID();
      if (!this.send(build(requestId))) {
        reject(new Error("No browser is connected to this session."));
        return;
      }
      const timer = setTimeout(() => {
        this.waiting.delete(requestId);
        reject(new Error("The browser did not respond."));
      }, INVOKE_REPLY_TIMEOUT_MS);
      this.waiting.set(requestId, {
        resolve: resolve as (v: never) => void,
        reject,
        timer,
      });
    });
  }

  /** Called by the actor when the console replies. */
  settle(requestId: string, value: unknown, error?: string): void {
    const w = this.waiting.get(requestId);
    if (!w) return;
    clearTimeout(w.timer);
    this.waiting.delete(requestId);
    if (error !== undefined) w.reject(new Error(error));
    else (w.resolve as (v: unknown) => void)(value);
  }

  /** Fails every outstanding request when the console goes away. */
  abortAll(reason: string): void {
    for (const [, w] of this.waiting) {
      clearTimeout(w.timer);
      w.reject(new Error(reason));
    }
    this.waiting.clear();
  }

  discover(): Promise<ToolDescriptor[]> {
    return this.request<ToolDescriptor[]>((requestId) => ({
      t: "discover",
      requestId,
      origins: this.origins,
    }));
  }

  origins: string[] = [];

  invoke(origin: string, name: string, args: Record<string, unknown>): Promise<string> {
    return this.request<string>((requestId) => ({
      t: "invoke",
      requestId,
      origin,
      toolName: name,
      args,
    }));
  }
}

export class SessionActor {
  private display: WebSocket | null = null;
  private consoleSock: WebSocket | null = null;
  private readonly runner: RemoteToolRunner;
  private session: Session;
  private frameId = "0";
  private seq = 0;
  private readonly hasPlanner: boolean;
  private readonly record: (e: Omit<AuditEntry, "at" | "sessionId">) => void;

  constructor(
    readonly id: string,
    private source: string,
    private readonly makePlanner?: PlannerFactory,
    private readonly audit?: AuditStore,
  ) {
    // The trail goes to a store rather than an array on this object, so it
    // outlives the process that happened to be running when it was written.
    const record = (e: Omit<AuditEntry, "at" | "sessionId">) => {
      this.audit?.append({ ...e, at: new Date().toISOString(), sessionId: this.id });
    };
    this.record = record;
    this.hasPlanner = makePlanner !== undefined;
    this.runner = new RemoteToolRunner((msg) => this.toConsole(msg));
    this.session = this.makeSession();
  }

  private makeSession(): Session {
    return new Session({
      source: this.source,
      runner: this.runner,
      // One planner per session, so its proposals and refusals land in this
      // wearer's audit trail rather than a shared one.
      planner: this.makePlanner?.(this.record),
      onAudit: this.record,
      // Every frame the machine produces goes to the glasses as it happens,
      // not just the one a call happens to settle on. Working and thinking
      // frames only exist for the wearer if they are transmitted while the
      // work is still running.
      onTransition: () => this.pushFrame(),
    });
  }

  /** The frame the wearer is looking at. Read-only, for diagnostics and tests. */
  current(): DisplayFrame {
    return this.session.current();
  }

  private toConsole(msg: ServerToConsole): boolean {
    if (this.consoleSock?.readyState !== 1) return false;
    this.consoleSock.send(JSON.stringify(msg));
    return true;
  }

  private toDisplay(msg: ServerToDisplay): void {
    if (this.display?.readyState !== 1) return;
    this.display.send(JSON.stringify(msg));
  }

  /** Push the current frame. Called after every transition and on reconnect. */
  private pushFrame(): void {
    this.seq += 1;
    this.frameId = String(this.seq);
    this.toDisplay({
      t: "frame",
      frameId: this.frameId,
      state: stateFor(this.session.current().kind),
      frame: this.session.current(),
    });
  }

  attachDisplay(sock: WebSocket): void {
    this.display?.close();
    this.display = sock;
    // Say NOTHING until a browser has paired.
    //
    // The Display shows its own pairing frame, with the code on it, until the
    // relay sends something. Pushing the empty menu here replaced that with
    // "No actions available here / This source declared no usable tools",
    // which tells the wearer the site has nothing to offer when the truth is
    // that nothing has connected yet. Two different situations, and the
    // wrong one was the first thing anyone saw.
    //
    // Once a console is attached this is a replay rather than a restart, so
    // the wearer keeps their place across a dropped socket.
    if (this.consoleSock?.readyState === 1) this.pushFrame();
  }

  detachDisplay(sock: WebSocket): void {
    if (this.display === sock) this.display = null;
  }

  /**
   * A console has arrived, holding some partner site.
   *
   * The source label comes with it, because the console is the surface that
   * actually has the site loaded and the relay does not. `DUSKY_SOURCE` stays
   * as the fallback for a deployment that only ever points at one place.
   *
   * The label is COSMETIC and carries no authority. It is not consulted by the
   * gate, it is not what the audit trail records, and no frame behaves
   * differently because of it: the unspoofable fact about where a tool came
   * from is its origin, which the browser supplies and which appears on every
   * audit entry. It is sanitized on the way in for the same reason a tool
   * description is, since it ends up rendered on a lens.
   */
  async attachConsole(sock: WebSocket, origins: string[], source?: string): Promise<void> {
    this.consoleSock?.close();
    this.consoleSock = sock;
    this.runner.origins = origins;
    const named = displayLabel(source);
    if (named && named !== this.source) {
      this.source = named;
      // The machine holds its source at construction, and a different source
      // is a different task anyway, so this restarts rather than mutates.
      this.session = this.makeSession();
    }
    await this.session.start();
  }

  detachConsole(sock: WebSocket): void {
    if (this.consoleSock !== sock) return;
    this.consoleSock = null;
    this.runner.abortAll("The browser disconnected.");
  }

  async onDisplayMessage(msg: DisplayToServer): Promise<void> {
    switch (msg.t) {
      case "hello":
        return;
      // Answered BEFORE the pairing guard below, deliberately. A wearer
      // staring at the pairing code has the same right to know their link is
      // dead as one halfway through a task, and that screen is the one they
      // will be sitting on longest.
      case "ping":
        this.toDisplay({ t: "pong" });
        return;
      default:
        break;
    }

    // Say nothing until a browser has paired, on THIS path too.
    //
    // `attachDisplay` is carefully guarded so the wearer keeps their pairing
    // frame, with the code on it, until a console connects. Nothing guarded
    // the messages that arrive afterwards, so one Escape on that screen ran
    // `__cancel`, which showed and pushed an empty menu: the six characters
    // the wearer has to read off the lens were replaced by "No actions
    // available here / This source declared no usable tools", which is untrue
    // about a site that never connected, on a frame with no choices on it.
    //
    // Nobody has documented how a wearer relaunches a web app on these
    // glasses, so there may be no way back from that screen.
    if (this.consoleSock?.readyState !== 1) return;

    switch (msg.t) {
      case "choose":
        // Acknowledge before any work, so the wearer never wonders.
        this.toDisplay({ t: "ack", frameId: msg.frameId, choiceId: msg.choiceId });
        await this.session.handle(msg.choiceId);
        return;
      case "text":
        await this.session.submitText(msg.value);
        return;
      case "cancel":
        await this.session.handle("__cancel");
        return;
    }
  }

  /* ------------------------------------------- requests from an outside agent */

  /**
   * Whether the wearer is in the middle of something a task must not disturb.
   *
   * `confirm` is the one that matters. If an inbound task could replace a
   * pending confirmation, an agent could swap what is about to be approved
   * while the wearer's attention is on the old target and their finger is
   * already moving. That is the same attack `isConfirmationFresh` defends
   * against when a site changes its tools, arriving through a different door.
   *
   * `choose` and `working` are refused for a plainer reason: the wearer is
   * mid-decision, and yanking the frame out from under them is rude even when
   * it is safe. Both states are derived from the frame rather than tracked
   * separately, so they cannot drift out of step with what is on the lens.
   */
  private busyWith(): string | null {
    switch (this.session.current().kind) {
      case "confirm":
        return "the wearer is being asked to approve an action";
      case "choose":
        return "the wearer is being asked for something";
      case "working":
        return "an action is already running";
      default:
        return null;
    }
  }

  private statusValue(): Record<string, unknown> {
    const frame = this.session.current();
    const busy = this.busyWith();
    return {
      session: this.id,
      source: this.source,
      display_connected: this.display?.readyState === 1,
      state: stateFor(frame.kind),
      showing: {
        kind: frame.kind,
        title: "title" in frame ? frame.title : undefined,
        target: frame.kind === "confirm" ? frame.target : undefined,
      },
      can_interpret_requests: this.hasPlanner,
      accepting_tasks: busy === null && this.display?.readyState === 1,
      not_accepting_because: busy ?? undefined,
    };
  }

  /**
   * Handle one request from an agent in the console's browser.
   *
   * The console is a transport, not an authority: every rule below is applied
   * here because this is where the task state actually lives. An agent can ask
   * for things; it cannot approve anything, and nothing it sends skips the
   * gate, because a task goes through the same `Session` a gesture does.
   */
  async onAgentRequest(request: AgentRequest): Promise<AgentReply> {
    switch (request.op) {
      case "status":
        return { ok: true, value: this.statusValue() };

      case "actions":
        return { ok: true, value: { source: this.source, actions: this.session.actions() } };

      case "task": {
        const text = request.text?.trim() ?? "";
        if (!text) return { ok: false, error: "A task needs something to act on." };
        if (this.display?.readyState !== 1) {
          return {
            ok: false,
            error: `No display is connected to session ${this.id}. Ask the wearer to open Dusky on their glasses and enter ${this.id}.`,
          };
        }
        // Order matters. Whether the wearer is mid-decision is checked BEFORE
        // whether this relay can interpret anything, because not interrupting
        // someone is an invariant and must not depend on how a deployment
        // happens to be configured.
        const busy = this.busyWith();
        if (busy) {
          return {
            ok: false,
            error: `Not sent: ${busy}. Interrupting would change what they are deciding about. Try again once they have finished.`,
          };
        }
        if (!this.hasPlanner) {
          return {
            ok: false,
            error:
              "This Dusky relay has no planner enabled, so it cannot turn a request into an action. The wearer can still choose from the menu on their glasses.",
          };
        }
        this.record({ kind: "plan", detail: { path: "agentTask", text } });
        await this.session.submitIntent(text);
        return {
          ok: true,
          value: {
            sent: text,
            ...this.statusValue(),
            note: "The wearer decides. Anything consequential stops for their approval.",
          },
        };
      }

      case "cancel": {
        // Always allowed. Cancelling can only ever reduce what happens, so
        // there is no state in which refusing it would protect the wearer.
        await this.session.handle("__cancel");
        return { ok: true, value: this.statusValue() };
      }
    }
  }

  async onConsoleMessage(msg: ConsoleToServer): Promise<void> {
    switch (msg.t) {
      case "hello":
        return;
      case "tools":
        this.runner.settle(msg.requestId, msg.tools);
        return;
      case "invoked":
        if (msg.ok) this.runner.settle(msg.requestId, msg.value);
        else this.runner.settle(msg.requestId, undefined, msg.error);
        return;
      case "toolsChanged":
        // A page added or removed tools. Re-discover and repaint so the wearer
        // never selects something that has since disappeared.
        await this.session.start();
        return;
      case "agent": {
        const reply = await this.onAgentRequest(msg.request);
        this.toConsole({ t: "agentReply", requestId: msg.requestId, reply });
        return;
      }
    }
  }
}

/**
 * Clean a source label enough to put it in front of someone's eye.
 *
 * Control characters cannot open a new line on a 600x600 panel with no
 * scrolling, and an unbounded string would push the rest of the frame off it.
 * Returns undefined for anything that is not usable, so the caller keeps
 * whatever it already had.
 */
function displayLabel(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const clean = raw
    // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean === "") return undefined;
  return clean.length > 40 ? clean.slice(0, 40) : clean;
}

function stateFor(kind: string) {
  switch (kind) {
    case "working":
      return "working" as const;
    case "confirm":
      return "confirm_required" as const;
    case "result":
      return "completed" as const;
    case "error":
      return "failed" as const;
    default:
      return "idle" as const;
  }
}

export class Hub {
  private sessions = new Map<string, SessionActor>();

  constructor(
    private readonly makePlanner?: PlannerFactory,
    private readonly audit?: AuditStore,
  ) {}

  get(id: string, source: string): SessionActor {
    let s = this.sessions.get(id);
    if (!s) {
      s = new SessionActor(id, source, this.makePlanner, this.audit);
      this.sessions.set(id, s);
    }
    return s;
  }

  peek(id: string): SessionActor | undefined {
    return this.sessions.get(id);
  }

  list(): string[] {
    return [...this.sessions.keys()];
  }
}
