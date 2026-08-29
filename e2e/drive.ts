import { expect, type FrameLocator, type Page } from "@playwright/test";

/**
 * Driving the Display the way the glasses do.
 *
 * Arrow keys move focus, Enter activates. Never assume a menu order, because
 * `getTools` ordering is the browser's business and not something the product
 * should depend on. Clicking a row looked equivalent and was not: `useDpad`
 * selects whatever is under ITS index, so a click aimed at a row only worked
 * while that row happened to be the one under the wearer's thumb.
 *
 * This lived in four copies across the suite, which is how one of them learned
 * about pagination and the other three did not.
 */

/** Focus is marked in the DOM, on buttons and on the composer's input alike. */
const FOCUSED = '[data-focused="true"]';

/** Enough presses to visit every row of a frame, plus slack for the wrap. */
const MAX_PRESSES = 10;

/** How many pages "More" is followed through before giving up. It wraps. */
const MAX_PAGES = 4;

/**
 * Move focus onto a matching row, if one is on THIS page.
 *
 * Answers rather than throwing, because paging has to ask whether there is a
 * "More" row before it presses one. The composer's input is focusable and its
 * `textContent` is empty, so it never matches and is simply passed over.
 */
async function tryFocus(page: Page, label: RegExp): Promise<boolean> {
  for (let i = 0; i < MAX_PRESSES; i += 1) {
    const focused = await page.locator(FOCUSED).textContent();
    if (focused && label.test(focused)) return true;
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(60);
  }
  return false;
}

/**
 * Focus a row, following "More" onto whatever page it is actually on.
 *
 * Paging is not optional and never was. The menu paginates at `MAX_CHOICES`,
 * and two things push a gated tool off page one: `menuOrder` sorts by what a
 * press costs, so every read comes first, and the composer takes a permanent
 * slot whenever the deployment has a planner. `add_to_cart` was on page one
 * when this suite was written and is not any more, which is why asserting it
 * directly went stale against the deployment.
 *
 * Bounded because "More" wraps rather than clamps, so a few presses visit every
 * page and then start again. A frame with no "More" on it costs one extra sweep
 * and then fails, which is what a caller expecting a confirmation wants.
 */
/** Every page of the frame currently on screen, without leaving it. */
async function focusHere(page: Page, label: RegExp): Promise<boolean> {
  for (let p = 0; p < MAX_PAGES; p += 1) {
    if (await tryFocus(page, label)) return true;
    if (!(await tryFocus(page, /More/))) return false;
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
  }
  return false;
}

/**
 * Focus a row, wherever in the menu it actually lives.
 *
 * Two things can stand between a wearer and an action, and a test that knows
 * about only one of them goes stale the moment the other appears. "More" pages
 * within a frame. A site row opens one business's actions, which is what the
 * menu offers instead of a flat list when several sites are held and their
 * tools will not fit on a four-row panel.
 *
 * Sites are tried in turn and backed out of with Escape, because a test cannot
 * know which business publishes a given action without hardcoding exactly the
 * knowledge this product refuses to hold.
 */
