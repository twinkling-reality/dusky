import type { AgentRequest, ToolDescriptor } from "@dusky/contracts";
import { describe, expect, it } from "vitest";
import { SessionActor } from "./hub.js";

/**
 * Dusky's own WebMCP tools, tested where the rules actually live.
 *
 * The console that registers those tools is a transport. Every constraint that
 * matters is enforced here, in the actor that owns the task state, because a
 * rule enforced in the browser is a rule enforced in the layer an attacker is
 * already standing in.
 *
 * Note what these tests cannot even express: reaching a session other than the
 * actor's own. `AgentRequest` carries no session identifier, so targeting
 * somebody else's glasses is not a case that can be written, let alone pass.
 */

const TOOLS: ToolDescriptor[] = [
  {
    name: "search_products",
    title: "Search catalog",
    description: "Search the product catalog by free text.",
    origin: "https://shop.test",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
  },
  {
    name: "add_to_cart",
    title: "Add to cart",
    description: "Add a product to the shopping cart by product id.",
    origin: "https://shop.test",
    inputSchema: {
      type: "object",
      properties: { product_id: { type: "string", description: "Which product?" } },
      required: ["product_id"],
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
  },
];

/**
 * A second business, sharing no vocabulary with the first.
 *
 * Here rather than in a fixture file because only the label tests need it, and
 * because the point it makes is about the relay: two origins arriving through
 * one console is the case a single `source` string could not describe.
 */
const ELSEWHERE: ToolDescriptor[] = [
  {
    name: "book_table",
    description: "Reserve a table by slot id.",
    origin: "https://tables.test",
    inputSchema: {
      type: "object",
      properties: { slot_id: { type: "string", description: "Which slot?" } },
      required: ["slot_id"],
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
  },
];

/** Enough of a socket for the actor: it only checks readyState and sends. */
class FakeSocket {
  readyState = 1;
  readonly sent: string[] = [];
  /** How this socket was closed, so a test can tell a kick from a hang-up. */
  closedWith: { code?: number; reason?: string } | null = null;
  send(s: string) {
    this.sent.push(s);
  }
  close(code?: number, reason?: string) {
    this.readyState = 3;
    this.closedWith = { code, reason };
  }
}

type Sock = Parameters<SessionActor["attachDisplay"]>[0];

/**
 * An actor wired to a console that answers discover and invoke inline, so a
 * whole task can run without a relay, a browser or a network.
 */
function actor(
  opts: {
    planner?: boolean;
    tools?: ToolDescriptor[];
    taskSteps?: { name: string; args: Record<string, unknown> }[];
    planResolver?: (
      missing: string,
    ) => Promise<{ name: string; args: Record<string, unknown> } | null>;
    results?: Record<string, string>;
  } = {},
) {
  const invoked: string[] = [];
  const registry = opts.tools ?? TOOLS;
  const make =
    opts.planner || opts.taskSteps || opts.planResolver
      ? () => ({
          pickTool: async (_intent: string, tools: ToolDescriptor[]) => {
            const t = tools.find((x) => x.name === "add_to_cart");
            return t ? { name: t.name, args: { product_id: "oat-1" } } : null;
          },
          ...(opts.taskSteps ? { pickTools: async () => opts.taskSteps ?? null } : {}),
          planResolver: opts.planResolver ?? (async () => null),
        })
      : undefined;

  const a = new SessionActor("ABC123", "Dusky", make);
  const consoleSock = new FakeSocket();
  const raw = consoleSock.send.bind(consoleSock);
  consoleSock.send = (text: string) => {
    raw(text);
    const msg = JSON.parse(text) as { t: string; requestId?: string; toolName?: string };
    queueMicrotask(() => {
      if (msg.t === "discover" && msg.requestId) {
        void a.onConsoleMessage({ t: "tools", requestId: msg.requestId, tools: registry });
      } else if (msg.t === "invoke" && msg.requestId) {
        invoked.push(msg.toolName ?? "");
        void a.onConsoleMessage({
          t: "invoked",
          requestId: msg.requestId,
          ok: true,
          value:
            opts.results?.[msg.toolName ?? ""] ??
            JSON.stringify({ ok: true, added: "Organic oat milk" }),
        });
      }
    });
  };
  return { a, consoleSock, invoked };
}

async function paired(
  opts: {
    planner?: boolean;
    withDisplay?: boolean;
    tools?: ToolDescriptor[];
    taskSteps?: { name: string; args: Record<string, unknown> }[];
    planResolver?: (
      missing: string,
    ) => Promise<{ name: string; args: Record<string, unknown> } | null>;
    results?: Record<string, string>;
    sites?: { origin: string; name?: string }[];
  } = {},
) {
  const built = actor(opts);
  await built.a.attachConsole(
    built.consoleSock as unknown as Sock,
    opts.sites ?? [{ origin: "https://shop.test" }],
  );
  if (opts.withDisplay !== false) built.a.attachDisplay(new FakeSocket() as unknown as Sock);
  return built;
}

const ask = (a: SessionActor, request: AgentRequest) => a.onAgentRequest(request);

describe("what an outside agent can see", () => {
  it("reports the session, the display and what is on it", async () => {
    const { a } = await paired();
    const r = await ask(a, { op: "status" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.value).toMatchObject({
      session: "ABC123",
      // What is on the lens right now, not a label this process was started
      // with. One site is held and it named nothing, so its host is what the
      // wearer reads and therefore what an agent is told.
      source: "shop.test",
      sites: [{ origin: "https://shop.test", name: "shop.test" }],
      display_connected: true,
      state: "idle",
      accepting_tasks: true,
    });
  });

  it("lists actions with the ceremony code will enforce, not the site's claim", async () => {
    const { a } = await paired();
    const r = await ask(a, { op: "actions" });
    if (!r.ok) throw new Error("unreachable");
    expect(r.value["actions"]).toEqual([
      {
        name: "search_products",
        title: "Search catalog",
        origin: "https://shop.test",
        consequence: "read",
        needsApproval: false,
      },
      {
        name: "add_to_cart",
        title: "Add to cart",
        origin: "https://shop.test",
        consequence: "financial",
        needsApproval: true,
      },
    ]);
  });
});

describe("sending a task", () => {
  it("refuses when no glasses are connected, and says how to connect them", async () => {
    const { a } = await paired({ planner: true, withDisplay: false });
    const r = await ask(a, { op: "task", text: "add oat milk" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toContain("ABC123");
  });

  it("refuses when the relay cannot interpret a request at all", async () => {
    const { a } = await paired({ planner: false });
    const r = await ask(a, { op: "task", text: "add oat milk" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toContain("no planner");
  });

  /**
   * The constraint this whole design exists for.
   *
   * If an inbound task could replace a pending confirmation, an agent could
   * swap what is about to be approved while the wearer's attention is on the
   * old target and their gesture is already under way.
   */
  it("refuses to interrupt a pending confirmation", async () => {
    const { a, invoked } = await paired({ planner: true });

    await a.onDisplayMessage({ t: "choose", frameId: "1", choiceId: "add_to_cart" });
    await a.onDisplayMessage({ t: "text", frameId: "2", value: "oat-1" });

    const status = await ask(a, { op: "status" });
    if (!status.ok) throw new Error("unreachable");
    expect(status.value["state"]).toBe("confirm_required");
    expect(status.value["accepting_tasks"]).toBe(false);

    const r = await ask(a, { op: "task", text: "empty my cart instead" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toContain("approve an action");

    // The wearer is still looking at exactly what they were looking at, and
    // nothing ran while the agent was trying.
    expect(a.current().kind).toBe("confirm");
    expect(invoked).toEqual([]);
  });

  it("refuses to interrupt a wearer being asked for something", async () => {
    const { a } = await paired({ planner: false });
    await a.onDisplayMessage({ t: "choose", frameId: "1", choiceId: "add_to_cart" });
    expect(a.current().kind).toBe("choose");
    expect((await ask(a, { op: "task", text: "do something else" })).ok).toBe(false);
  });

  it("puts an accepted task on the glasses and still stops at the gate", async () => {
    const { a, invoked } = await paired({ planner: true });
    const r = await ask(a, { op: "task", text: "add the organic oat milk" });
    expect(r.ok).toBe(true);
    // An agent asked; the wearer has not answered, so nothing has run.
    expect(a.current().kind).toBe("confirm");
    expect(invoked).toEqual([]);
  });

  it("refuses another task while a cross-business task waits on its next step", async () => {
    const { a } = await paired({
      planner: true,
      tools: [...TOOLS, ...ELSEWHERE],
      taskSteps: [
        { name: "add_to_cart", args: { product_id: "oat-1" } },
        { name: "book_table", args: { slot_id: "ao-m-1930" } },
      ],
    });
    expect((await ask(a, { op: "task", text: "add oat milk and book a table" })).ok).toBe(true);
    await a.onDisplayMessage({ t: "choose", frameId: "2", choiceId: "__confirm" });

    const status = await ask(a, { op: "status" });
    if (!status.ok) throw new Error("unreachable");
    expect(status.value["accepting_tasks"]).toBe(false);
    expect(status.value["task"]).toEqual({ current: 1, total: 2, remaining: 1 });

    const next = await ask(a, { op: "task", text: "replace that with something else" });
    expect(next.ok).toBe(false);
  });

  it("refuses to interrupt a pending cross-origin transfer approval", async () => {
    const tables = "https://tables.test";
    const dispatch = "https://dispatch.test";
    const book: ToolDescriptor = {
      name: "book_table",
      description: "Hold a table.",
      origin: tables,
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
    };
    const find: ToolDescriptor = {
      name: "find_contacts",
      description: "Look up contacts by name.",
      origin: dispatch,
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
    };
    const send: ToolDescriptor = {
      name: "send_message",
      description: "Send a message to one contact.",
      origin: dispatch,
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          body: { type: "string" },
        },
        required: ["contact_id", "body"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
    };
    const { a, invoked } = await paired({
      tools: [book, find, send],
      taskSteps: [
        { name: "book_table", args: {} },
        { name: "send_message", args: {} },
      ],
      planResolver: async (missing) =>
        missing === "contact_id" ? { name: "find_contacts", args: { query: "Dana" } } : null,
      results: {
        book_table: JSON.stringify({ ok: true, reference_id: "R-42", party_size: 4 }),
        find_contacts: JSON.stringify({
          contacts: [{ id: "dana", name: "Dana" }],
        }),
      },
      sites: [
        { origin: tables, name: "Tables" },
        { origin: dispatch, name: "Dispatch" },
      ],
    });

    expect((await ask(a, { op: "task", text: "Book for four, then tell Dana" })).ok).toBe(true);
    await a.onDisplayMessage({ t: "choose", frameId: "1", choiceId: "__confirm" });
    await a.onDisplayMessage({ t: "choose", frameId: "2", choiceId: "__next" });
    await a.onDisplayMessage({ t: "choose", frameId: "3", choiceId: "dana" });
    const choices = a.current();
    if (choices.kind !== "choose") throw new Error("expected projection choices");
    const summary = choices.choices.find((choice) => choice.label === "Summary");
    if (!summary) throw new Error("expected summary");
    await a.onDisplayMessage({ t: "choose", frameId: "4", choiceId: summary.id });

    expect(a.current().kind).toBe("transfer");
    const status = await ask(a, { op: "status" });
    if (!status.ok) throw new Error("unreachable");
    expect(status.value["state"]).toBe("transfer_required");
    expect(status.value["accepting_tasks"]).toBe(false);

    const replacement = await ask(a, { op: "task", text: "Do something else" });
    expect(replacement.ok).toBe(false);
    if (replacement.ok) throw new Error("unreachable");
    expect(replacement.error).toContain("share information");
    expect(a.current().kind).toBe("transfer");
    expect(invoked).toEqual(["book_table", "find_contacts"]);
  });

  it("declines an empty task rather than putting a blank frame on someone's face", async () => {
    const { a } = await paired({ planner: true });
    expect((await ask(a, { op: "task", text: "   " })).ok).toBe(false);
  });
});

describe("cancelling", () => {
  it("is allowed even mid-confirmation, because it can only reduce what happens", async () => {
    const { a, invoked } = await paired({ planner: true });
    await a.onDisplayMessage({ t: "choose", frameId: "1", choiceId: "add_to_cart" });
    await a.onDisplayMessage({ t: "text", frameId: "2", value: "oat-1" });
    expect(a.current().kind).toBe("confirm");

    const r = await ask(a, { op: "cancel" });
    expect(r.ok).toBe(true);
    expect(a.current().kind).toBe("idle");
    expect(invoked).toEqual([]);
  });
});

describe("what the glasses show before a browser pairs", () => {
  it("stays silent, so the Display keeps its own pairing frame", () => {
    // The Display renders "Open Dusky and enter <code>" until the relay sends
    // a frame. Sending the empty menu here would replace that with "this
    // source declared no usable tools", which is a different and untrue
    // statement about a site nobody has connected to yet.
    const a = new SessionActor("ABC123", "Verdant Market");
    const display = new FakeSocket();
    a.attachDisplay(display as unknown as Sock);
    expect(display.sent).toEqual([]);
  });

  it("paints the moment a browser does pair", async () => {
    const { a, consoleSock } = actor();
    const display = new FakeSocket();
    a.attachDisplay(display as unknown as Sock);
    expect(display.sent).toEqual([]);

    await a.attachConsole(consoleSock as unknown as Sock, [{ origin: "https://shop.test" }]);
    const frames = display.sent.map((s) => JSON.parse(s) as { t: string });
    expect(frames.some((f) => f.t === "frame")).toBe(true);
  });
});

/**
 * The wearer has to be told which site they are acting on, and the relay is
 * the one surface that cannot find out for itself: the console is what has
 * the sites loaded.
 *
 * A name is cosmetic and grants nothing. What it must not do is lie by
 * omission, which is what a server-global `DUSKY_SOURCE` did the moment a
 * second source existed: the glasses read VERDANT MARKET while a restaurant's
 * tools were on the menu. Holding every site at once makes a single label
 * unanswerable rather than merely wrong, so the eyebrow follows the FRAME: a
 * menu spanning several businesses carries the product's name, and everything
 * about one pending tool carries that tool's own site.
 */
describe("the source label a wearer reads", () => {
  it("comes from the console that is holding the site", async () => {
    const built = actor();
    await built.a.attachConsole(built.consoleSock as unknown as Sock, [
      { origin: "https://shop.test", name: "Amber & Oak" },
    ]);
    built.a.attachDisplay(new FakeSocket() as unknown as Sock);
    expect(built.a.current().source).toBe("Amber & Oak");
  });

  /**
   * The host, not the product name and not a deployment default.
   *
   * An origin nobody named is still a real place, and its host is derived from
   * the origin the browser supplied rather than claimed by anyone. A wearer
   * reading `shop.test` above a confirmation knows strictly more than one
   * reading `Dusky`, and cannot be shown a business name that belongs to
   * somebody else.
   */
  it("falls back to the site's own host when a console names nothing", async () => {
    const { a } = await paired();
    expect(a.current().source).toBe("shop.test");
  });

  /**
   * The case a single string could never answer.
   *
   * Two businesses, one menu. No business name is true above a list holding
   * another one's actions, so the menu carries the product's own name; the
   * moment a tool is pending, the frame is about exactly one site again and
   * says which.
   */
  it("names the product on a mixed menu and the site on a pending tool", async () => {
    const built = actor({ tools: [...TOOLS, ...ELSEWHERE] });
    await built.a.attachConsole(built.consoleSock as unknown as Sock, [
      { origin: "https://shop.test", name: "Verdant Market" },
      { origin: "https://tables.test", name: "Amber & Oak" },
    ]);
    built.a.attachDisplay(new FakeSocket() as unknown as Sock);
    expect(built.a.current().source).toBe("Dusky");

    await built.a.onDisplayMessage({
      t: "choose",
      frameId: "1",
      choiceId: "https://tables.test book_table",
    } as never);
    expect(built.a.current().source).toBe("Amber & Oak");
  });

  it("cannot put control characters or an unbounded string on a 600x600 panel", async () => {
    const built = actor();
    await built.a.attachConsole(built.consoleSock as unknown as Sock, [
      { origin: "https://shop.test", name: `Ev\u0000il\nShop ${"x".repeat(80)}` },
    ]);
    const shown = built.a.current().source;
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting they are gone
    expect(shown).not.toMatch(/[\u0000-\u001f]/);
    expect(shown.length).toBeLessThanOrEqual(40);
  });

  it("is not what decides anything: the gate still reads the tool", async () => {
    const built = actor();
    await built.a.attachConsole(built.consoleSock as unknown as Sock, [
      { origin: "https://shop.test", name: "Totally Harmless Reader" },
    ]);
    built.a.attachDisplay(new FakeSocket() as unknown as Sock);
    const r = await ask(built.a, { op: "actions" });
    if (!r.ok) throw new Error("unreachable");
    const actions = r.value["actions"] as { name: string; needsApproval: boolean }[];
    expect(actions.find((x) => x.name === "add_to_cart")?.needsApproval).toBe(true);
  });
});

describe("the wearer's screen before a browser has paired", () => {
  /**
   * `attachDisplay` stays silent until a console connects, so the Display
   * keeps showing its own pairing frame with the code on it. Everything the
   * glasses SEND afterwards has to respect the same rule.
   */
  it("ignores a gesture that arrives before a console is attached", async () => {
    const built = actor();
    const display = new FakeSocket();
    built.a.attachDisplay(display as unknown as Sock);
    display.sent.length = 0;

    // One Escape used to run __cancel, which pushed an empty menu over the
    // six characters the wearer has to read off the lens.
    await built.a.onDisplayMessage({ t: "cancel", frameId: 1 } as never);
    await built.a.onDisplayMessage({ t: "choose", frameId: 1, choiceId: "__cancel" } as never);
    await built.a.onDisplayMessage({ t: "text", frameId: 1, value: "anything" } as never);

    expect(display.sent, "the relay spoke over the pairing code").toEqual([]);
  });

  it("answers a liveness ping even before a console is attached", async () => {
    const built = actor();
    const display = new FakeSocket();
    built.a.attachDisplay(display as unknown as Sock);
    display.sent.length = 0;

    await built.a.onDisplayMessage({ t: "ping" } as never);

    // The wearer sitting on the pairing code has the same right to know their
    // link is dead as one mid-task, and that is the screen they sit on
    // longest. A ping that went unanswered while unpaired would make the
    // Display's own watchdog tear down a perfectly good socket every 30s.
    const replies = display.sent.map((t) => (JSON.parse(t) as { t: string }).t);
    expect(replies, "a ping went unanswered").toEqual(["pong"]);
  });

  it("still answers a gesture once a console is attached", async () => {
    const built = actor();
    const display = new FakeSocket();
    built.a.attachDisplay(display as unknown as Sock);
    await built.a.attachConsole(built.consoleSock as unknown as Sock, [
      { origin: "https://shop.test" },
    ]);
    display.sent.length = 0;

    await built.a.onDisplayMessage({ t: "cancel", frameId: 1 } as never);
    expect(display.sent.length, "a paired session went deaf").toBeGreaterThan(0);
  });
});

describe("what the wearer is told when discovery fails", () => {
  /**
   * "This source declared no usable tools" is a statement about a SITE. The
   * console reaches that wording for reasons that have nothing to do with the
   * site: WebMCP missing from the browser, the bridge throwing, an iframe that
   * never loaded. FIELD-NOTES has a section on the last time the glasses said
   * something untrue about a source, and this is the same sentence arriving by
   * a different door.
   */
  const consoleThatCannotDiscover = (reason: string) => {
    const a = new SessionActor("ABCDEF", "Verdant Market");
    const sock = new FakeSocket();
    const raw = sock.send.bind(sock);
    sock.send = (text: string) => {
      raw(text);
      const msg = JSON.parse(text) as { t: string; requestId?: string };
      if (msg.t === "discover" && msg.requestId) {
        queueMicrotask(() => {
          void a.onConsoleMessage({
            t: "tools",
            requestId: msg.requestId as string,
            tools: [],
            error: reason,
          } as never);
        });
      }
    };
    return { a, sock };
  };

  it("says the source could not be reached, not that it offered nothing", async () => {
    const { a, sock } = consoleThatCannotDiscover("WebMCP is not available in this browser");
    const display = new FakeSocket();
    a.attachDisplay(display as unknown as Sock);
    await a.attachConsole(sock as unknown as Sock, [{ origin: "https://shop.test" }]);

    const frames = display.sent
      .map((t) => JSON.parse(t) as { t: string; frame?: { kind: string; note?: string } })
      .filter((m) => m.t === "frame");
    const last = frames.at(-1)?.frame;

    expect(last?.kind, "a failure to look was reported as an empty shop").toBe("error");
    expect(JSON.stringify(last)).not.toContain("declared no usable tools");
  });
});

describe("a second window on the same pairing code", () => {
  /**
   * One session holds one console and one display, and attaching a second
   * closes the first. That is the intended rule. What was not intended is that
   * the loser could not tell it had been replaced: it saw an ordinary close,
   * reconnected a quarter of a second later, and evicted the winner in turn.
   * Both sides reset their backoff on every successful open, so the exchange
   * never slowed down, and every console attach re-runs discovery and pushes a
   * frame, so the wearer's screen was rebuilt several times a second for as
   * long as two tabs were open on one code.
   */
  it("tells the console it replaced that it was replaced", async () => {
    const built = actor();
    await built.a.attachConsole(built.consoleSock as unknown as Sock, [
      { origin: "https://shop.test" },
    ]);

    // Not awaited: the eviction happens before this attach waits on discovery,
    // and the second socket is a plain fake that would never answer one.
    void built.a.attachConsole(new FakeSocket() as unknown as Sock, [
      { origin: "https://shop.test" },
    ]);

    expect(built.consoleSock.closedWith?.code, "an eviction looked like an ordinary close").toBe(
      4001,
    );
  });

  it("tells the display it replaced that it was replaced", () => {
    const a = new SessionActor("ABCDEF", "Verdant Market");
    const first = new FakeSocket();
    a.attachDisplay(first as unknown as Sock);
    a.attachDisplay(new FakeSocket() as unknown as Sock);

    expect(first.closedWith?.code).toBe(4001);
  });
});

describe("keeping the wearer's place", () => {
  /**
   * `frameId` drives `frameKey` on the Display, and `useDpad` resets focus to
   * the top of the list whenever it changes. That is correct for a frame that
   * changed and wrong for one that did not: a reconnect replays the current
   * frame, minted a fresh id for identical content, and moved the wearer's
   * selection out from under them.
   *
   * FIELD-NOTES records the StrictMode reconnect STORM being fixed. The reset
   * on a single honest reconnect survived it, and the relay redeploy in that
   * same file drops every socket for about forty seconds.
   */
  it("replays a frame under the id it already had", async () => {
    const built = await paired({ withDisplay: false });
    const display = new FakeSocket();
    built.a.attachDisplay(display as unknown as Sock);

    const idsOf = (sock: FakeSocket) =>
      sock.sent
        .map((t) => JSON.parse(t) as { t: string; frameId?: string })
        .filter((m) => m.t === "frame")
        .map((m) => m.frameId);

    const before = idsOf(display).at(-1);
    expect(before).toBeDefined();

    // The socket drops and comes back with nothing having happened.
    built.a.detachDisplay(display as unknown as Sock);
    const again = new FakeSocket();
    built.a.attachDisplay(again as unknown as Sock);

    expect(idsOf(again).at(-1), "an unchanged frame arrived as a new one").toBe(before);
  });

  it("still mints a new id when the frame actually changes", async () => {
    const built = await paired({ withDisplay: false });
    const display = new FakeSocket();
    built.a.attachDisplay(display as unknown as Sock);

    const idsOf = () =>
      display.sent
        .map((t) => JSON.parse(t) as { t: string; frameId?: string })
        .filter((m) => m.t === "frame")
        .map((m) => m.frameId);

    const before = idsOf().at(-1);
    await built.a.onDisplayMessage({
      t: "choose",
      frameId: before ?? "0",
      choiceId: "https://shop.test search_products",
    } as never);

    expect(idsOf().at(-1), "a changed frame reused an id").not.toBe(before);
  });
});
