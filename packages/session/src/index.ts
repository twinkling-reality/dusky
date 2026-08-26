/**
 * The task machine: intent in, frames out.
 *
 * This package is the reason Dusky can move its orchestration from the browser
 * to a server without a rewrite. It depends on no DOM, no transport and no
 * model. Tool access arrives through the `ToolRunner` port, and any model
 * assistance arrives through the optional `Planner` port. Both are interfaces,
 * so the machine is fully testable with fakes.
 *
 * Everything that decides whether a human must approve something is
 * deterministic and lives in @dusky/policy. The planner may only PROPOSE.
 */

import type { AuditEntry, Choice, DisplayFrame, ToolDescriptor } from "@dusky/contracts";
import {
  busyFrame,
  candidatesFromResult,
  confirmFrame,
  errorFrame,
  factsFromResult,
  idleFrame,
  isOperable,
  label,
  nextMissingParam,
  outcomeFromResult,
  parameters,
  paramFrame,
  resultFrame,
  workingFrame,
} from "@dusky/frames";
import { gate, isConfirmationFresh } from "@dusky/policy";

/* ------------------------------------------------------------------ ports */

/** How the machine reaches WebMCP. Implemented in-browser by @dusky/webmcp. */
export interface ToolRunner {
  discover(): Promise<ToolDescriptor[]>;
  invoke(
    origin: string,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string>;
}

/**
 * Optional model assistance. The machine works without it, degrading to
 * explicit menu navigation, which is why a model outage cannot strand a wearer.
 */
export interface Planner {
  /** Choose a tool for a spoken request. Returns null when genuinely unsure. */
  pickTool(
    intent: string,
    tools: ToolDescriptor[],
  ): Promise<{ name: string; args: Record<string, unknown> } | null>;
  /**
   * Propose a read-only tool whose output would supply a missing parameter,
   * plus the arguments to call it with. Must only ever name a read-only tool.
   */
  planResolver(
    missingParam: string,
    target: ToolDescriptor,
    readOnlyTools: ToolDescriptor[],
    intent: string,
  ): Promise<{ name: string; args: Record<string, unknown> } | null>;
}

export interface SessionOptions {
  source: string;
  runner: ToolRunner;
  planner?: Planner;
  /** We enforce our own deadline because WebMCP cancellation is unreliable. */
  invokeTimeoutMs?: number;
  now?: () => number;
  onAudit?: (e: Omit<AuditEntry, "at" | "sessionId">) => void;
  /**
   * Fired for EVERY frame the wearer should see, as it happens.
   *
   * Without this a transport can only read the frame a call settles on, so
   * every intermediate state is invisible: a wearer stares at an unchanged
   * screen for the whole of a model call and a tool invocation, which on a
   * cursorless display is indistinguishable from a crash.
   */
  onTransition?: (frame: DisplayFrame) => void;
}

/* ------------------------------------------------------------------ state */

interface Pending {
  tool: ToolDescriptor;
  args: Record<string, unknown>;
  /** Candidates offered for the parameter currently on screen. */
  awaiting?: string;
  /** When the confirmation frame was shown, for staleness checks. */
  confirmShownAt?: number;
  /** Human-readable target for the confirmation frame. */
  targetLabel?: string;
  consequence?: string;
}

/**
 * A single wearer's task, as a state machine.
 *
 * `handle(choiceId)` is the only mutating entry point besides `start`, which
 * keeps the transition surface small enough to test exhaustively.
 */
export class Session {
  private tools: ToolDescriptor[] = [];
  private toolsChangedAt = 0;
  private pending: Pending | null = null;
  private page = 0;
  private intent = "";
  private frame: DisplayFrame;

  constructor(private readonly o: SessionOptions) {
    this.frame = idleFrame(o.source, []);
  }

  private now(): number {
    return this.o.now ? this.o.now() : Date.now();
  }