export async function focusChoice(page: Page, label: RegExp | string): Promise<void> {
  const matcher = typeof label === "string" ? new RegExp(label) : label;
  if (await focusHere(page, matcher)) return;

  // Not on this frame. If it offers sites, look inside each of them.
  const sites = await page.locator("button", { hasText: /\d+ actions?$/ }).count();
  for (let i = 0; i < sites; i += 1) {
    const row = page.locator("button", { hasText: /\d+ actions?$/ }).nth(i);
    if ((await row.count()) === 0) break;
    await row.click();
    await page.waitForTimeout(300);
    if (await focusHere(page, matcher)) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  throw new Error(`never focused a choice matching ${String(label)} anywhere in the menu`);
}

/**
 * Assert a row is reachable, which is not the same as asserting it is visible.
 *
 * `expect(getByRole("button", ...)).toBeVisible()` is the natural thing to
 * write and it is wrong about a paginated menu: the row is not in the DOM until
 * the wearer pages to it, so a perfectly reachable action reads as a missing
 * one. It was right for as long as every tool fitted on one screen, which
 * stopped being true when Dusky started holding more than one site.
 *
 * Reachability is the property that actually matters to a wearer, and focus is
 * how you demonstrate it. This leaves the row focused, which is where a caller
 * wanting to press it needs it anyway.
 */
export async function expectReachable(page: Page, label: RegExp | string): Promise<void> {
  await focusChoice(page, label);
}

/* ------------------------------------------------- the panel inside a page */

/**
 * The same paging, for the panel embedded in the console.
 *
 * A separate function rather than a parameter, because the two are driven by
 * different means and neither is wrong. On its own tab the Display owns the
 * keyboard and a test presses arrows exactly as a wearer's gestures do. Inside
 * an iframe the keyboard belongs to the outer document and `[data-focused]`
 * cannot be read across the boundary, so the panel is driven by clicking, which
 * routes through the row's own `onClick` and therefore picks the row that was
 * clicked rather than whichever one `useDpad` had its index on.
 */
/** A row on the panel, on whatever page it is on. Returns null if unreachable. */
async function reach(lens: FrameLocator, label: RegExp) {
  for (let p = 0; p < MAX_PAGES; p += 1) {
    /*
     * Wait for the panel to be showing something before reading it.
     *
     * `count()` answers immediately and does not retry, unlike `expect`, so
     * asking an iframe that has not rendered yet returns zero and reads as "the
     * row is not here" about a panel that has not decided what to show. The
     * pairing frame, the empty menu and the real menu all have buttons; only
     * the moment before the first frame arrives has none.
     */
    await lens.getByRole("button").first().waitFor();

    const target = lens.getByRole("button", { name: label });
    if ((await target.count()) > 0) return target.first();

    const more = lens.getByRole("button", { name: /More/ });
    if ((await more.count()) === 0) return null;

    // The next page comes back from the RELAY, so turning it is a round trip
    // rather than a re-render. The "More" row's own counter is the only thing
    // on the frame guaranteed to differ between one page and the next, so it
    // is what tells us the new page has landed.
    const before = await more.first().textContent();
    await more.first().click();
    await expect
      .poll(async () => (await more.count()) === 0 || (await more.first().textContent()) !== before)
      .toBe(true);
  }
  return null;
}

/** A site row: the count of what is behind it is what marks one. */
const SITE_ROW = /\d+ actions?$/;

/**
 * Reach a row on the embedded panel, stepping into sites as well as paging.
 *
 * The panel offers a row per site instead of a flat list when several sites
 * are held and their actions will not fit. Sites are tried in turn and backed
 * out of with Escape, because knowing which business publishes a given action
 * is exactly the knowledge this product refuses to hold.
 */
const siteRows = (lens: FrameLocator) => lens.getByRole("button", { name: SITE_ROW });

/**
 * Get back to the top of the menu, if the panel is inside a site.
 *
 * A previous call leaves the panel wherever it found what it was looking for,
 * which for a grouped menu is inside one business. The next call then sees no
 * site rows, concludes there are none, and reports a perfectly reachable action
 * as missing. Escape is how a wearer steps out and it is how this does too.
 *
 * Answers false for a menu that is not grouped at all, which is a single site
 * or a set small enough to fit flat. That is not a failure.
 */
async function toTop(lens: FrameLocator): Promise<boolean> {
  if ((await siteRows(lens).count()) > 0) return true;
  await lens.owner().press("Escape");
  try {
    await expect.poll(async () => siteRows(lens).count(), { timeout: 3_000 }).toBeGreaterThan(0);
    return true;
  } catch {
    return false;
  }
}

async function reachAnywhere(lens: FrameLocator, label: RegExp) {
  const here = await reach(lens, label);
  if (here) return here;
  if (!(await toTop(lens))) return null;

  const count = await siteRows(lens).count();
  for (let i = 0; i < count; i += 1) {
    const row = siteRows(lens).nth(i);
    if ((await row.count()) === 0) break;
    await row.click();
    // Wait for the site's own menu rather than guessing at a delay: its rows
    // are not site rows, so their absence is what "we are inside" looks like.
    await expect.poll(async () => siteRows(lens).count(), { timeout: 10_000 }).toBe(0);
    const found = await reach(lens, label);
    if (found) return found;
    await lens.owner().press("Escape");
    await expect.poll(async () => siteRows(lens).count(), { timeout: 10_000 }).toBeGreaterThan(0);
  }
  return null;
}

/**
 * Assert a row can be reached on the embedded panel, and leave it reachable.
 *
 * `toBeVisible` on a paginated menu asserts the wrong thing: a row a wearer can
 * get to in one press is not in the DOM until they press it.
 */
export async function expectReachableIn(lens: FrameLocator, label: RegExp): Promise<void> {
  const row = await reachAnywhere(lens, label);
  if (!row) throw new Error(`no row matching ${String(label)} on any page of the panel`);
}

/** Press a row on the embedded panel, paging to it first if it is not here. */
export async function clickChoiceIn(lens: FrameLocator, label: RegExp): Promise<void> {
  const row = await reachAnywhere(lens, label);
  if (!row) throw new Error(`no row matching ${String(label)} on any page of the panel`);
  await row.click();
}
