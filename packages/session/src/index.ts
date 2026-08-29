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
  siteFromChoice,
  textFromResult,
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
   * Choose every explicit action in one spoken request, in order.
   *
   * Optional so another Planner implementation can remain single-step. The
   * session uses `pickTool` as its safe fallback when this is absent.
   */
  pickTools?(
    intent: string,
    tools: ToolDescriptor[],
  ): Promise<{ name: string; args: Record<string, unknown> }[] | null>;
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
  /**
   * What the eyebrow says when no single site is in play.
   *
   * A menu spanning several businesses is about none of them, so it carries
   * the product's own name rather than picking one of them to print. When
   * exactly one site has offered tools the menu names THAT site instead, which
   * is what a single-source deployment has always shown.
   */
  source: string;
  /**
   * The name a wearer reads for the site that registered a tool.
   *
   * Every frame that is about one pending tool names that tool's site, because
   * the frame where it matters most is the confirmation and the eyebrow is the
   * only place it appears. Supplied by the transport, since the console is the
   * surface that actually has the sites loaded. Defaults to `source`, so a
   * session told about one place behaves exactly as it always did.
   */
  siteName?: (origin: string) => string;
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

/** Shown on the menu when a spoken request did not turn into anything. */
const UNHEARD = "Could not tell what that meant. Choose an action";

/**
 * A lookup that saves typing must not cost more than the typing would.
 *
 * This bounds the WHOLE attempt, deciding included. It used to bound only the
 * invocation, which left the expensive half unbounded: choosing `search_products`
 * on the deployed stack spent 1138ms on a fast model and 3696ms on a careful
 * one, both correctly abstaining, before the wearer was shown the composer
 * they were always going to get. Nearly five seconds, outside the budget whose
 * comment forbids exactly that, on the most common action in the product.
 */
const RESOLVER_BUDGET_MS = 6_000;

/**
 * How much of that a planner may spend DECIDING what to look up.
 *
 * Deliberately much less than half. The two costs are not worth the same: time
 * spent deciding buys nothing on its own, while time spent invoking is what
 * actually produces the choices. A budget split evenly between them can be
 * fully consumed and still leave the wearer with an empty list.
 *
 * It is also the cheaper thing to give up on. If a planner cannot say what to
 * look up within this, asking the wearer is a better answer than making them
 * watch, because the composer was always the fallback and every extra second
 * of shimmer is a second they could have been writing.
 *
 * `search_products` is the case that sets the number. Its parameter is a
 * search query, so no upstream tool can ever supply one, and no amount of
 * model time changes that. The first tier reached that answer in 1138ms.
 */
const RESOLVER_PLAN_BUDGET_MS = 2_500;

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

interface PlannedStep {
  origin: string;
  name: string;
  args: Record<string, unknown>;
}