  private audit(e: Omit<AuditEntry, "at" | "sessionId">): void {
    this.o.onAudit?.(e);
  }

  current(): DisplayFrame {
    return this.frame;
  }

  /**
   * The only place `frame` is assigned.
   *
   * Routing every change through here is what makes intermediate states
   * observable rather than merely computed, and it is why a transport does
   * not have to guess when to repaint.
   */
  private show(f: DisplayFrame): DisplayFrame {
    this.frame = f;
    this.o.onTransition?.(f);
    return f;
  }

  private byName(name: string): ToolDescriptor | undefined {
    return this.tools.find((t) => t.name === name);
  }

  private readOnly(): ToolDescriptor[] {
    return this.tools.filter((t) => gate(t).consequence === "read");
  }

  /** Discover tools and show the menu. Safe to call again on toolschange. */
  async start(): Promise<DisplayFrame> {
    try {
      this.tools = await this.o.runner.discover();
      this.toolsChangedAt = this.now();
      this.audit({ kind: "discover", detail: { count: this.tools.length } });
      this.page = 0;
      this.show(idleFrame(this.o.source, this.tools, 0));
    } catch (err) {
      this.show(errorFrame(this.o.source, "Cannot reach this source", msg(err), true));
    }
    return this.frame;
  }

  /** A spoken or typed request. Falls back to the menu when no planner exists. */
  async submitIntent(text: string): Promise<DisplayFrame> {
    this.intent = text;
    if (!this.o.planner) return this.frame;

    // The wearer caused this wait, so they have to see it. The title echoes
    // what Dusky heard, because a misheard request is the thing they most
    // need to catch before it turns into an action.
    this.show(busyFrame(this.o.source, text, "Finding the right action"));

    // A planner is assistance, never a dependency. Anything it does wrong,
    // including throwing, has to land the wearer on the menu they can already
    // drive rather than anywhere they cannot get out of.
    let pick: { name: string; args: Record<string, unknown> } | null = null;
    try {
      pick = await this.o.planner.pickTool(text, this.tools.filter(isOperable));
    } catch (err) {
      this.audit({ kind: "plan", detail: { path: "pickTool", failed: msg(err) } });
    }

    // A planner that is unsure must produce a question, never a guess.
    if (!pick) return this.show(idleFrame(this.o.source, this.tools, 0));

    const tool = this.byName(pick.name);
    if (!tool) {
      // Named something this session never discovered. Recorded, then ignored.
      this.audit({
        kind: "plan",
        toolName: pick.name,
        detail: { path: "pickTool", accepted: false, reason: "not a discovered tool" },
      });
      return this.show(idleFrame(this.o.source, this.tools, 0));
    }

    const args = declaredArgs(tool, pick.args ?? {});
    this.audit({
      kind: "plan",
      toolName: tool.name,
      origin: tool.origin,
      detail: { path: "pickTool", accepted: true, args },
    });
    return this.beginTool(tool, args);
  }

  /** The single entry point for a gesture selection. */
  async handle(choiceId: string): Promise<DisplayFrame> {
    if (choiceId === "__more") {
      this.page += 1;
      return this.repaint();
    }
    if (choiceId === "__home" || choiceId === "__cancel") {
      if (choiceId === "__cancel")
        this.audit({ kind: "cancel", toolName: this.pending?.tool.name });
      this.pending = null;
      this.page = 0;
      return this.show(idleFrame(this.o.source, this.tools, 0));
    }
    if (choiceId === "__retry") {
      if (!this.pending) return this.frame;
      return this.execute();
    }
    if (choiceId === "__confirm") return this.onConfirm();

    // Selecting a value for the parameter currently on screen.
    if (this.pending?.awaiting) {
      this.pending.args[this.pending.awaiting] = coerce(choiceId);
      this.pending.awaiting = undefined;
      this.page = 0;
      return this.advance();
    }

    // Otherwise this is a tool chosen from the menu.
    const tool = this.byName(choiceId);
    if (tool) return this.beginTool(tool, {});
    return this.frame;
  }

