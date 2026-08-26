import type { ConsoleToServer, DisplayToServer } from "@dusky/contracts";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import { Hub } from "./hub.js";

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
const SOURCE = process.env["DUSKY_SOURCE"] ?? "Verdant Market";

const hub = new Hub();
const app = new Hono();

app.use("*", cors({ origin: (o) => o ?? "*", credentials: false }));

app.get("/health", (c) => c.json({ ok: true, sessions: hub.list().length }));

/** Developer diagnostics. Deliberately separate from the wearer experience. */
app.get("/diagnostics/:id", (c) => {
  const actor = hub.peek(c.req.param("id").toUpperCase());
  if (!actor) return c.json({ error: "no such session" }, 404);
  return c.json({ id: actor.id, audit: actor.audit });
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
          await actor.attachConsole(ws, origins);
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
