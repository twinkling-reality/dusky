import { expect, type Page, test } from "@playwright/test";

/**
 * Dusky as a WebMCP PROVIDER, against real Chrome.
 *
 * Everywhere else Dusky consumes another site's tools. This proves the other
 * direction: an agent sitting in the browser calls Dusky's own registered
 * tools and drives a pair of glasses. That is the whole reason a person can
 * operate a participating website from a wearable without either side building
 * anything for the other.
 *
 * The calls below go through `document.modelContext.executeTool`, which is
 * exactly the path the browser's built-in agent takes. Nothing is mocked.
 */

// No I, L or O: those are the letters SESSION_CODE_ALPHABET drops because
// they are the ones misread off a waveguide. "PROV01" had digits and an O.
const CODE = "PRVDER";

/** Arguments go as a JSON string: Chrome 151 rejects an object. */
async function callDuskyTool(page: Page, name: string, args: Record<string, unknown> = {}) {
  const raw = await page.evaluate(
    async ([toolName, encoded]) => {
      const mc = (document as unknown as { modelContext: ModelContextLike }).modelContext;
      const tools = await mc.getTools();
      const tool = tools.find((t) => t.name === toolName);
      if (!tool) throw new Error(`Dusky did not register ${toolName}`);
      return mc.executeTool(tool, encoded);
    },
    [name, JSON.stringify(args)] as const,
  );
  return JSON.parse(raw) as Record<string, unknown>;
}

interface ModelContextLike {
  getTools(o?: { fromOrigins?: string[] }): Promise<{ name: string }[]>;
  executeTool(tool: unknown, input?: unknown): Promise<string>;
}

/**
 * Drive the Display exactly as the glasses do: arrow keys move focus, Enter
 * activates whatever the d-pad is on.
 *
 * Pressing Enter on the button itself is not the same act. `useDpad` keeps its
 * own index and selects THAT, so a press aimed at a row only worked while the
 * row happened to be the one under the wearer's thumb, which meant this test
 * quietly depended on `add_to_cart` being first. It is not first any more, and
 * per AGENTS.md it was never something to depend on. Same helper as
 * `e2e/roundtrip.spec.ts`, for the same reason.
 */
async function focusChoice(page: Page, label: RegExp) {
  for (let i = 0; i < 8; i += 1) {
    const focused = await page.locator('[data-focused="true"]').textContent();
    if (focused && label.test(focused)) return;
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(60);
  }
  throw new Error(`never focused a choice matching ${String(label)}`);
}

test("an agent in the browser can inspect and drive a Dusky session", async ({ browser }) => {
  const ctx = await browser.newContext();
  const consolePage = await ctx.newPage();
  const displayPage = await ctx.newPage();

  await consolePage.goto(`http://localhost:7803/demo?session=${CODE}&mode=glasses`);
  // Read off the activity log rather than the status strip. The strip carried
  // this as a fourth mono fact nobody on this page can act on, and the log
  // prints it verbatim anyway.
  await expect(consolePage.getByText("registered Dusky's own 4 tools")).toBeVisible();
  // Dusky's own tools are registered as soon as the page loads, which is
  // BEFORE the relay has finished discovering the partner's. Pairing used to
  // take a form fill and two clicks, which hid that gap; a code in the URL
  // does not. Wait for discovery, or the agent asks an empty session.
  await expect(consolePage.getByTestId("actions").locator("li")).toHaveCount(4);

  // Registering our own tools must not pollute what the WEARER sees. Chrome
  // returns this document's own tools from getTools({fromOrigins}) even when
  // fromOrigins names only the partner, so @dusky/webmcp filters them out.
  const actions = await callDuskyTool(consolePage, "list_display_actions");
  expect(actions["ok"]).toBe(true);
  const names = (actions["actions"] as { name: string }[]).map((a) => a.name).sort();
  expect(names).toEqual(["add_to_cart", "empty_cart", "review_cart", "search_products"]);

  // An agent is told the ceremony Dusky will enforce, so it can be honest with
  // the person instead of promising something it cannot complete alone.
  const byName = Object.fromEntries(
    (actions["actions"] as { name: string; consequence: string; needsApproval: boolean }[]).map(
      (a) => [a.name, a],
    ),
  );
  expect(byName["search_products"]).toMatchObject({ consequence: "read", needsApproval: false });
  expect(byName["add_to_cart"]).toMatchObject({ consequence: "financial", needsApproval: true });
  expect(byName["empty_cart"]).toMatchObject({ consequence: "destructive", needsApproval: true });

  // No glasses yet, so Dusky refuses a task and says how to fix it.
  const before = await callDuskyTool(consolePage, "send_task_to_display", { text: "add oat milk" });
  expect(before["ok"]).toBe(false);
  expect(String(before["error"])).toContain(CODE);

  await displayPage.goto(`http://localhost:7802/?session=${CODE}`);
  await expect(displayPage.getByRole("button", { name: /Add to cart/ })).toBeVisible();

  const status = await callDuskyTool(consolePage, "get_display_status");
  expect(status).toMatchObject({ ok: true, session: CODE, display_connected: true, state: "idle" });

  /* ---- the constraint that makes this safe to expose at all ---- */

  // Put the wearer in front of a confirmation, the way a gesture would.
  await focusChoice(displayPage, /Add to cart/);
  await displayPage.keyboard.press("Enter");
  const compose = displayPage.locator('input[type="text"]');
  await expect(compose).toBeVisible();
  await compose.fill("oat-1");
  await compose.press("Enter");
  await expect(displayPage.getByRole("button", { name: /Confirm/ })).toBeVisible();

  const busy = await callDuskyTool(consolePage, "get_display_status");
  expect(busy).toMatchObject({ state: "confirm_required", accepting_tasks: false });

  // An agent must not be able to swap what is about to be approved while the
  // wearer is looking at it and their gesture is already under way.
  const interrupt = await callDuskyTool(consolePage, "send_task_to_display", {
    text: "empty my cart instead",
  });
  expect(interrupt["ok"]).toBe(false);
  expect(String(interrupt["error"])).toContain("approve an action");

  // The wearer is still looking at exactly what they were looking at.
  await expect(displayPage.getByRole("button", { name: /Confirm/ })).toBeVisible();
  await expect(displayPage.getByText("oat-1")).toBeVisible();
  // And the partner site was never touched.
  await expect(consolePage.frameLocator("iframe").getByTestId("cart")).toHaveText("empty");

  // Cancelling is always allowed, because it can only ever stop something.
  const cancelled = await callDuskyTool(consolePage, "cancel_active_task");
  expect(cancelled).toMatchObject({ ok: true, state: "idle" });
  await expect(displayPage.getByRole("button", { name: /Add to cart/ })).toBeVisible();

  await ctx.close();
});
