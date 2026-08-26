import { appendFile, mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import { type AuditStore, FileAuditStore, MemoryAuditStore, TeeAuditStore } from "@dusky/audit";
import type { AuditEntry, ConsoleToServer, DisplayToServer } from "@dusky/contracts";
import { CLOSE_NOT_A_CODE, isSessionCode } from "@dusky/contracts";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import { Hub } from "./hub.js";
import { plannerFactory } from "./planner.js";

/**
 * The Dusky session relay.
 *
 * Hono is used rather than Express because it runs unmodified on Cloudflare
 * Workers. When sessions outgrow a single process, each SessionActor becomes a
 * Durable Object and this file is the only one that changes.
 *
 * Nothing here holds a partner site's credentials, and nothing here can invoke
 * a tool: tool execution happens in the user's own browser, by design.
 */

const PORT = Number(process.env["PORT"] ?? 7900);
/** Fallback only. A console that names its source overrides this on connect. */
const SOURCE = process.env["DUSKY_SOURCE"] ?? "Verdant Market";

/**
 * Where the audit trail is kept.
 *
 * Memory alone was the old behaviour and loses everything on a deploy, which
 * is not acceptable for something described as a product feature. Set
 * DUSKY_AUDIT_DIR to a directory that outlives the container and the trail
 * outlives it too; without one, Dusky is honest about being ephemeral rather
 * than pretending otherwise.
 */
const auditDir = process.env["DUSKY_AUDIT_DIR"];
const memory = new MemoryAuditStore();
/** Held separately from the tee, because expiry is a file store's business. */
const durable = auditDir
  ? new FileAuditStore({
      dir: auditDir,
      fs: { mkdir, appendFile, readFile, readdir, stat, unlink },
      onError: (err) => console.warn(`dusky: audit write failed: ${err.message}`),
    })
  : null;
const audit: AuditStore = durable ? new TeeAuditStore(memory, durable) : memory;
console.log(
  auditDir
    ? `dusky: audit trail persisted to ${auditDir}`
    : "dusky: audit trail is in memory only and will not survive a restart",
);

const hub = new Hub(plannerFactory(), audit);
const app = new Hono();

app.use("*", cors({ origin: (o) => o ?? "*", credentials: false }));

app.get("/health", (c) => c.json({ ok: true, sessions: hub.size() }));

/**
 * Developer diagnostics. Deliberately separate from the wearer experience.
 *
 * Reads from the STORE rather than from a live actor, so the trail of a
 * session that has since ended, or that belonged to a process which has since
 * been replaced, is still answerable.
 *
 * Knowing a pairing code is already enough to pair a console to that session,
 * so this endpoint grants nothing that the code did not already grant. It is
 * one more reason a code is a credential and should not be posted anywhere.
 */
app.get("/diagnostics/:id", async (c) => {
  const id = c.req.param("id").toUpperCase();
  const kindsParam = c.req.query("kinds");
  const limitParam = Number(c.req.query("limit") ?? "");
  const entries = await audit.read(id, {
    kinds: kindsParam ? (kindsParam.split(",") as AuditEntry["kind"][]) : undefined,
    limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
  });
  // What arrived, never a claim about what happened.
  //
  // "No such session" was true while trails were kept forever. It stopped
  // being true the moment they expire: a code whose week is up did exist and
  // did things, and saying otherwise is the same class of mistake as telling a
  // wearer a site declared no tools when nothing had connected yet. This
  // sentence is true whether the code was never used, its trail has aged out,
  // or nothing was ever recorded under it.
  if (entries.length === 0 && !hub.peek(id))
    return c.json({ error: "no trail for this code" }, 404);
  return c.json({
    id,
    live: hub.peek(id) !== undefined,
    durable: auditDir !== undefined,
    count: entries.length,
    audit: entries,
  });
});

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`dusky relay listening on :${info.port}`);
});

/* --------------------------------------------------------------- sockets */

const wss = new WebSocketServer({ noServer: true });

type Role = "display" | "console";

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const role: Role | null =
    url.pathname === "/display" ? "display" : url.pathname === "/console" ? "console" : null;
  if (!role) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, role, url));
});

