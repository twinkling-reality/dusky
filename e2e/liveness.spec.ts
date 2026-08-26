import { expect, test } from "@playwright/test";

/**
 * The link has to be able to notice its own death.
 *
 * When the glasses sleep the page is suspended, not unloaded. The radio stops
 * without a FIN or an RST, so the socket stays OPEN, `onclose` never fires,
 * and nothing downstream can tell: the wearer keeps a stale frame with dead
 * controls, no reconnecting badge, and a gesture acknowledgement that sweeps
 * forever. Only traffic distinguishes a live socket from a dead one.
 *
 * This covers the traffic. It cannot cover the suspend itself, which needs
 * hardware: see FIELD-NOTES.md, "Still unknown".
 */
test("the Display makes traffic, and the relay answers it", async ({ page }) => {
  // The Display pings every 15s, so this waits out one interval.
  test.setTimeout(60_000);

  const sent: string[] = [];
  const received: string[] = [];
  page.on("websocket", (ws) => {
    const read = (payload: string | Buffer): string | undefined => {
      try {
        return (JSON.parse(String(payload)) as { t?: string }).t;
      } catch {
        return undefined;
      }
    };
    ws.on("framesent", (f) => {
      const t = read(f.payload);
      if (t) sent.push(t);
    });
    ws.on("framereceived", (f) => {
      const t = read(f.payload);
      if (t) received.push(t);
    });
  });

  await page.goto("http://localhost:7802");

  // A ping that is never sent leaves a sleeping panel undetectable...
  await expect.poll(() => sent, { timeout: 40_000, intervals: [1_000] }).toContain("ping");
  // ...and one that is never answered makes the watchdog tear down a healthy
  // socket every 30 seconds instead.
  await expect.poll(() => received, { timeout: 10_000, intervals: [500] }).toContain("pong");
});
