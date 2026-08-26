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

import type {
  AgentAction,
  AuditEntry,
  Choice,
  DisplayFrame,
  ToolDescriptor,
} from "@dusky/contracts";
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
  type ParamSpec,
  parameters,
  paramFrame,
  resultFrame,
  toolId,
  valueForParam,
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
  /** The parameter currently on screen. */
  awaiting?: string;
  /**
   * The candidates offered for it. Kept because paging has to rebuild the
   * frame, and a resolver result is not something we can ask for twice: it
   * may have cost a model call, and re-invoking a site to redraw a screen the
   * wearer is already looking at is not a read we are entitled to repeat.
   */
  candidates?: Choice[];
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
  /**
   * The pending task currently being invoked, so one approval cannot run twice.
   *
   * Deliberately the Pending ITSELF rather than a boolean. A boolean locks the
   * whole session, and the wearer can walk away from an invocation: Escape
   * nulls `pending` and returns them to the menu while the call is still in
   * flight. Their next pick builds a NEW Pending, which is a different object,
   * so it runs. A boolean would have left them pressing a dead menu until the
   * abandoned call settled.
   */
  private executing: Pending | null = null;
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

  /**
   * What this source can currently do, as an agent OUTSIDE the glasses sees it.
   *
   * Every entry carries the ceremony @dusky/policy assigns, so an agent is
   * told up front which actions will stop for the wearer. That is honesty
   * rather than a courtesy: an agent that knows it cannot complete a purchase
   * alone asks the wearer properly instead of trying and being refused.
   */
  actions(): AgentAction[] {
    return this.tools.filter(isOperable).map((t) => {
      const g = gate(t);
      return {
        name: t.name,
        title: label(t),
        origin: t.origin,
        consequence: g.consequence,
        needsApproval: g.requiresConfirmation,
      };
    });
  }

  /**
   * Resolve a choice, or a planner's proposal, to exactly one tool.
   *
   * Two namespaces arrive here and they are not the same thing. A gesture
   * carries the qualified id the menu put on the row, which names an origin
   * and cannot be mistaken for anything else. A planner carries a bare NAME,
   * because a model is only ever shown names.
   *
   * A bare name is an identity only for as long as it is unique. When two
   * origins claim one, this refuses instead of picking, exactly as
   * `packages/planner` does, and independently of it: a guarantee that only
   * holds while two files agree is not a guarantee. Refusing is also the safe
   * direction, since the alternative was resolving by whatever order the
   * browser happened to return, which let a site hijack a familiar name by
   * registering it too.
   */
  private byName(name: string): ToolDescriptor | undefined {
    const exact = this.tools.find((t) => toolId(t) === name);
    if (exact) return exact;

    const matches = this.tools.filter((t) => t.name === name);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      this.audit({
        kind: "error",
        toolName: name,
        detail: { reason: "ambiguous tool name", origins: matches.map((t) => t.origin) },
      });
    }
    return undefined;
  }

  /**
   * Whether a spoken request can go anywhere. False without a planner, and the
   * menu must not offer the composer when it is.
   */
  private canSpeak(): boolean {
    return this.o.planner !== undefined;
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
      // The question that was on screen is not on screen any more, so stop
      // waiting for its answer. Without this the wearer sees the menu while
      // `awaiting` still points at a parameter, and their next tap is read as
      // the answer rather than as a tool: choosing "Search products" set
      // product_id to "search_products" and walked straight to a confirmation
      // for a purchase nobody asked for.
      //
      // `pending` itself survives on purpose. A confirmation shown before this
      // discovery must still be refused as stale rather than silently
      // forgotten, and that check reads `pending.confirmShownAt`.
      if (this.pending) {
        this.pending.awaiting = undefined;
        this.pending.candidates = undefined;
      }
      this.show(idleFrame(this.o.source, this.tools, 0, this.canSpeak()));
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
    if (!pick) return this.show(idleFrame(this.o.source, this.tools, 0, this.canSpeak()));

    const tool = this.byName(pick.name);
    if (!tool) {
      // Named something this session never discovered. Recorded, then ignored.
      this.audit({
        kind: "plan",
        toolName: pick.name,
        detail: { path: "pickTool", accepted: false, reason: "not a discovered tool" },
      });
      return this.show(idleFrame(this.o.source, this.tools, 0, this.canSpeak()));
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
      return this.show(idleFrame(this.o.source, this.tools, 0, this.canSpeak()));
    }
    if (choiceId === "__retry") {
      // The retry offered on a discovery failure has nothing pending behind
      // it, because nothing was ever chosen. It used to return the current
      // frame unchanged, which pushed nothing: the wearer pressed the only
      // control on screen, the panel did not move, and because no frame was
      // pushed the progress hairline kept sweeping. Re-run the thing that
      // actually failed.
      if (!this.pending) return this.start();

      // Rule 5: never auto-retry anything that is not read-only. A timeout is
      // "unknown", not "did not happen", so repeating a write can charge
      // twice. The error frame already declines to OFFER a retry for a write,
      // but the frame is not the guard. `onDisplayMessage` forwards whatever
      // choice id arrives on the display socket without checking it against
      // the frame it just sent, so anyone holding the six-character pairing
      // code could send `__retry` and run a purchase again. The rule has to
      // hold in the machine, not in the screen.
      if (gate(this.pending.tool).consequence !== "read") {
        this.audit({
          kind: "error",
          toolName: this.pending.tool.name,
          detail: { reason: "refused to retry a non-read tool" },
        });
        return this.frame;
      }
      return this.execute();
    }
    if (choiceId === "__confirm") return this.onConfirm();

    // Selecting a value for the parameter currently on screen.
    if (this.pending?.awaiting) {
      this.pending.args[this.pending.awaiting] = coerce(choiceId, this.awaitingParam());
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
      this.pending.args[this.pending.awaiting] = coerce(value, this.awaitingParam());
      this.pending.awaiting = undefined;
      return this.advance();
    }
    return this.submitIntent(value);
  }

  /** The declared spec for the parameter currently on screen, if there is one. */
  private awaitingParam(): ParamSpec | undefined {
    const p = this.pending;
    if (!p?.awaiting) return undefined;
    return parameters(p.tool).find((x) => x.name === p.awaiting);
  }

  /**
   * Turn the page on whatever is currently on screen.
   *
   * This used to return `this.frame` untouched whenever a parameter was being
   * collected, which made "More" a control that took the press and did
   * nothing: the page counter advanced, no frame was built, and nothing was
   * pushed. Every enum value past the first screenful was unreachable by any
   * gesture a wearer could make. Rebuilding the menu instead would have been
   * worse than doing nothing, because it would have silently abandoned the
   * tool the wearer was halfway through.
   */
  private repaint(): DisplayFrame {
    const p = this.pending;
    if (p?.awaiting) {
      const missing = this.awaitingParam();
      if (!missing) return this.frame;
      return this.show(paramFrame(this.o.source, p.tool, missing, p.candidates ?? [], this.page));
    }
    return this.show(idleFrame(this.o.source, this.tools, this.page, this.canSpeak()));
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

      p.candidates = candidates;
      return this.show(paramFrame(this.o.source, p.tool, missing, candidates, this.page));
    }

    // Ready to run. Ask a human first unless this is a read.
    const g = gate(p.tool);
    if (g.requiresConfirmation) {
      p.confirmShownAt = this.now();
      p.targetLabel = describeArgs(p.args) || label(p.tool);
      // Declared on Pending since the gate was written, and never once
      // assigned, so every confirm frame carried `undefined` and the panel's
      // severity line never rendered. The value was sitting in `g` throughout.
      p.consequence = g.consequence;
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

    // One approval is one execution.
    //
    // Every message from the glasses is handled in its own detached task, and
    // nothing on a cursorless display disables a choice once it has been
    // pressed, so a double tap on a confirm frame arrives as two independent
    // confirmations. Both used to pass the freshness check, because both saw
    // the same `confirmShownAt`, and `pending` is not cleared until the first
    // result comes back. That invoked a gated tool twice on one human yes,
    // which on a real merchant is a second charge.
    //
    // The lock lives here rather than in the transport because this is the
    // layer that owns the rule. A guarantee that holds only while the relay
    // remembers to filter stale frame ids is not a guarantee.
    if (this.executing === p) return this.frame;
    this.executing = p;

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
      // Released on every exit, including the timeout, because the error frame
      // for a read offers a retry and that retry has to be able to run. Only
      // reads are ever offered one, so releasing here cannot resurrect the
      // double-invocation this lock exists to stop. Guarded because a wearer
      // who cancelled and started something else must not have THEIR lock
      // cleared by the call they walked away from.
      if (this.executing === p) this.executing = null;
    }
    return this.frame;
  }
}

