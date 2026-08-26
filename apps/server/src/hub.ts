import { randomUUID } from "node:crypto";
import type {
  AuditEntry,
  ConsoleToServer,
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
  readonly audit: AuditEntry[] = [];

  constructor(
    readonly id: string,
    private readonly source: string,
    makePlanner?: PlannerFactory,
  ) {
    const record = (e: Omit<AuditEntry, "at" | "sessionId">) => {
      this.audit.push({ ...e, at: new Date().toISOString(), sessionId: this.id });
      if (this.audit.length > 500) this.audit.shift();
    };
    this.runner = new RemoteToolRunner((msg) => this.toConsole(msg));
    this.session = new Session({
      source: this.source,
      runner: this.runner,
      // One planner per session, so its proposals and refusals land in this
      // wearer's audit trail rather than a shared one.
      planner: makePlanner?.(record),
      onAudit: record,
      // Every frame the machine produces goes to the glasses as it happens,
      // not just the one a call happens to settle on. Working and thinking
      // frames only exist for the wearer if they are transmitted while the
      // work is still running.
      onTransition: () => this.pushFrame(),
    });
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
    // Replay rather than restart: the wearer keeps their place.
    this.pushFrame();
  }

  detachDisplay(sock: WebSocket): void {
    if (this.display === sock) this.display = null;
  }

  async attachConsole(sock: WebSocket, origins: string[]): Promise<void> {
    this.consoleSock?.close();
    this.consoleSock = sock;
    this.runner.origins = origins;
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
      case "ping":
        return;
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
    }
  }
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

  constructor(private readonly makePlanner?: PlannerFactory) {}

  get(id: string, source: string): SessionActor {
    let s = this.sessions.get(id);
    if (!s) {
      s = new SessionActor(id, source, this.makePlanner);
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
