import { appendFile, mkdir, readFile } from "node:fs/promises";
import { type AuditStore, FileAuditStore, MemoryAuditStore, TeeAuditStore } from "@dusky/audit";
import type { AuditEntry, ConsoleToServer, DisplayToServer } from "@dusky/contracts";
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
const audit: AuditStore = auditDir
  ? new TeeAuditStore(
      memory,
      new FileAuditStore({
        dir: auditDir,
        fs: { mkdir, appendFile, readFile },
        onError: (err) => console.warn(`dusky: audit write failed: ${err.message}`),
      }),
    )
  : memory;
console.log(
  auditDir
    ? `dusky: audit trail persisted to ${auditDir}`
    : "dusky: audit trail is in memory only and will not survive a restart",
);

const hub = new Hub(plannerFactory(), audit);
const app = new Hono();

app.use("*", cors({ origin: (o) => o ?? "*", credentials: false }));

app.get("/health", (c) => c.json({ ok: true, sessions: hub.list().length }));

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
  if (entries.length === 0 && !hub.peek(id)) return c.json({ error: "no such session" }, 404);
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

function onConnection(ws: WebSocket, role: Role, url: URL): void {
  let sessionId: string | null = null;

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
        sessionId = msg.sessionId.toUpperCase();
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