/**
 * How long a socket may go without answering a protocol-level ping.
 *
 * Two missed beats terminates it. This is the relay's half of the same
 * problem the Display solves with `ping`/`pong`: a client whose radio went
 * quiet leaves a socket that is open as far as this process is concerned, so
 * `statusValue()` reports `display_connected: true` and `accepting_tasks:
 * true`, and an agent's task is accepted into a void. `terminate()` fires
 * `close`, which runs the ordinary detach path, so the lie ends by itself.
 *
 * `wss.clients` is not used because this server upgrades by hand and never
 * emits `connection`, so the set would be empty. Per-socket is also simply
 * less to get wrong.
 */
const HEARTBEAT_MS = 30_000;

/**
 * How often to forget sessions nothing is connected to.
 *
 * Frequent enough that a burst of invented codes is reclaimed rather than
 * accumulated, rare enough to be free. The TTL itself lives on the Hub.
 */
const SWEEP_MS = 5 * 60_000;
const sweeper = setInterval(() => {
  const gone = hub.sweep();
  if (gone > 0) console.log(`dusky: forgot ${gone} idle session${gone === 1 ? "" : "s"}`);
}, SWEEP_MS);
sweeper.unref?.();

/**
 * How often to expire audit trails on disk.
 *
 * Hourly, not on the session sweeper's five minutes: a week-long window does
 * not need checking twelve times an hour. Also once at boot, because this
 * relay is restarted by a deploy far more often than it is left running long
 * enough for an interval to matter.
 *
 * Only the file store has anything to reclaim. In memory the trail is already
 * bounded, by `MemoryAuditStore` itself.
 */
const TRAIL_SWEEP_MS = 60 * 60_000;
if (durable) {
  const expireTrails = () => {
    durable
      .sweep()
      .then((gone) => {
        if (gone > 0) console.log(`dusky: expired ${gone} audit trail${gone === 1 ? "" : "s"}`);
      })
      // `sweep` reports its own failures and resolves. This is here so that
      // stopping being true cannot take the relay down with it.
      .catch((err: unknown) => console.warn(`dusky: audit sweep failed: ${String(err)}`));
  };
  const trailSweeper = setInterval(expireTrails, TRAIL_SWEEP_MS);
  trailSweeper.unref?.();
  expireTrails();
}

function onConnection(ws: WebSocket, role: Role, url: URL): void {
  let sessionId: string | null = null;

  let alive = true;
  ws.on("pong", () => {
    alive = true;
  });
  const beat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, HEARTBEAT_MS);
  // Do not hold the process open for a heartbeat.
  beat.unref?.();
  ws.on("close", () => clearInterval(beat));

  ws.on("message", (raw: RawData) => {
    void (async () => {
      let msg: DisplayToServer | ConsoleToServer;
      try {
        msg = JSON.parse(String(raw)) as DisplayToServer | ConsoleToServer;
      } catch {
        return;
      }

      // The first message must be a hello, which is what binds this socket to
      // a session. Anything before that is ignored rather than trusted.
      if (msg.t === "hello") {
        // One hello per socket. Re-sending it minted a fresh session actor
        // every time, from a single connection, with nothing anywhere to slow
        // that down.
        if (sessionId !== null) return;

        // A pairing code, or nothing. This used to accept any string of any
        // length and create a session for it, which made the key space of a
        // map that never emptied into "whatever a stranger types".
        const claimed = msg.sessionId.trim().toUpperCase();
        if (!isSessionCode(claimed)) {
          ws.close(CLOSE_NOT_A_CODE, "not a pairing code");
          return;
        }

        sessionId = claimed;
        const actor = hub.get(sessionId, SOURCE);
        if (role === "display") {
          actor.attachDisplay(ws);
        } else {
          const origins = (url.searchParams.get("origins") ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          // The console knows which site it is holding; this process does not.
          await actor.attachConsole(ws, origins, url.searchParams.get("source") ?? undefined);
        }
        return;
      }

      if (!sessionId) return;
      const actor = hub.peek(sessionId);
      if (!actor) return;

      if (role === "display") await actor.onDisplayMessage(msg as DisplayToServer);
      else await actor.onConsoleMessage(msg as ConsoleToServer);
    })();
  });

  ws.on("close", () => {
    if (!sessionId) return;
    const actor = hub.peek(sessionId);
    if (!actor) return;
    if (role === "display") actor.detachDisplay(ws);
    else actor.detachConsole(ws);
  });

  ws.on("error", () => ws.close());
}
