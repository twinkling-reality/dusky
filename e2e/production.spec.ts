import { expect, type Page, test } from "@playwright/test";

/**
 * The load-bearing round trip, against the live deployment.
 *
 * This is not a duplicate of `roundtrip.spec.ts`. That one proves the code is
 * correct against four local dev servers. This one proves the DEPLOYMENT is
 * correct, which fails for entirely different reasons: a `ws://` URL an HTTPS
 * page refuses to open, an `exposedTo` origin that is off by a trailing slash,
 * an environment variable that never reached a Vite build, a relay that builds
 * but does not boot.
 *
 * Every one of those looks identical from the wearer's side: an empty menu.
 */

const DISPLAY = "https://dusky-display.vercel.app";
const CONSOLE = "https://dusky-console.vercel.app";
const MARKET = "https://dusky-market.vercel.app";
const RELAY = "https://dusky-relay.onrender.com";

/** A code nobody else is using, so a rerun cannot collide with a live session. */
const CODE = `PRD${Date.now().toString(36).slice(-3).toUpperCase()}`;

async function focusChoice(page: Page, label: RegExp) {
  for (let i = 0; i < 10; i += 1) {
    const focused = await page.locator('[data-focused="true"]').textContent();
    if (focused && label.test(focused)) return;
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(80);
  }
  throw new Error(`never focused a choice matching ${String(label)}`);
}

test("the relay is reachable and healthy", async ({ request }) => {
  const res = await request.get(`${RELAY}/health`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true });
});

test("every surface is public, with no login wall in front of the glasses", async ({ request }) => {
  // Vercel protects deployments by default and the glasses cannot log in, so
  // this is the check that catches a project someone re-protected later.
  for (const url of [DISPLAY, CONSOLE, MARKET]) {
    const res = await request.get(url);
    expect(res.status(), `${url} should be reachable`).toBe(200);
    expect(await res.text(), `${url} should not be a Vercel login page`).not.toContain(
      "<title>Login – Vercel</title>",
    );
  }
});

test("the deployed console discovers the deployed market cross-origin", async ({ page }) => {
  await page.goto(`${CONSOLE}/?session=${CODE}`);

  // If this fails the browser has no WebMCP, and nothing below can pass.
  await expect(page.getByText("WebMCP is not enabled")).toHaveCount(0);

  await page.getByLabel("Pairing code from your glasses").fill(CODE);
  await page.getByRole("button", { name: "Pair" }).click();

  // Four tools, and ONLY because dusky-market named dusky-console in
  // exposedTo. A trailing slash or an http:// would produce zero here.
  await expect(page.getByText("Search catalog")).toBeVisible();
  await expect(page.getByText("Add to cart")).toBeVisible();
  await expect(page.getByText("Empty cart")).toBeVisible();
  await expect(page.getByText("Review cart")).toBeVisible();

  // Dusky's own tools are registered for this browser's agent, and are NOT
  // mixed into what the wearer sees.
  await expect(page.getByText("registered for this browser agent")).toBeVisible();
  await expect(page.getByText("send_task_to_display")).toHaveCount(0);
});

test("a gesture on the deployed Display changes the deployed market", async ({ browser }) => {
  const ctx = await browser.newContext();
  const consolePage = await ctx.newPage();
  const displayPage = await ctx.newPage();

  await consolePage.goto(`${CONSOLE}/?session=${CODE}`);
  await consolePage.getByLabel("Pairing code from your glasses").fill(CODE);
  await consolePage.getByRole("button", { name: "Pair" }).click();
  await expect(consolePage.getByText("Add to cart")).toBeVisible();

  // The Display connects over wss:// to a relay on a different host entirely.
  await displayPage.goto(`${DISPLAY}/?session=${CODE}`);
  await expect(displayPage.getByRole("button", { name: /Add to cart/ })).toBeVisible();

  await focusChoice(displayPage, /Add to cart/);
  await displayPage.keyboard.press("Enter");

  // How the product id gets collected depends on whether this deployment has
  // a planner. Without one the wearer types it; with one, Dusky runs a
  // read-only search first and offers real products. Both are correct, so
  // assert the OUTCOME rather than the route, or this test breaks every time
  // DUSKY_PLANNER is toggled.
  const compose = displayPage.locator('input[type="text"]');
  const candidate = displayPage.getByRole("button", { name: /Organic oat milk/ });
  await expect(compose.or(candidate).first()).toBeVisible({ timeout: 60_000 });

  if (await compose.isVisible()) {
    await compose.fill("oat-1");
    await compose.press("Enter");
  } else {
    await focusChoice(displayPage, /Organic oat milk/);
    await displayPage.keyboard.press("Enter");
  }

  await expect(displayPage.getByRole("button", { name: /Confirm/ })).toBeVisible();

  // Nothing has run: the deployed partner site is untouched.
  const cart = consolePage.frameLocator("iframe").getByTestId("cart");
  await expect(cart).toHaveText("empty");

  await focusChoice(displayPage, /Confirm/);
  await displayPage.keyboard.press("Enter");

  // The deployed site's own DOM changes, in its own document.
  await expect(cart).toContainText("Organic oat milk");
  // And the result frame is read from what that site returned.
  await expect(displayPage.getByText("Cart total")).toBeVisible();
  await expect(displayPage.getByText("$4.29")).toBeVisible();

  await ctx.close();
});

