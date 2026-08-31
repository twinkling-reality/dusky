import { expect, test } from "@playwright/test";
import { focusChoice } from "./drive.js";
import { freshCode } from "./session-code.js";

/**
 * The load-bearing round trip, against the live deployment.
 *
 * This is not a duplicate of `roundtrip.spec.ts`. That one proves the code is
 * correct against seven local dev servers. This one proves the DEPLOYMENT is
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
const DISPATCH = "https://dusky-dispatch.vercel.app";
const RELAY = "https://dusky-relay.onrender.com";

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
  for (const url of [DISPLAY, CONSOLE, MARKET, RESERVATIONS, DISPATCH]) {
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

test("the deployed front door uses the current product description", async ({ page }) => {
  await page.goto(CONSOLE);

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("Turn web actions into augmented reality.");
  await expect(page.locator("main")).toContainText(
    "Dusky uses WebMCP to turn website capabilities into dynamic, actionable interfaces for AR displays.",
  );
});

test("the deployed console discovers the deployed market cross-origin", async ({ page }) => {
  const code = freshCode();
  // A code in the URL pairs with no typing. `mode=glasses` suppresses the
  // embedded panel, because this test opens its own Display page and a
  // session takes exactly one Display.
  await page.goto(`${CONSOLE}/demo?session=${code}&mode=glasses`);

  // If this fails the browser has no WebMCP, and nothing below can pass.
  await expect(page.getByText("WebMCP is not enabled")).toHaveCount(0);

  // The shop's four, and ONLY because dusky-market named dusky-console in
  // exposedTo. A trailing slash or an http:// would produce zero here. The
  // restaurant's three and dispatch desk's four arrive alongside them and are
  // asserted below.
  await expect(page.getByText("Search catalog")).toBeVisible();
  await expect(page.getByText("Add to cart")).toBeVisible();
  await expect(page.getByText("Empty cart")).toBeVisible();
  await expect(page.getByText("Review cart")).toBeVisible();

  // Dusky's own tools are registered for this browser's agent, and are NOT
  // mixed into what the wearer sees.
  await expect(page.getByText(/for this browser's agent/)).toBeVisible();
  await expect(page.getByText("send_task_to_display")).toHaveCount(0);
});

/**
 * The console holds every partner site in an iframe, and which URLs it holds
 * are baked in at BUILD time by Vite. `sources.ts` falls back to
 * local development URLs when `VITE_MARKET_URL`, `VITE_RESERVATIONS_URL`, or
 * `VITE_DISPATCH_URL` are absent, which is correct for a developer and
 * catastrophic on an HTTPS page: the browser blocks them as mixed content and
 * the wearer gets an incomplete menu with no indication why.
 *
 * Nothing else in this suite can see that, because a fallback is a perfectly
 * valid string and the build succeeds.
 *
 * Every site is checked, not just the one that was added last. The reason this
 * test exists is that a surface nobody asserted about was the surface that
 * broke, so a loop over the list is the shape that keeps being true when a
 * third site arrives.
 */
test("every site the console holds points at a deployment, not at a laptop", async ({ page }) => {
  await page.goto(`${CONSOLE}/demo?session=${freshCode()}&mode=glasses`);

  for (const [title, expected] of [
    ["Verdant Market", MARKET],
    ["Amber & Oak", RESERVATIONS],
    ["Northstar Dispatch", DISPATCH],
  ] as const) {
    const frame = page.locator(`iframe[title="${title}"]`);
    // Fail on the missing surface itself. Calling getAttribute directly waits
    // for the suite's full two-minute ceiling, which made a stale deployment
    // spend two minutes saying only that Amber & Oak was absent.
    await expect(frame, `${title} should be loaded by the console`).toHaveCount(1, {
      timeout: 30_000,
    });
    const src = await frame.getAttribute("src");
    expect(
      new URL(src ?? "about:blank").origin,
      `the build never got a deployed URL for ${title}`,
    ).toBe(expected);
  }
});

/**
 * Three businesses, one session, checked against the deployment.
 *
 * Each site's `exposedTo` says nothing about the other: they are separate
 * projects, separately built, each naming `dusky-console` by hand. A trailing
 * slash or an `http://` in either produces zero tools from that one and a list
 * that looks exactly like a site with nothing to offer.
 *
 * This test used to end by asserting `Add to cart` was ABSENT, under the
 * comment "nothing from the other source has leaked into this session". That
 * was the right invariant while a console held one site at a time and it is
 * the opposite of the product now, so it is replaced rather than deleted: the
 * separation that mattered was never between what a wearer can SEE, it was
 * between what can act without them. That rule is `planResolver` refusing a
 * cross-origin lookup, which `packages/planner` and `packages/session` each
 * enforce and each test.
 */
