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
 * What a wearer is shown once the link is gone.
 *
 * Note what this does NOT cover. Chromium's offline emulation CLOSES the
 * socket, so this is the ordinary drop, which was never the broken case. The
 * half-open one, where the radio stops and `readyState` stays OPEN and no
 * close event ever fires, is what the watchdog in `useRelay` is for, and
 * nothing here can produce it: it needs packets silently discarded rather than
 * a connection torn down. That case is still verified only by reading.
 *
 * What this does cover is the badge itself, which was drawn on top of the
 * frame's own status word and below Meta's 16px floor, on the one element
 * whose job is to be readable when nothing else can be trusted.
 */
test("a dropped link says so legibly and out of the frame's way", async ({ page, context }) => {
  test.setTimeout(120_000);

  await page.goto("http://localhost:7802/?session=QUIETA");
  const panel = page.locator("div[data-kind]");
  await expect(panel).toBeVisible();

  // The badge is up while connecting and clears once the socket opens, so
  // waiting for it to go is also how we know we are actually connected.
  const badge = page.locator("div[class*='_link_']");
  await expect(badge, "never reached a healthy link").toHaveCount(0, { timeout: 20_000 });

  await context.setOffline(true);
  try {
    await expect(badge).toHaveCount(1, { timeout: 60_000 });

    // Meta's documented floor is 16px, and this is the element whose whole
    // job is to be readable when nothing else on the panel can be trusted.
    const px = await badge.evaluate((n) => Number.parseFloat(getComputedStyle(n).fontSize));
    expect(px, `badge was ${px}px`).toBeGreaterThanOrEqual(16);

    // It used to sit exactly where the frame's own status word sits. A
    // background cannot fix that here: the ground colour emits nothing on a
    // waveguide, so overlapping text just adds up.
    const b = await badge.boundingBox();
    const header = await panel.locator("> div").first().boundingBox();
    if (b && header) {
      expect(b.y, "the badge overlapped the frame's own header").toBeGreaterThan(
        header.y + header.height,
      );
    }
  } finally {
    await context.setOffline(false);
  }
});