test("an agent in the browser can drive the deployed session", async ({ browser }) => {
  const ctx = await browser.newContext();
  const consolePage = await ctx.newPage();
  const displayPage = await ctx.newPage();

  await consolePage.goto(`${CONSOLE}/?session=${CODE}`);
  await consolePage.getByLabel("Pairing code from your glasses").fill(CODE);
  await consolePage.getByRole("button", { name: "Pair" }).click();
  await expect(consolePage.getByText("registered for this browser agent")).toBeVisible();

  await displayPage.goto(`${DISPLAY}/?session=${CODE}`);
  await expect(displayPage.getByRole("button", { name: /Add to cart/ })).toBeVisible();

  const status = await consolePage.evaluate(async () => {
    const mc = (document as unknown as { modelContext: ModelContextLike }).modelContext;
    const tools = await mc.getTools();
    const t = tools.find((x) => x.name === "get_display_status");
    if (!t) throw new Error("Dusky registered no get_display_status tool");
    return JSON.parse(await mc.executeTool(t, JSON.stringify({}))) as Record<string, unknown>;
  });

  expect(status).toMatchObject({ ok: true, session: CODE, display_connected: true });
  // The relay reports whether it can interpret a spoken request at all, which
  // is how an agent knows the deployment has a working model credential.
  expect(status["can_interpret_requests"]).toBe(true);

  await ctx.close();
});

interface ModelContextLike {
  getTools(o?: { fromOrigins?: string[] }): Promise<{ name: string }[]>;
  executeTool(tool: unknown, input?: unknown): Promise<string>;
}

/**
 * The only path that actually spends a model call, and therefore the only
 * test that proves the deployed relay has a working credential.
 *
 * `can_interpret_requests` above only says a planner was constructed. The SDK
 * does not validate a key at construction time, so a wrong key looks identical
 * until the first request. This is that first request.
 */
test("a spoken request from an agent reaches the wearer", async ({ browser }) => {
  const ctx = await browser.newContext();
  const consolePage = await ctx.newPage();
  const displayPage = await ctx.newPage();

  await consolePage.goto(`${CONSOLE}/?session=${CODE}`);
  await consolePage.getByLabel("Pairing code from your glasses").fill(CODE);
  await consolePage.getByRole("button", { name: "Pair" }).click();
  await expect(consolePage.getByText("registered for this browser agent")).toBeVisible();

  await displayPage.goto(`${DISPLAY}/?session=${CODE}`);
  await expect(displayPage.getByRole("button", { name: /Add to cart/ })).toBeVisible();

  const sent = await consolePage.evaluate(async () => {
    const mc = (document as unknown as { modelContext: ModelContextLike }).modelContext;
    const tools = await mc.getTools();
    const t = tools.find((x) => x.name === "send_task_to_display");
    if (!t) throw new Error("no send_task_to_display tool");
    return JSON.parse(
      await mc.executeTool(t, JSON.stringify({ text: "add the organic oat milk to my cart" })),
    ) as Record<string, unknown>;
  });

  console.log("send_task_to_display ->", JSON.stringify(sent, null, 2));
  expect(sent["ok"], `relay refused the task: ${String(sent["error"])}`).toBe(true);

  // The wearer is now looking at something the model chose. Which frame it is
  // depends on whether the model could fill the product id from the request
  // alone: it is told never to invent an identifier, so the honest outcome is
  // a list of real products read from a search it ran first.
  await expect(displayPage.locator('[data-kind="choose"], [data-kind="confirm"]')).toBeVisible({
    timeout: 60_000,
  });
  const kind = await displayPage.locator("[data-kind]").first().getAttribute("data-kind");
  const heading = await displayPage.locator("h1").first().textContent();
  console.log(`display is showing a "${kind}" frame titled "${heading?.trim()}"`);

  await ctx.close();
});
