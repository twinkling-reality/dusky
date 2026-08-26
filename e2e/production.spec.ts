import { expect, type Page, test } from "@playwright/test";

/**
 * The load-bearing round trip, against the live deployment.
 *
 * This is not a duplicate of `roundtrip.spec.ts`. That one proves the code is
 * correct against four local dev servers. This one proves the DEPLOYMENT is
 * correct, which fails for entirely different reasons: a `ws://` URL an HTTPS
 * page refuses to open, an `exposedTo` origin that is off by a trailing slash,
 * an environment variable that never reached a Vite build, a relay that builds
 * but does not boot, a surface nobody ever deployed at all.
 *
 * Every one of those looks identical from the wearer's side: an empty menu.
 *
 * That last one was not hypothetical. Amber & Oak had no coverage here, and
 * `dusky-reservations.vercel.app` answered DEPLOYMENT_NOT_FOUND while this
 * suite passed, because a claim nothing asserts is a claim nothing can catch.
 */

const DISPLAY = "https://dusky-display.vercel.app";
const CONSOLE = "https://dusky-console.vercel.app";
const MARKET = "https://dusky-market.vercel.app";
const RESERVATIONS = "https://dusky-reservations.vercel.app";
const RELAY = "https://dusky-relay.onrender.com";

/**
 * A code nobody else is using, so a rerun cannot collide with a live session.
 *
 * Letters only, from SESSION_CODE_ALPHABET. Base36 was fine while the relay
 * took any string, and stopped being fine when the console started refusing
 * anything a lens could not legibly show.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
const stamp = Date.now();
const suffix = [0, 1, 2]
  .map((i) => ALPHABET[Math.floor(stamp / ALPHABET.length ** i) % ALPHABET.length])
  .join("");
const CODE = `PRD${suffix}`;
/** A second one, because a session holds exactly one source at a time. */
const CODE_B = `RES${suffix}`;

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
  // A project that was never deployed answers 404 rather than a login page, so
  // this loop catches both. It is the cheapest place either failure can be
  // found, and every surface belongs in it or the surface left out is the one
  // that breaks.
  for (const url of [DISPLAY, CONSOLE, MARKET, RESERVATIONS]) {
    const res = await request.get(url);
    expect(res.status(), `${url} should be reachable`).toBe(200);
    expect(await res.text(), `${url} should not be a Vercel login page`).not.toContain(
      "<title>Login – Vercel</title>",
    );
  }
});

/**
 * `/demo` is a client-side route, so the host has to serve index.html for it.
 * Without the rewrite in vercel/console.json a shared link 404s, and the very
 * first thing anyone is handed is a broken page.
 */
test("the front door and the demo route are both served", async ({ request }) => {
  for (const path of ["/", "/demo"]) {
    const res = await request.get(`${CONSOLE}${path}`);
    expect(res.status(), `${path} should be served`).toBe(200);
    expect(await res.text(), `${path} should be the app, not a 404`).toContain('id="root"');
  }
});

test("the deployed console discovers the deployed market cross-origin", async ({ page }) => {
  // A code in the URL pairs with no typing. `mode=glasses` suppresses the
  // embedded panel, because this test opens its own Display page and a
  // session takes exactly one Display.
  await page.goto(`${CONSOLE}/demo?session=${CODE}&mode=glasses`);

  // If this fails the browser has no WebMCP, and nothing below can pass.
  await expect(page.getByText("WebMCP is not enabled")).toHaveCount(0);

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

/**
 * The console holds the partner site in an iframe, and which URL it holds is
 * baked in at BUILD time by Vite. `sources.ts` falls back to
 * `http://localhost:7804` when `VITE_RESERVATIONS_URL` is absent, which is
 * correct for a developer and catastrophic on an HTTPS page: the browser
 * blocks it as mixed content and the wearer gets an empty menu with no
 * indication why.
 *
 * Nothing else in this suite can see that, because the fallback is a perfectly
 * valid string and the build succeeds.
 */
test("the console's second source points at a deployment, not at a laptop", async ({ page }) => {
  await page.goto(`${CONSOLE}/demo?session=${CODE_B}&source=reservations&mode=glasses`);

  const src = await page.locator('iframe[title="Amber & Oak"]').getAttribute("src");
  expect(
    new URL(src ?? "about:blank").origin,
    "VITE_RESERVATIONS_URL never reached the console's build",
  ).toBe(RESERVATIONS);
});

/**
 * The claim the second source exists to support, checked against the
 * deployment rather than against four dev servers.
 *
 * The market's `exposedTo` being correct says nothing about this one: they are
 * separate projects, separately built, each naming `dusky-console` by hand. A
 * trailing slash or an `http://` in either produces zero tools here and a menu
 * that looks exactly like a site with nothing to offer.
 */
test("the deployed console discovers the deployed restaurant cross-origin", async ({ page }) => {
  await page.goto(`${CONSOLE}/demo?session=${CODE_B}&source=reservations&mode=glasses`);
  await expect(page.getByText("WebMCP is not enabled")).toHaveCount(0);

  const actions = page.getByTestId("actions");
  await expect(actions.locator("li")).toHaveCount(3);

  // Amber & Oak declares a title on one tool out of three, deliberately. The
  // other two are listed under their raw names, which is what Chrome returning
  // `title: ""` rather than omitting it used to turn into a blank row.
  await expect(actions.getByText("Find a table")).toBeVisible();
  await expect(actions.getByText("book_table")).toBeVisible();
  await expect(actions.getByText("change_reservation")).toBeVisible();

  // Nothing from the other source has leaked into this session.
  await expect(actions.getByText("Add to cart")).toHaveCount(0);
});

test("a gesture on the deployed Display changes the deployed market", async ({ browser }) => {
  const ctx = await browser.newContext();
  const consolePage = await ctx.newPage();
  const displayPage = await ctx.newPage();

  await consolePage.goto(`${CONSOLE}/demo?session=${CODE}&mode=glasses`);
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
  const cart = consolePage.frameLocator('iframe[title="Verdant Market"]').getByTestId("cart");
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

  await consolePage.goto(`${CONSOLE}/demo?session=${CODE}&mode=glasses`);
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

  await consolePage.goto(`${CONSOLE}/demo?session=${CODE}&mode=glasses`);
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
