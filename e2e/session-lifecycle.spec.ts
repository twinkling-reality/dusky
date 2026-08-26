import { expect, test } from "@playwright/test";

/**
 * The relay's front door, over a real socket.
 *
 * A pairing code is six characters a stranger can invent, and the relay is a
 * process that runs for weeks. It used to accept any string of any length as a
 * session id and mint a session actor for each distinct one, in a map that
 * nothing ever deleted from.
 */

const RELAY = "http://localhost:7900";
const DISPLAY_WS = "ws://localhost:7900/display";

/**
 * A code no earlier run can have used.
 *
 * The relay is reused across runs and a session outlives a socket by design,
 * so a fixed code would be an existing session on the second run and this
 * would measure nothing.
 */
function freshCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function sessionCount(): Promise<number> {
  const res = await fetch(`${RELAY}/health`);
  return ((await res.json()) as { sessions: number }).sessions;
}

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url);
    sock.addEventListener("open", () => resolve(sock), { once: true });
    sock.addEventListener("error", () => reject(new Error("could not open")), { once: true });
  });
}

function closed(sock: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve) => sock.addEventListener("close", resolve as never, { once: true }));
}

test("a session id that could not have come off a lens is refused", async () => {
  const before = await sessionCount();
  const sock = await open(DISPLAY_WS);
  const bye = closed(sock);

  sock.send(JSON.stringify({ t: "hello", sessionId: "../../../etc/passwd", client: "display" }));

  const ev = await bye;
  expect(ev.code, "a malformed pairing code was accepted").toBe(4400);
  expect(await sessionCount(), "a session was minted for it anyway").toBe(before);
});

test("one socket may claim one session, not a new one per message", async () => {
  const before = await sessionCount();
  const sock = await open(DISPLAY_WS);

  sock.send(JSON.stringify({ t: "hello", sessionId: freshCode(), client: "display" }));
  await expect.poll(sessionCount, { timeout: 5_000 }).toBe(before + 1);

  // Five more claims down the same connection, every one of them valid.
  for (let i = 0; i < 5; i += 1) {
    sock.send(JSON.stringify({ t: "hello", sessionId: freshCode(), client: "display" }));
  }
  await new Promise((r) => setTimeout(r, 1_000));

  expect(await sessionCount(), "one connection minted several sessions").toBe(before + 1);
  sock.close();
});

test("two windows on one code do not fight over the wearer's screen", async ({ context }) => {
  const code = freshCode();

  const display = await context.newPage();
  const frames: number[] = [];
  display.on("websocket", (ws) => {
    ws.on("framereceived", (f) => {
      try {
        if ((JSON.parse(String(f.payload)) as { t?: string }).t === "frame") frames.push(1);
      } catch {
        /* not ours */
      }
    });
  });
  await display.goto(`http://localhost:7802/?session=${code}`);

  const first = await context.newPage();
  await first.goto(`http://localhost:7803/demo?session=${code}&mode=glasses`);
  await display.waitForTimeout(1_500);

  // A judge opening the pre-paired link a second time, which is one click.
  const second = await context.newPage();
  await second.goto(`http://localhost:7803/demo?session=${code}&mode=glasses`);
  await display.waitForTimeout(1_500);

  // Every console attach re-runs discovery and pushes a frame. If the two
  // windows are trading the session between them, this window is where it
  // shows up: the wearer's panel rebuilt several times a second, forever.
  const settled = frames.length;
  await display.waitForTimeout(5_000);
  const churn = frames.length - settled;

  expect(churn, `the wearer's screen was rebuilt ${churn} times while idle`).toBeLessThan(5);
});