  /** Free text committed by the on-glasses composer. */
  async submitText(value: string): Promise<DisplayFrame> {
    if (this.pending?.awaiting) {
      this.pending.args[this.pending.awaiting] = value;
      this.pending.awaiting = undefined;
      return this.advance();
    }
    return this.submitIntent(value);
  }

  private repaint(): DisplayFrame {
    if (this.pending?.awaiting) return this.frame;
    return this.show(idleFrame(this.o.source, this.tools, this.page));
  }

  private async beginTool(
    tool: ToolDescriptor,
    args: Record<string, unknown>,
  ): Promise<DisplayFrame> {
    this.pending = { tool, args: { ...args } };
    this.page = 0;
    return this.advance();
  }

  /** Collect the next missing parameter, or move to the gate. */
  private async advance(): Promise<DisplayFrame> {
    const p = this.pending;
    if (!p) return this.frame;

    const missing = nextMissingParam(p.tool, p.args);
    if (missing) {
      p.awaiting = missing.name;
      let candidates: Choice[] = [];

      // A bare string is where a prior read-only tool earns its keep: rather
      // than asking the wearer to spell a product id, run something that
      // produces them and offer the results as choices.
      if (missing.kind === "text" && this.o.planner) {
        this.show(busyFrame(this.o.source, label(p.tool), "Looking up your options"));
        let plan: { name: string; args: Record<string, unknown> } | null = null;
        try {
          plan = await this.o.planner.planResolver(
            missing.name,
            p.tool,
            this.readOnly(),
            this.intent,
          );
        } catch (err) {
          this.audit({ kind: "plan", detail: { path: "planResolver", failed: msg(err) } });
        }

        if (plan) {
          const resolver = this.byName(plan.name);
          // Enforced in code: a resolver must be read-only. A planner that
          // names a consequential tool is ignored, not trusted. This is the
          // one path where a proposal runs with no human in front of it, so
          // the refusal is recorded rather than merely happening.
          const allowed = resolver !== undefined && gate(resolver).consequence === "read";
          if (!allowed) {
            this.audit({
              kind: "plan",
              toolName: plan.name,
              origin: resolver?.origin,
              detail: {
                path: "planResolver",
                accepted: false,
                reason: resolver ? "not read-only" : "not a discovered tool",
              },
            });
          } else if (resolver) {
            const args = declaredArgs(resolver, plan.args ?? {});
            this.audit({
              kind: "plan",
              toolName: resolver.name,
              origin: resolver.origin,
              detail: { path: "planResolver", accepted: true, args },
            });
            try {
              const raw = await this.o.runner.invoke(resolver.origin, resolver.name, args);
              this.audit({ kind: "invoke", toolName: resolver.name, origin: resolver.origin });
              candidates = candidatesFromResult(raw);
            } catch {
              candidates = [];
            }
          }
        }
      }

      return this.show(paramFrame(this.o.source, p.tool, missing, candidates, this.page));
    }

    // Ready to run. Ask a human first unless this is a read.
    const g = gate(p.tool);
    if (g.requiresConfirmation) {
      p.confirmShownAt = this.now();
      p.targetLabel = describeArgs(p.args) || label(p.tool);
      this.audit({
        kind: "gate",
        toolName: p.tool.name,
        origin: p.tool.origin,
        detail: { consequence: g.consequence, reason: g.reason },
      });
      return this.show(confirmFrame(this.o.source, p.tool, p.targetLabel, p.consequence));
    }
    return this.execute();
  }

  private async onConfirm(): Promise<DisplayFrame> {
    const p = this.pending;
    if (!p?.confirmShownAt) return this.frame;
    // A confirmation is only valid for the tool set the wearer actually saw.
    if (!isConfirmationFresh(p.confirmShownAt, this.toolsChangedAt, this.now())) {
      this.audit({
        kind: "error",
        toolName: p.tool.name,
        detail: { reason: "stale confirmation" },
      });
      this.pending = null;
      return this.show(
        errorFrame(
          this.o.source,
          "This changed while you were deciding",
          "Choose again so you approve what will actually run.",
          false,
        ),
      );
    }
    return this.execute();
  }