test("the deployed console holds all three deployed sites at once", async ({ page }) => {
  await page.goto(`${CONSOLE}/demo?session=${freshCode()}&mode=glasses`);
  await expect(page.getByText("WebMCP is not enabled")).toHaveCount(0);

  const actions = page.getByTestId("actions");

  // Amber & Oak declares a title on one tool out of three, deliberately. The
  // other two are listed under their raw names, which is what Chrome returning
  // `title: ""` rather than omitting it used to turn into a blank row.
  await expect(actions.getByText("Find a table")).toBeVisible();
  await expect(actions.getByText("book_table")).toBeVisible();
  await expect(actions.getByText("change_reservation")).toBeVisible();

  // And the shop's four, on the same list rather than instead of them.
  await expect(actions.getByText("Search catalog")).toBeVisible();
  await expect(actions.getByText("Add to cart")).toBeVisible();

  // The communications source is independent of both, and all four of its
  // tools stay in the same registry.
  await expect(actions.getByText("Find a contact")).toBeVisible();
  await expect(actions.getByText("Send message")).toBeVisible();
  await expect(actions.locator("li")).toHaveCount(11);

  // Every row says whose it is, which is the one thing a mixed list needs.
  await expect(actions.getByText("Verdant Market")).toHaveCount(4);
  await expect(actions.getByText("Amber & Oak")).toHaveCount(3);
  await expect(actions.getByText("Northstar Dispatch")).toHaveCount(4);
});

/**
 * Narrowing still works, because the tests and the fallback both need it.
 *
 * `?source=` is not offered anywhere on the page. It survives so a spec can
 * assert about one site's tools without another's arriving in the middle, and
 * so anybody demonstrating a single site on a connection that will not carry
 * several iframes has a way to.
 */
test("a session can still be narrowed to one deployed site", async ({ page }) => {
  await page.goto(`${CONSOLE}/demo?session=${freshCode()}&source=reservations&mode=glasses`);
  await expect(page.getByText("WebMCP is not enabled")).toHaveCount(0);

  const actions = page.getByTestId("actions");
  await expect(actions.locator("li")).toHaveCount(3);
  await expect(actions.getByText("Add to cart")).toHaveCount(0);
  await expect(page.locator('iframe[title="Verdant Market"]')).toHaveCount(0);
});

test("a gesture on the deployed Display changes the deployed market", async ({ browser }) => {
  const ctx = await browser.newContext();
  const consolePage = await ctx.newPage();
  const displayPage = await ctx.newPage();
  const code = freshCode();

  await consolePage.goto(`${CONSOLE}/demo?session=${code}&mode=glasses`);
  await expect(consolePage.getByText("Add to cart")).toBeVisible();

  // The Display connects over wss:// to a relay on a different host entirely.
  await displayPage.goto(`${DISPLAY}/?session=${code}`);
  await expect(displayPage.getByRole("heading", { name: "Choose a site" })).toBeVisible();

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
  const code = freshCode();

  await consolePage.goto(`${CONSOLE}/demo?session=${code}&mode=glasses`);
  await expect(consolePage.getByText(/for this browser's agent/)).toBeVisible();

  await displayPage.goto(`${DISPLAY}/?session=${code}`);
  await expect(displayPage.getByRole("heading", { name: "Choose a site" })).toBeVisible();

  const status = await consolePage.evaluate(async () => {
    const mc = (document as unknown as { modelContext: ModelContextLike }).modelContext;
    const tools = await mc.getTools();
    const t = tools.find((x) => x.name === "get_display_status");
    if (!t) throw new Error("Dusky registered no get_display_status tool");
    return JSON.parse(await mc.executeTool(t, JSON.stringify({}))) as Record<string, unknown>;
  });

  expect(status).toMatchObject({ ok: true, session: code, display_connected: true });
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
test("one spoken request becomes a two-step cross-site result-sharing task", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const consolePage = await ctx.newPage();
  const displayPage = await ctx.newPage();
  const code = freshCode();

  await consolePage.goto(`${CONSOLE}/demo?session=${code}&mode=glasses`);
  await expect(consolePage.getByText(/for this browser's agent/)).toBeVisible();

  await displayPage.goto(`${DISPLAY}/?session=${code}`);
  await expect(displayPage.getByRole("heading", { name: "Choose a site" })).toBeVisible();

  const sent = await consolePage.evaluate(async () => {
    const mc = (document as unknown as { modelContext: ModelContextLike }).modelContext;
    const tools = await mc.getTools();
    const t = tools.find((x) => x.name === "send_task_to_display");
    if (!t) throw new Error("no send_task_to_display tool");
    return JSON.parse(
      await mc.executeTool(
        t,
        JSON.stringify({
          text: "Reserve a table for four, then send the reservation details to Dana",
        }),
      ),
    ) as Record<string, unknown>;
  });

  console.log("send_task_to_display ->", JSON.stringify(sent, null, 2));
  expect(sent["ok"], `relay refused the task: ${String(sent["error"])}`).toBe(true);
  expect(sent["task"]).toEqual({ current: 1, total: 2, remaining: 1 });

  // The wearer is now inside the first action. Which frame it is depends on
  // whether the model could fill the table arguments directly or planned a
  // same-origin lookup first. The task count above is the deployment-level
  // proof that the second business was not silently dropped.
  await expect(displayPage.locator('[data-kind="choose"], [data-kind="confirm"]')).toBeVisible({
    timeout: 60_000,
  });
  const kind = await displayPage.locator("[data-kind]").first().getAttribute("data-kind");
  const heading = await displayPage.locator("h1").first().textContent();
  console.log(`display is showing a "${kind}" frame titled "${heading?.trim()}"`);

  await ctx.close();
});
