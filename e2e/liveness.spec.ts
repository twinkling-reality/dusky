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

/**
 * The badge that tells a wearer their panel may be stale.
 *
 * Measured while the page is still connecting, which is when it is on screen
 * without any network trickery. Chromium's offline emulation does NOT sever an
 * established WebSocket, so there is no way from here to produce a dropped
 * link on demand; an earlier version of this test appeared to and was actually
 * measuring a rejected session code.
 *
 * What is checked is what was wrong: the badge sat exactly where the frame
 * draws its own status word, at 14px against a documented 16px floor. Giving
 * it a background is not a fix on this hardware, because the ground colour
 * emits nothing and so occludes nothing. It had to move.
 */
test("the link badge is legible and out of the frame's way", async ({ page }) => {
  // Refuse the socket outright, which is the one way from here to hold a
  // Display in a degraded link for long enough to measure it. Locally the
  // relay answers in milliseconds, so the badge is otherwise never on screen.
  await page.routeWebSocket(/.*/, (ws) => ws.close());
  await page.goto("http://localhost:7802/?session=QUYETA");

  const badge = page.locator("div[class*='_link_']");
  await expect(badge, "no badge on a link that will not come up").toHaveCount(1);

  const px = await badge.evaluate((n) => Number.parseFloat(getComputedStyle(n).fontSize));
  expect(px, `badge was ${px}px, under Meta's 16px floor`).toBeGreaterThanOrEqual(16);

  const b = await badge.boundingBox();
  const header = await page.locator("div[data-kind] > div").first().boundingBox();
  expect(b, "the badge has no box").not.toBeNull();
  expect(header, "the frame has no header").not.toBeNull();
  if (b && header) {
    expect(b.y, "the badge overlapped the frame's own header").toBeGreaterThan(
      header.y + header.height,
    );
  }
});