/* --------------------------------------------------------------- helpers */

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Turn a choice id or a composed string into the value the SITE declared.
 *
 * Everything arriving from the Display is text: a choice id, or whatever the
 * on-glasses composer committed. A site declaring `"type": "integer"` and
 * handed `"2"` has been given a value that violates its own schema, and a site
 * that validates its input would be right to refuse it. Only the declared
 * schema is consulted here, so this stays true of a site nobody has seen.
 *
 * An enum returns the declared member itself rather than a parsed copy, which
 * is how an integer enum survives the round trip with no type guessing at all.
 * Found by pointing Dusky at a second source: every parameter on the first one
 * was a bare string, so nothing here had ever been asked to preserve a type.
 */
function coerce(v: string, param?: ParamSpec): unknown {
  if (param?.kind === "enum") {
    const values = Array.isArray(param.schema["enum"]) ? (param.schema["enum"] as unknown[]) : [];
    const declared = values.find((x) => String(x) === v);
    if (declared !== undefined) return declared;
  }
  // A string parameter whose value happens to read "true" is a string. Only a
  // parameter the site declared as boolean, or one we cannot see a spec for,
  // gets the literal treatment.
  if (param === undefined || param.kind === "boolean") {
    if (v === "true") return true;
    if (v === "false") return false;
  }
  if (param?.kind === "number" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
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
/**
 * Reduce a proposal to what the site actually declared, by NAME and by VALUE.
 *
 * It used to filter names only, which made this check strictly weaker than the
 * one in `packages/planner` and left the difference reachable. A `Planner` is
 * a port: another implementation reaches here without passing through that
 * package at all. So `party_size: 9999` went to a site that declared
 * `enum: [1,2,3,4]`, and an object argument went with it, invisible on the
 * confirmation frame the wearer approved.
 *
 * `valueForParam` is the one implementation of that rule, shared with the
 * planner, so the two cannot drift apart.
 */
function declaredArgs(
  tool: ToolDescriptor,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const specs = new Map(parameters(tool).map((p) => [p.name, p]));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    const spec = specs.get(k);
    if (!spec) continue;
    const value = valueForParam(v, spec);
    if (value !== undefined) out[k] = value;
  }
  return out;
}

/** A short, honest description of what is about to happen. */
/**
 * What the wearer is shown they are approving.
 *
 * Every value, never a filtered subset. This used to keep only strings and
 * numbers, so anything else was sent but not displayed: the wearer approved a
 * call containing an argument the frame never mentioned. `declaredArgs` now
 * guarantees the values are displayable scalars, and rendering all of them
 * means a future change to that cannot quietly reintroduce a hidden argument.
 */
function describeArgs(args: Record<string, unknown>): string {
  return Object.values(args).map(String).join(", ");
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