/** Independently enforced here, regardless of what a Planner promises. */
const MAX_TASK_STEPS = 4;

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
  /**
   * The one site the wearer has stepped into, when the menu is grouped.
   *
   * Null at the top of the menu, which is either every action at once or a row
   * per site depending on whether they fit. Navigation only: it narrows what a
   * MENU draws and nothing else. The planner still ranks every site's tools
   * together, `actions()` still reports them together, and a spoken request
   * still crosses two businesses, because the registry was never partitioned.
   */
  private site: string | null = null;
  private intent = "";
  /** Steps after the one currently on screen. */
  private queued: PlannedStep[] = [];
  private taskStep = 0;
  private taskTotal = 0;
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

  /** Visible to the relay so another agent cannot interrupt between steps. */
  taskProgress(): { current: number; total: number; remaining: number } | null {
    if (this.taskTotal <= 1 || this.taskStep <= 0) return null;
    return { current: this.taskStep, total: this.taskTotal, remaining: this.queued.length };
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

  /**
   * The tools that may look something up on behalf of a target.
   *
   * Read-only, and SAME-ORIGIN AS THE TARGET. Both halves are enforced here and
   * again in `packages/planner`, because a `Planner` is a port: another
   * implementation reaches this machine without ever passing through that
   * package, so a rule that lives only there is a rule a different planner does
   * not have.
   *
   * The origin half is new, and it is new because it had nothing to forbid
   * until now. A session held one site, so every read-only tool was already
   * same-origin with every target and the constraint was invisible. Holding
   * every site at once makes it the difference between a lookup and a leak: the
   * wearer's spoken words are what fill a resolver's arguments, and this is the
   * one path that runs with nobody watching, so an unconstrained version would
   * quietly hand what somebody said to a business their request never mentioned.
   *
   * Refusing costs a lookup and buys a question. The wearer is asked for the
   * value instead, which is the menu-driven path the product already has.
   */
  private resolversFor(target: ToolDescriptor): ToolDescriptor[] {
    return this.tools.filter(
      (t) => t.origin === target.origin && gate(t).consequence === "read" && t.name !== target.name,
    );
  }

  /**
   * The name a wearer reads for whoever registered a tool.
   *
   * Cosmetic, and deliberately so. The unspoofable fact about where a tool came
   * from is its origin, which the browser supplies and which every audit entry
   * carries. This is the version of that fact a person can read at a glance on
   * a waveguide.
   */
  private siteOf(origin: string): string {
    return this.o.siteName?.(origin) ?? this.o.source;
  }

  /**
   * The eyebrow over a frame that is not about one particular tool.
   *
   * Derived from what actually arrived rather than from what the session was
   * told to expect. Holding one site, a menu is entirely that site's and says
   * so, which is what every single-source deployment has always shown. Holding
   * several, it belongs to none of them and carries the product's own name:
   * picking one of the businesses to print above a list containing another
   * one's actions would be the same lie as a server-global label.
   *
   * It follows the tools, so a session whose second site never loads honestly
   * names the one that did rather than claiming a breadth it does not have.
   */
  private menuSource(): string {
    // Stepped into a site: the menu is entirely that site's and says so.
    if (this.site) return this.siteOf(this.site);
    const origins = new Set(this.tools.map((t) => t.origin));
    if (origins.size !== 1) return this.o.source;
    const [only] = [...origins];
    return this.siteOf(only as string);
  }

  /**
   * The menu, wherever the wearer currently is in it.
   *
   * One place builds it, because the alternative is nine call sites that have
   * to remember to pass the site filter and the name lookup, and the one that
   * forgets shows a wearer somebody else's actions under this site's name.
   */
  private menu(note?: string): DisplayFrame {
    // A site whose tools have all gone is not a place to stand. Discovery can
    // empty one while the wearer is looking at it, and a submenu of nothing
    // with no way out but Escape is worse than being returned to the top.
    if (this.site && !this.tools.some((t) => t.origin === this.site)) this.site = null;
    return idleFrame(this.menuSource(), this.tools, this.page, this.canSpeak(), note, {
      ...(this.site ? { site: this.site } : {}),
      siteName: (origin) => this.siteOf(origin),
    });
  }

  /** Discover tools and show the menu. Called when a console attaches. */
  async start(): Promise<DisplayFrame> {
    try {
      await this.discover();
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
      this.show(this.menu());
    } catch (err) {
      this.show(errorFrame(this.menuSource(), "Cannot reach this source", msg(err), true));
    }
    return this.frame;
  }

  /**
   * A site added or removed tools. Take the new registry; disturb nobody.
   *
   * `start()` was doing this job and it is the wrong shape for it, because
   * start RESTARTS: it clears the parameter being collected and repaints the
   * menu over whatever was on the lens. That was invisible while a console
   * held one site, since a site registers its tools once, in a burst the
   * console coalesces, before anybody has chosen anything.
   *
   * Holding several sites breaks every part of that. Each site registers on
   * its own schedule, the console's debounce merges a burst but cannot merge
   * bursts seconds apart, so N sites produce N of these. And any one of them
   * can now arrive AFTER the wearer has started something: a site finishing
   * its registration while somebody is halfway through choosing a table would
   * have thrown their answer away and put them back on the menu, with no
   * explanation and nothing they did to cause it.
   *
   * So a refresh repaints only when the wearer is looking at a menu, which is
   * where new actions want to appear and where nothing is lost by redrawing.
   * Mid-task the registry updates underneath and the screen holds still.
   *
   * Nothing is given up by not restarting. `toolsChangedAt` still moves, and
   * `isConfirmationFresh` still refuses a confirmation shown before the tools
   * changed, so the case where a site swaps what is about to be approved is
   * covered by the check that was written for exactly it, rather than by a
   * blunt repaint that also catches everybody else.
   */
  async refresh(): Promise<DisplayFrame> {
    try {
      await this.discover();
    } catch (err) {
      // A failed re-discovery is not news the wearer can act on, and replacing
      // a live frame with an error because a background refresh failed would
      // be the interruption this method exists to avoid. `start` still reports
      // a failure, because there the wearer is waiting for the answer.
      this.audit({ kind: "error", detail: { reason: "refresh failed", message: msg(err) } });
      return this.frame;
    }
    if (this.frame.kind === "idle") this.show(this.menu());
    return this.frame;
  }

  private async discover(): Promise<void> {
    this.tools = await this.o.runner.discover();
    this.toolsChangedAt = this.now();
    this.audit({
      kind: "discover",
      detail: {
        count: this.tools.length,
        sites: new Set(this.tools.map((t) => t.origin)).size,
      },
    });
  }

  /** A spoken or typed request. Falls back to the menu when no planner exists. */
  async submitIntent(text: string): Promise<DisplayFrame> {
    if (!this.o.planner) return this.frame;

    // The wearer caused this wait, so they have to see it. The title echoes
    // what Dusky heard, because a misheard request is the thing they most
    // need to catch before it turns into an action.
    this.show(busyFrame(this.menuSource(), text, "Finding the right action"));

    // A planner is assistance, never a dependency. Anything it does wrong,
    // including throwing, has to land the wearer on the menu they can already
    // drive rather than anywhere they cannot get out of.
    let picks: { name: string; args: Record<string, unknown> }[] | null = null;
    const path = this.o.planner.pickTools ? "pickTools" : "pickTool";
    try {
      if (this.o.planner.pickTools) {
        picks = await this.o.planner.pickTools(text, this.tools.filter(isOperable));
      } else {
        const pick = await this.o.planner.pickTool(text, this.tools.filter(isOperable));
        picks = pick ? [pick] : null;
      }
    } catch (err) {
      this.audit({ kind: "plan", detail: { path, failed: msg(err) } });
    }

    // Every way of failing to help says the same thing, deliberately. The
    // wearer cannot act on the difference between "the model was unsure",
    // "it named something that is not here" and "it could not be reached",
    // and the last two would be telling them about our plumbing.

    // A planner that is unsure must produce a question, never a guess.
    if (!picks || picks.length === 0) return this.show(this.menu(UNHEARD));
    if (picks.length > MAX_TASK_STEPS) {
      this.audit({
        kind: "plan",
        detail: { path, accepted: false, reason: "too many steps", count: picks.length },
      });
      return this.show(this.menu(UNHEARD));
    }

    const planned: { tool: ToolDescriptor; args: Record<string, unknown> }[] = [];
    for (const pick of picks) {
      const tool = this.byName(pick.name);
      if (!tool) {
        // All or nothing. Running the valid half would silently discard the
        // invalid half, which is the exact behavior multi-step fixes.
        this.audit({
          kind: "plan",
          toolName: pick.name,
          detail: { path, accepted: false, reason: "not a discovered tool" },
        });
        return this.show(this.menu(UNHEARD));
      }
      planned.push({ tool, args: declaredArgs(tool, pick.args ?? {}) });
    }

    for (const [index, step] of planned.entries()) {
      this.audit({
        kind: "plan",
        toolName: step.tool.name,
        origin: step.tool.origin,
        detail: {
          path,
          accepted: true,
          args: step.args,
          step: index + 1,
          total: planned.length,
        },
      });
    }

    const first = planned[0];
    if (!first) return this.show(this.menu(UNHEARD));
    this.intent = text;
    this.taskStep = 1;
    this.taskTotal = planned.length;
    this.queued = planned.slice(1).map((step) => ({
      origin: step.tool.origin,
      name: step.tool.name,
      args: step.args,
    }));
    return this.startStep(first.tool, first.args);
  }

  /** The single entry point for a gesture selection. */
  async handle(choiceId: string): Promise<DisplayFrame> {
    if (choiceId === "__more") {
      this.page += 1;
      return this.repaint();
    }
    if (choiceId === "__home" || choiceId === "__cancel") {
      // Leaving a WORKING frame is not the same act as leaving a menu. The
      // call is already with the site and nothing here can recall it, so
      // showing the menu implied it had been stopped. This is the same
      // "unknown, never did not happen" the timeout path already observes.
      //
      // Only on the way out of the working frame, so pressing Back on the
      // notice itself reaches the menu rather than the notice again.
      const inFlight = this.frame.kind === "working" ? this.executing : null;

      if (choiceId === "__cancel") {
        this.audit({
          kind: "cancel",
          toolName: this.pending?.tool.name,
          ...(inFlight ? { detail: { inFlight: true } } : {}),
        });
      }
      /*
       * Back steps out one level, not all the way home.
       *
       * With a grouped menu there are two places "back" can mean, and taking a
       * wearer to the top from inside a task would throw away the site they
       * chose along with the task they abandoned. Leaving something PENDING
       * returns them to that site's own actions, which is where they were
       * standing. Pressing Back again, with nothing pending, leaves the site.
       *
       * A wearer who is not in a site is already at the top and stays there,
       * which is what this has always done.
       */
      const wasPending = this.pending !== null;
      this.pending = null;
      this.page = 0;
      this.clearTask();

      if (inFlight) {
        return this.show(
          errorFrame(
            this.siteOf(inFlight.tool.origin),
            "Already sent",
            `${label(inFlight.tool)} was sent before you went back. It may still finish.`,
            false,
          ),
        );
      }
      if (!wasPending) this.site = null;
      return this.show(this.menu());
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
    if (choiceId === "__next") return this.startNextStep();

    /*
     * The composer's own rows are not values.
     *
     * Both fall through to the parameter branch below otherwise, which coerces
     * whatever id arrives into the answer: pressing "Done" on an empty field
     * set the parameter to the literal string "__submit" and walked on to the
     * gate with it. `__compose` had the same hole and had simply never been
     * reachable on a frame with something pending.
     *
     * Ignoring them is right rather than merely safe. "Done" exists so focus
     * can leave the input, and leaving the input is what commits the text, so
     * by the time this id arrives the real answer has already been sent by
     * `submitText` and this frame is gone. When the field was empty there is
     * nothing to send and the wearer should stay where they are.
     */
    if (choiceId === "__compose" || choiceId === "__submit") return this.frame;

    /*
     * Stepping into one site's actions.
     *
     * Checked HERE, above the parameter branch, for the reason `__compose` and
     * `__submit` are: that branch coerces whatever id arrives into the answer,
     * and a reserved id becoming a parameter value is a mistake this file has
     * already made once. `product_id` was set to the literal string
     * `"__submit"` and walked on to a confirmation with it.
     *
     * Navigation, and nothing more. It narrows what the MENU draws; it does not
     * narrow what the planner may rank, what an agent may be told about, or
     * what a spoken request may cross.
     */
    const stepInto = siteFromChoice(choiceId);
    if (stepInto !== null) {
      // Only into a site that is actually offering something, so a stale frame
      // cannot strand the wearer on an empty screen.
      if (!this.tools.some((t) => t.origin === stepInto)) return this.frame;
      this.site = stepInto;
      this.page = 0;
      return this.show(this.menu());
    }

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
      return this.show(
        paramFrame(this.siteOf(p.tool.origin), p.tool, missing, p.candidates ?? [], this.page),
      );
    }
    return this.show(this.menu());
  }

  private async beginTool(
    tool: ToolDescriptor,
    args: Record<string, unknown>,
  ): Promise<DisplayFrame> {
    // A menu choice is a new task. Keeping a previous spoken intent here would
    // hand old words to a resolver for a later, unrelated action.
    this.clearTask();
    return this.startStep(tool, args);
  }

  private async startStep(
    tool: ToolDescriptor,
    args: Record<string, unknown>,
  ): Promise<DisplayFrame> {
    this.pending = { tool, args: { ...args } };
    this.page = 0;
    return this.advance();
  }

  private clearTask(): void {
    this.intent = "";
    this.queued = [];
    this.taskStep = 0;
    this.taskTotal = 0;
  }

  /** Move from a completed step to the next independently gated action. */
  private async startNextStep(): Promise<DisplayFrame> {
    if (this.pending) return this.frame;
    const planned = this.queued.shift();
    if (!planned) return this.frame;

    // Resolve against what the browser offers NOW. A queued ToolDescriptor is
    // not authority to invoke a version that disappeared or changed while the
    // wearer was completing the previous step.
    const tool = this.tools.find(
      (candidate) =>
        candidate.origin === planned.origin &&
        candidate.name === planned.name &&
        isOperable(candidate),
    );
    if (!tool) {
      const source = this.siteOf(planned.origin);
      this.clearTask();
      return this.show(
        errorFrame(
          source,
          "The next action changed",
          "Choose it again so Dusky uses what the site offers now.",
          false,
        ),
      );
    }

    this.taskStep += 1;
    const args = declaredArgs(tool, planned.args);
    this.audit({
      kind: "plan",
      toolName: tool.name,
      origin: tool.origin,
      detail: { path: "task", stage: "started", step: this.taskStep, total: this.taskTotal },
    });
    return this.startStep(tool, args);
  }

  /** Collect the next missing parameter, or move to the gate. */
  private async advance(): Promise<DisplayFrame> {
    const p = this.pending;
    if (!p) return this.frame;

    const missing = nextMissingParam(p.tool, p.args);
    if (missing) {
      p.awaiting = missing.name;
      let candidates: Choice[] = [];

      /*
       * A bare string is where a prior read-only tool earns its keep: rather
       * than asking the wearer to spell a product id, run something that
       * produces them and offer the results as choices.
       *
       * ONLY when the wearer actually said something. `this.intent` is set by
       * `submitIntent` and by nothing else, so it is empty for every tool
       * chosen off the menu, which is most of them.
       *
       * With no intent there is nothing to resolve FROM. The planner is being
       * asked which arguments a lookup needs on behalf of somebody who
       * requested nothing, so it can only invent them, and inventing arguments
       * is the one thing this planner is built not to do: it "never fills an
       * argument by lexical similarity, because a wrong argument is exactly
       * what a model is there to avoid". Nothing is a weaker basis than
       * lexical similarity.
       *
       * That is not theoretical. Choosing "Search catalog" off the menu spent
       * 1138ms on a fast model and 3696ms on a careful one, both correctly
       * abstaining, and choosing "Book table" got as far as calling
       * `find_times({})` after both proposed arguments were dropped for not
       * being declared enum members. Neither could have produced a candidate,
       * and the wearer waited on a working frame to find that out.
       *
       * A wearer who SPOKE is the case this path was written for, and there
       * the intent is exactly what makes the lookup answerable.
       */
      if (missing.kind === "text" && this.o.planner && this.intent.trim() !== "") {
        this.show(busyFrame(this.siteOf(p.tool.origin), label(p.tool), "Looking up your options"));
        // One clock for the whole attempt, started before the planner is
        // asked anything, because the wearer is already waiting by then.
        const resolverStartedAt = this.now();
        let plan: { name: string; args: Record<string, unknown> } | null = null;
        try {
          const decided = await Session.within(
            this.o.planner.planResolver(
              missing.name,
              p.tool,
              this.resolversFor(p.tool),
              this.intent,
            ),
            RESOLVER_PLAN_BUDGET_MS,
          );
          if (decided.timedOut) {
            // Recorded rather than silent. A wearer sent to the composer
            // because a model was slow looks identical to one sent there
            // because no tool could have helped, and those want different
            // fixes.
            this.audit({
              kind: "plan",
              detail: {
                path: "planResolver",
                stage: "undecided",
                ms: this.now() - resolverStartedAt,
              },
            });
          } else {
            plan = decided.value;
          }
        } catch (err) {
          this.audit({ kind: "plan", detail: { path: "planResolver", failed: msg(err) } });
        }

        if (plan) {
          const resolver = this.byName(plan.name);
          /*
           * Enforced in code, twice: a resolver must be read-only AND from the
           * target's own origin. A planner that names anything else is ignored,
           * not trusted. This is the one path where a proposal runs with no
           * human in front of it, so every refusal is recorded rather than
           * merely happening.
           *
           * The origin check is not redundant with the filter above. That one
           * decides what a planner is OFFERED; this one decides what it is
           * allowed to have NAMED, and a model that answers with something it
           * was never shown is exactly the case both packages exist to refuse.
           * A cross-origin resolver would send the wearer's own words to a
           * business their request never mentioned.
           */
          const wrongOrigin = resolver !== undefined && resolver.origin !== p.tool.origin;
          const allowed =
            resolver !== undefined && !wrongOrigin && gate(resolver).consequence === "read";
          if (!allowed) {
            this.audit({
              kind: "plan",
              toolName: plan.name,
              origin: resolver?.origin,
              detail: {
                path: "planResolver",
                accepted: false,
                reason: !resolver
                  ? "not a discovered tool"
                  : wrongOrigin
                    ? "not same-origin as the target"
                    : "not read-only",
                ...(wrongOrigin ? { target: p.tool.origin } : {}),
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
            // What is LEFT of the attempt, not the whole budget over again.
            // Deciding and looking up used to get `RESOLVER_BUDGET_MS` each,
            // so the ceiling the constant names could be exceeded without
            // either half going over it.
            const left = RESOLVER_BUDGET_MS - (this.now() - resolverStartedAt);
            const budget = Math.min(this.o.invokeTimeoutMs ?? 15_000, left);
            if (budget <= 0) {
              // Nothing left to look up with. Say so and let them write.
              this.audit({
                kind: "error",
                toolName: resolver.name,
                origin: resolver.origin,
                detail: { reason: "no resolver budget left after planning" },
              });
              candidates = [];
            } else {
              try {
                const out = await this.invokeWithin(resolver.origin, resolver.name, args, budget);
                if (out.timedOut) {
                  this.audit({
                    kind: "error",
                    toolName: resolver.name,
                    origin: resolver.origin,
                    detail: { reason: "resolver timeout" },
                  });
                  candidates = [];
                } else {
                  this.audit({ kind: "invoke", toolName: resolver.name, origin: resolver.origin });
                  candidates = candidatesFromResult(out.raw);
                }
              } catch {
                candidates = [];
              }
            }
          }
        }
      }

      p.candidates = candidates;
      return this.show(
        paramFrame(this.siteOf(p.tool.origin), p.tool, missing, candidates, this.page),
      );
    }

    // Ready to run. Ask a human first unless this is a read.
    const g = gate(p.tool);
    if (g.requiresConfirmation) {
      p.confirmShownAt = this.now();
      /*
       * No fallback to the tool's own label.
       *
       * `confirmFrame` already sets the title from `label(tool)`, so falling
       * back here printed the same words twice: a wearer confirming
       * `empty_cart`, which takes no arguments, read "Empty cart" above
       * "Empty cart". A tool with nothing to name gets no target line.
       */
      const described = describeArgs(p.args);
      if (described) p.targetLabel = described;
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
      return this.show(
        confirmFrame(this.siteOf(p.tool.origin), p.tool, p.targetLabel, p.consequence),
      );
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
          this.siteOf(p.tool.origin),
          "This changed while you were deciding",
          "Choose again so you approve what will actually run.",
          false,
        ),
      );
    }
    return this.execute();
  }

  /**
   * Invoke with a deadline this machine controls.
   *
   * We must RACE rather than merely abort. WebMCP's AbortSignal is not honored
   * today (WPT executeTool-abort 0/5), so awaiting a site that ignores the
   * signal strands the caller forever. The signal is still passed, for the day
   * that changes.
   *
   * Shared, because the resolver path used to await `invoke` with no deadline
   * at all and fall through to the relay's 20s backstop, stacked on top of the
   * planner's own budget, on one frame. That path is also the one that runs
   * with no human in front of it.
   */
  private async invokeWithin(
    origin: string,
    name: string,
    args: Record<string, unknown>,
    budgetMs: number,
  ): Promise<{ timedOut: true } | { timedOut: false; raw: string }> {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<{ timedOut: true }>((resolve) => {
      timer = setTimeout(() => {
        ctrl.abort();
        resolve({ timedOut: true });
      }, budgetMs);
    });
    try {
      return await Promise.race([
        this.o.runner
          .invoke(origin, name, args, ctrl.signal)
          .then((raw) => ({ timedOut: false as const, raw })),
        deadline,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * Race any promise against a deadline.
   *
   * `invokeWithin` does this for tool calls and can abort them. This one
   * cannot cancel what it is racing, because a `Planner` is a port with no
   * signal in its contract, so a model call that loses the race goes on
   * running and its answer is dropped. That is the correct trade here: the
   * wearer's time is the scarce thing, and the alternative is holding a frame
   * for whatever a third party's model decides to spend.
   */
  private static async within<T>(
    work: Promise<T>,
    ms: number,
  ): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<{ timedOut: true }>((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), ms);
    });
    const settled = work.then((value) => ({ timedOut: false as const, value }));
    // A rejection arriving AFTER the deadline was already reported has nobody
    // left to catch it, and an unhandled rejection can take a process down.
    // This keeps that case handled without hiding one that arrives in time,
    // which `Promise.race` below still rejects on.
    settled.catch(() => {});
    try {
      return await Promise.race([settled, deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
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

    this.show(workingFrame(this.siteOf(p.tool.origin), p.tool));

    const budget = this.o.invokeTimeoutMs ?? 15_000;
    const retryable = gate(p.tool).consequence === "read";

    try {
      const outcome = await this.invokeWithin(p.tool.origin, p.tool.name, p.args, budget);

      // The wearer walked away while this was in flight. It still ran, and it
      // is still worth recording, but the screen belongs to whatever they are
      // doing now: showing this result would yank them out of it, and clearing
      // `pending` would destroy the task they started instead.
      const abandoned = this.pending !== p;

      if (outcome.timedOut) {
        this.audit({
          kind: "error",
          toolName: p.tool.name,
          detail: { reason: "timeout", ...(abandoned ? { abandoned: true } : {}) },
        });
        if (abandoned) return this.frame;
        // The deadline does not stop the tool, so this is "unknown", never
        // "did not happen". Retrying a write here could double-charge.
        this.show(
          errorFrame(
            this.siteOf(p.tool.origin),
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
          detail: { ok: said.ok, ...(abandoned ? { abandoned: true } : {}) },
        });
        if (abandoned) return this.frame;
        // Facts are what the panel renders when it has them; the detail line
        // is the fallback for when it does not. Computing both means the
        // fallback only has to be honest about the case it is actually for.
        const facts = factsFromResult(outcome.raw);
        this.pending = null;
        const next = said.ok ? this.queued[0] : undefined;
        const nextTool = next
          ? this.tools.find((t) => t.origin === next.origin && t.name === next.name)
          : undefined;
        if (!next) this.clearTask();
        this.show(
          resultFrame(
            this.siteOf(p.tool.origin),
            `${label(p.tool)} ${said.ok ? "done" : "did not work"}`,
            {
              ok: said.ok,
              detail: said.message ?? (facts.length > 0 ? undefined : summarize(outcome.raw)),
              facts,
              ...(next
                ? {
                    next: {
                      label: nextTool ? label(nextTool) : next.name,
                      index: this.taskStep + 1,
                      total: this.taskTotal,
                    },
                  }
                : {}),
            },
          ),
        );
      }
    } catch (err) {
      const abandoned = this.pending !== p;
      this.audit({
        kind: "error",
        toolName: p.tool.name,
        detail: { message: msg(err), ...(abandoned ? { abandoned: true } : {}) },
      });
      if (!abandoned) {
        this.show(
          errorFrame(this.siteOf(p.tool.origin), `${label(p.tool)} failed`, msg(err), retryable),
        );
      }
    } finally {
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
/**
 * The line under a result, when there were no facts to show instead.
 *
 * This used to flatten whatever the site returned and clip it at 80, so a
 * shape with no readable fields put braces and quotes on a waveguide. JSON is
 * not an answer to somebody wearing glasses, and it is not actionable even if
 * they can make it out.
 */
function summarize(raw: string): string {
  const said = textFromResult(raw);
  if (said === null) return "The site answered, but not in anything readable here.";
  return said.length > 80 ? `${said.slice(0, 77)}...` : said;
}