  private async execute(): Promise<DisplayFrame> {
    const p = this.pending;
    if (!p) return this.frame;
    this.show(workingFrame(this.o.source, p.tool));

    const ctrl = new AbortController();
    const budget = this.o.invokeTimeoutMs ?? 15_000;
    const retryable = gate(p.tool).consequence === "read";

    // We must RACE rather than merely abort. WebMCP's AbortSignal is not
    // honored today (WPT executeTool-abort 0/5), so a site that ignores the
    // signal would otherwise strand the wearer on a working frame forever.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<{ timedOut: true }>((resolve) => {
      timer = setTimeout(() => {
        ctrl.abort();
        resolve({ timedOut: true });
      }, budget);
    });

    try {
      const outcome = await Promise.race([
        this.o.runner
          .invoke(p.tool.origin, p.tool.name, p.args, ctrl.signal)
          .then((raw) => ({ timedOut: false as const, raw })),
        deadline,
      ]);

      if (outcome.timedOut) {
        this.audit({ kind: "error", toolName: p.tool.name, detail: { reason: "timeout" } });
        // The deadline does not stop the tool, so this is "unknown", never
        // "did not happen". Retrying a write here could double-charge.
        this.show(
          errorFrame(
            this.o.source,
            "No answer yet",
            "The site did not respond in time. It may still have run.",
            retryable,
          ),
        );
      } else {
        // Success is asserted from the returned RESULT, never from the fact
        // that a call came back. A site answering {"ok": false} has returned a
        // result, and that result is a failure.
        const said = outcomeFromResult(outcome.raw);
        this.audit({
          kind: "result",
          toolName: p.tool.name,
          origin: p.tool.origin,
          detail: { ok: said.ok },
        });
        this.show(
          resultFrame(this.o.source, `${label(p.tool)} ${said.ok ? "done" : "did not work"}`, {
            ok: said.ok,
            detail: said.message ?? summarize(outcome.raw),
            facts: factsFromResult(outcome.raw),
          }),
        );
        this.pending = null;
      }
    } catch (err) {
      this.audit({ kind: "error", toolName: p.tool.name, detail: { message: msg(err) } });
      this.show(errorFrame(this.o.source, `${label(p.tool)} failed`, msg(err), retryable));
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    return this.frame;
  }
}

/* --------------------------------------------------------------- helpers */

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function coerce(v: string): unknown {
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

/**
 * Keep only the arguments the tool itself declared.
 *
 * `Planner` is a port, so the machine cannot assume a careful implementation
 * on the other side of it. An invented `force` or `confirm` riding along into
 * a real invocation would bypass the gate without anyone touching the gate,
 * which is precisely the class of thing this file exists to make impossible.
 */
function declaredArgs(
  tool: ToolDescriptor,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const declared = new Set(parameters(tool).map((p) => p.name));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) if (declared.has(k)) out[k] = v;
  return out;
}

/** A short, honest description of what is about to happen. */
function describeArgs(args: Record<string, unknown>): string {
  const vals = Object.values(args).filter((v) => typeof v === "string" || typeof v === "number");
  return vals.length ? vals.map(String).join(", ") : "";
}

/**
 * The last-resort one-liner, for a result no generic reader could structure.
 *
 * This used to sniff for `added`, `cart_total` and `removed`, which are the
 * exact keys the first-party test market returns. That was a per-site branch
 * wearing a helper's clothes: every other site in the world fell through to
 * truncated JSON. Structure now comes from `factsFromResult`, which knows no
 * site, and this only runs when even that finds nothing to show.
 */
function summarize(raw: string): string {
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
}
