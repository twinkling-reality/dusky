import { expect, test } from "@playwright/test";
import { clickChoiceIn, expectReachableIn } from "./drive.js";

/**
 * The path a judge actually takes.
 *
 * Nobody arriving at Dusky owns a pair of glasses, and the first thing they
 * used to meet was a form asking for a code off a lens they do not have. This
 * covers the replacement: one click, no typing, everything in one tab.
 */

const SITE = "http://localhost:7803";

test("the front door states what it is, once, without an acronym in the headline", async ({
  page,
}) => {
  await page.goto(SITE);

  // Exactly one h1, and it is the page's own: the panel in the examples drops
  // to an h2 so it does not compete with the document around it.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Turn web actions into augmented reality.",
  );

  // No acronym in the headline itself. The subtitle names the protocol once,
  // which is where a judge scoring WebMCP leverage looks and where it costs a
  // stranger one clause rather than the whole hero.
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText("WebMCP");
  await expect(page.locator("main")).toContainText(
    "Dusky uses WebMCP to turn website capabilities into dynamic, actionable interfaces for AR displays.",
  );
});

test("the front door offers both ways in as controls, and asks once", async ({ page }) => {
  await page.goto(SITE);

  /*
   * The same question used to be asked twice: a button and a floating
   * underlined sentence here, then an equal-choice screen behind /demo.
   * The two routes now stay distinct all the way through the handoff.
   */
  const actions = page.locator("main").getByRole("link");
  await expect(actions.filter({ hasText: "Open Dusky" })).toHaveCount(1);
  await expect(actions.filter({ hasText: "I have glasses" })).toHaveCount(1);
  await expect(page.getByText(/pair them instead/i)).toHaveCount(0);

  // Requirements is a verdict, not a third way in, so it is not in that row.
  await expect(page.locator("main").getByRole("button", { name: /Requirements/ })).toHaveCount(0);
  await expect(
    page.getByRole("banner").getByRole("button", { name: /Requirements/ }),
  ).toBeVisible();

  // And the second one lands on the card that explains pairing.
  await actions.filter({ hasText: "I have glasses" }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole("heading", { name: "Connect your display." })).toBeVisible();
  await expect(page.getByLabel("Six-letter pairing code")).toBeVisible();
  await expect(page.locator("#pair-instruction")).toHaveText(
    "Enter the six-letter code shown on your lens.",
  );
});

test("the requirements are one press away, and stated whether or not this browser meets them", async ({
  page,
}) => {
  await page.goto(SITE);

  // Shut by default, always. Nothing on this page opens itself over the
  // product: the button below carries the verdict whether or not it is good.
  await expect(page.getByRole("region", { name: "Requirements" })).toHaveCount(0);

  const button = page.getByRole("button", { name: /Requirements/ });
  await expect(button).toHaveAttribute("data-state", "ok");
  await expect(button).toHaveAccessibleName(/all met/);

  await button.click();
  const panel = page.getByRole("region", { name: "Requirements" });

  // All three are stated, including the two that passed. A requirement that
  // only appears once it is unmet is a requirement nobody read in time. Each
  // is a subject and this browser's answer, with no sentence between them.
  await expect(panel.getByText("WebMCP", { exact: true })).toBeVisible();
  await expect(panel.getByText("Tool registration", { exact: true })).toBeVisible();
  await expect(panel.getByText("Relay", { exact: true })).toBeVisible();
  await expect(panel.getByText("enabled", { exact: true })).toBeVisible();
  await expect(panel.getByText("connected", { exact: true })).toBeVisible();

  // And they are probed, not decorative: Chrome with the flag is exactly what
  // this suite runs, so all three have to come back met.
  await expect(panel.getByText("3/3", { exact: true })).toBeVisible();

  // It closes the way everything closes.
  await button.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Requirements" })).toHaveCount(0);
});

test("a browser that cannot run Dusky is told which part is missing, with nothing opening itself", async ({
  page,
}) => {
  // The judge who has not set the flag is the one visitor who must not have to
  // go looking. The button says which requirement failed, so the answer is on
  // screen without a panel landing over the thing they came to see.
  await page.addInitScript(() => {
    Object.defineProperty(document, "modelContext", { get: () => undefined, configurable: true });
  });
  await page.goto(SITE);

  const button = page.getByRole("button", { name: "WebMCP not enabled" });
  await expect(button).toHaveAttribute("data-state", "bad");
  await expect(page.getByRole("region", { name: "Requirements" })).toHaveCount(0);

  await button.click();
  const panel = page.getByRole("region", { name: "Requirements" });

  // One instruction, under the line that failed, and no paragraph above it
  // explaining why the requirement exists.
  await expect(panel.getByText(/^Turn on/)).toBeVisible();
  await expect(panel.getByText("chrome://flags/#enable-webmcp-testing")).toBeVisible();

  // Untestable is not failed. With no API there is nothing to register against,
  // and saying so beats inventing either answer.
  await expect(panel.getByText("not tested", { exact: true })).toBeVisible();
});

test("the front door carries the product, not a demonstration of it", async ({ page }) => {
  await page.goto(SITE);

  // /method is gone. It was ten rebuilds of a schema printed beside the screen
  // it compiled to, and a schema does not read at a glance: every version took
  // a minute to land an idea the page promised in five seconds. The recorded
  // demo carries that argument now, so no page here has to.
  await expect(page.getByLabel("Tool definition")).toHaveCount(0);
  await expect(page.locator("div[data-kind]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Method" })).toHaveCount(0);

  // A page arguing that six keys are enough cannot need a mouse at its door.
  const open = page.getByRole("link", { name: /Open Dusky/ });
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/demo/);
});

test("one click opens a running Dusky, pre-paired, with nothing else to press", async ({
  page,
}) => {
  await page.goto(SITE);
  await page.getByRole("link", { name: "Open Dusky" }).click();
  await expect(page).toHaveURL(/\/demo/);

  // No second button. The front door used to land on a page whose middle was
  // another button, which is most of why its own label had to be "the demo".
  await expect(page.getByRole("button", { name: /Try it now/ })).toHaveCount(0);

  // A code was minted and put in the URL, so the session is shareable and
  // survives a reload. `start` is spent, not carried: a link with it still in
  // would mint a second session for whoever opened it.
  await expect(page).toHaveURL(/session=[A-Z]{6}/);
  await expect(page).not.toHaveURL(/start=/);

  // Everything in one tab: the glasses view, every partner site, and a
  // user-facing action history. All three pages are visible by default.
  const lens = page.frameLocator('iframe[title="Dusky on the glasses"]');
  await expectReachableIn(lens, /Add to cart/);
  await expect(page.frameLocator('iframe[title="Verdant Market"]').getByTestId("cart")).toHaveText(
    "empty",
  );
  // The second business, in the same tab, at the same time. This is the claim
  // the whole product makes and it is one assertion: unrelated sites that have
  // never heard of each other, live and reachable from one menu.
  await expect(page.frameLocator('iframe[title="Amber & Oak"]').getByTestId("book")).toHaveText(
    "none",
  );
  await expect(
    page.frameLocator('iframe[title="Northstar Dispatch"]').getByTestId("outbox"),
  ).toHaveText("none sent");
  await expectReachableIn(lens, /Book table/);
  await expectReachableIn(lens, /Send message/);
  await expect(page.getByRole("region", { name: "Technical log" })).toBeVisible();
  const runtime = page.locator("[data-runtime-status]");
  await expect(runtime.getByText("11 actions", { exact: true })).toBeVisible();
  await expect(runtime.getByText("across 3 websites", { exact: true })).toBeVisible();
  await expect(page.locator('[data-node-id^="provider:"][data-inspected]')).toHaveCount(3);

  // The thing a judge must not have to discover by closing the tab. A footnote
  // at the end now, rather than a briefing sitting above the product.
  await expect(page.getByText("Closing this tab ends the session.")).toBeVisible();

  // No pair code on this page. It is a thing a wearer reads off a lens and
  // types in, and in this mode the page minted it, opened the Display and
  // paired itself. It lives on the pairing page, where somebody who actually
  // has glasses arrives.
  await expect(page.getByText("Pair code")).toHaveCount(0);

  // The header carries a way back and the requirements, and no session
  // plumbing. It used to print the code and the relay state, both of which the
  // page already showed below it, and a six letter code in the navigation of a
  // website reads as a glitch.
  const banner = page.getByRole("banner");
  await expect(banner.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(banner.getByText(/^[A-Z]{6}$/)).toHaveCount(0);
  await expect(banner.getByRole("region", { name: "Technical log" })).toHaveCount(0);

  // All three live pages may make the document taller, but nothing may widen
  // the viewport or disappear behind a horizontal scroll area.
  await page.setViewportSize({ width: 1440, height: 900 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("browser runtime and technical log are distinct, legible components", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${SITE}/demo?start=1`);
  await expect(page.getByTestId("actions").locator("li")).toHaveCount(11);

  const activity = page.getByRole("region", { name: "Technical log" });
  await expect(activity).toBeVisible();
  await expect(activity.getByRole("heading", { name: "Technical log" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Browser runtime" })).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(activity.getByText("No actions in this session.", { exact: true })).toBeVisible();
  await expect(activity).not.toContainText(
    /registry|discovery|tools changed|provider origins|localhost/i,
  );
  await expect(page.getByRole("button", { name: /technical log/i })).toHaveCount(0);

  await expect(page.getByRole("group", { name: "Action approval key" })).toHaveCount(0);
  const actionCards = page.locator('[data-node-id^="actions:"]');
  await expect(actionCards.getByText("approval required", { exact: true })).toHaveCount(6);
  await expect(actionCards.getByText("no approval needed", { exact: true })).toHaveCount(5);
  await expect(page.getByText("live page", { exact: true })).toHaveCount(0);

  for (const provider of ["Verdant Market", "Amber & Oak", "Northstar Dispatch"]) {
    await expect(
      page.frameLocator(`iframe[title="${provider}"]`).locator("body"),
    ).not.toContainText("Part of Dusky");
  }

  const geometry = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("[data-runtime-panel]");
    const activity = document.querySelector<HTMLElement>("[data-runtime-activity]");
    const events = activity?.querySelector<HTMLElement>("ol");
    const runtimeCard = document.querySelector<HTMLElement>("[data-runtime-status]");
    const display = document.querySelector<HTMLElement>('[data-node-id="display"]');
    const providers = Array.from(
      document.querySelectorAll<HTMLElement>('[data-node-id^="provider:"]'),
    );
    if (!panel || !activity || !events || !runtimeCard || !display) {
      throw new Error("Runtime topology geometry is missing");
    }
    const panelBox = panel.getBoundingClientRect();
    const activityBox = activity.getBoundingClientRect();
    const runtimeBox = runtimeCard.getBoundingClientRect();
    const initiallyEmpty = activity.hasAttribute("data-empty");
    const overlaps = (box: DOMRect) =>
      panelBox.left < box.right &&
      panelBox.right > box.left &&
      panelBox.top < box.bottom &&
      panelBox.bottom > box.top;
    const emptyEventsHeight = events.getBoundingClientRect().height;
    const runtimeTitle = runtimeCard.querySelector<HTMLElement>("h2");
    const runtimeState = runtimeCard.querySelector<HTMLElement>('[role="status"]');
    const runtimeMetric = runtimeCard.querySelector<HTMLElement>("p strong");
    const runtimeQualifier = runtimeCard.querySelector<HTMLElement>("p span");
    const logTitle = activity.querySelector<HTMLElement>("h2");
    const logBody =
      activity.querySelector<HTMLElement>("p") ?? activity.querySelector<HTMLElement>("li strong");
    if (
      !runtimeTitle ||
      !runtimeState ||
      !runtimeMetric ||
      !runtimeQualifier ||
      !logTitle ||
      !logBody
    ) {
      throw new Error("Runtime typography is missing");
    }
    const typography = {
      families: [
        runtimeTitle,
        runtimeState,
        runtimeMetric,
        runtimeQualifier,
        logTitle,
        logBody,
      ].map((element) => getComputedStyle(element).fontFamily),
      runtimeTitle: Number.parseFloat(getComputedStyle(runtimeTitle).fontSize),
      runtimeState: Number.parseFloat(getComputedStyle(runtimeState).fontSize),
      runtimeMetric: Number.parseFloat(getComputedStyle(runtimeMetric).fontSize),
      runtimeQualifier: Number.parseFloat(getComputedStyle(runtimeQualifier).fontSize),
      logTitle: Number.parseFloat(getComputedStyle(logTitle).fontSize),
      logBody: Number.parseFloat(getComputedStyle(logBody).fontSize),
    };
    activity.removeAttribute("data-empty");
    activity.querySelector("p")?.remove();
    let sample = events.querySelector("li");
    if (!sample) {
      sample = document.createElement("li");
      sample.innerHTML =
        "<span><strong>Search catalog</strong><span>Verdant Market</span></span><span>Returned</span>";
      events.append(sample);
    }
    const eventLabel = sample.querySelector<HTMLElement>("span");
    if (!eventLabel) throw new Error("Runtime activity has no event label");
    const panelStyle = getComputedStyle(panel);
    const runtimeStyle = getComputedStyle(runtimeCard);
    const activityStyle = getComputedStyle(activity);
    const rowStyle = getComputedStyle(sample);
    const labelStyle = getComputedStyle(eventLabel);
    for (let index = events.children.length; index < 31; index += 1) {
      events.append(sample.cloneNode(true));
    }
    return {
      width: panelBox.width,
      emptyHeight: panelBox.height,
      emptyEventsHeight,
      initiallyEmpty,
      logInsetLeft: activityBox.left - runtimeBox.left,
      logInsetRight: runtimeBox.right - activityBox.right,
      sectionGap: activityBox.top - runtimeBox.bottom,
      activityContained:
        activityBox.left >= panelBox.left &&
        activityBox.right <= panelBox.right &&
        activityBox.top >= panelBox.top &&
        activityBox.bottom <= panelBox.bottom,
      overlapsDisplay: overlaps(display.getBoundingClientRect()),
      overlapsProvider: providers.some((provider) => overlaps(provider.getBoundingClientRect())),
      eventOverflow: getComputedStyle(events).overflowY,
      eventClientHeight: events.clientHeight,
      eventScrollHeight: events.scrollHeight,
      panelClipped:
        panel.scrollWidth > panel.clientWidth || panel.scrollHeight > panel.clientHeight,
      chrome: {
        panelBorderTop: panelStyle.borderTopWidth,
        panelBorderRight: panelStyle.borderRightWidth,
        panelBorderBottom: panelStyle.borderBottomWidth,
        panelBorderLeft: panelStyle.borderLeftWidth,
        panelRadius: panelStyle.borderRadius,
        panelBackground: panelStyle.backgroundColor,
        panelShadow: panelStyle.boxShadow,
        runtimeBorderTop: runtimeStyle.borderTopWidth,
        runtimeBorderRight: runtimeStyle.borderRightWidth,
        runtimeBorderBottom: runtimeStyle.borderBottomWidth,
        runtimeBorderLeft: runtimeStyle.borderLeftWidth,
        runtimeRadius: runtimeStyle.borderRadius,
        runtimeBackground: runtimeStyle.backgroundColor,
        runtimeShadow: runtimeStyle.boxShadow,
        activityBorderTop: activityStyle.borderTopWidth,
        activityBorderRight: activityStyle.borderRightWidth,
        activityBorderBottom: activityStyle.borderBottomWidth,
        activityBorderLeft: activityStyle.borderLeftWidth,
        activityRadius: activityStyle.borderRadius,
        activityRadiusTopLeft: activityStyle.borderTopLeftRadius,
        activityRadiusTopRight: activityStyle.borderTopRightRadius,
        activityRadiusBottomLeft: activityStyle.borderBottomLeftRadius,
        activityRadiusBottomRight: activityStyle.borderBottomRightRadius,
        activityBackground: activityStyle.backgroundColor,
        activityShadow: activityStyle.boxShadow,
        rowRadius: rowStyle.borderRadius,
        rowBackground: rowStyle.backgroundColor,
        labelRadius: labelStyle.borderRadius,
        labelBackground: labelStyle.backgroundColor,
      },
      typography,
      pageOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(14 * 16);
  expect(geometry.emptyHeight).toBeLessThanOrEqual(12 * 16);
  if (geometry.initiallyEmpty) expect(geometry.emptyEventsHeight).toBe(0);
  expect(geometry.logInsetLeft).toBeCloseTo(16, 0);
  expect(geometry.logInsetRight).toBeCloseTo(16, 0);
  expect(geometry.sectionGap).toBeGreaterThanOrEqual(-13);
  expect(geometry.sectionGap).toBeLessThanOrEqual(-11);
  expect(geometry.activityContained).toBe(true);
  expect(geometry.overlapsDisplay).toBe(false);
  expect(geometry.overlapsProvider).toBe(false);
  expect(geometry.eventOverflow).toBe("auto");
  expect(geometry.eventScrollHeight).toBeGreaterThan(geometry.eventClientHeight);
  expect(geometry.panelClipped).toBe(false);
  expect(geometry.chrome.panelBorderTop).toBe("0px");
  expect(geometry.chrome.panelBorderRight).toBe("0px");
  expect(geometry.chrome.panelBorderBottom).toBe("0px");
  expect(geometry.chrome.panelBorderLeft).toBe("0px");
  expect(geometry.chrome.panelRadius).toBe("0px");
  expect(geometry.chrome.panelBackground).toBe("rgba(0, 0, 0, 0)");
  expect(geometry.chrome.panelShadow).toBe("none");
  expect(geometry.chrome).toMatchObject({
    runtimeBorderTop: "1px",
    runtimeBorderRight: "1px",
    runtimeBorderBottom: "1px",
    runtimeBorderLeft: "1px",
    activityBorderTop: "0px",
    activityBorderRight: "1px",
    activityBorderBottom: "1px",
    activityBorderLeft: "1px",
    rowRadius: "0px",
    rowBackground: "rgba(0, 0, 0, 0)",
    labelRadius: "0px",
    labelBackground: "rgba(0, 0, 0, 0)",
  });
  expect(Number.parseFloat(geometry.chrome.runtimeRadius)).toBeGreaterThanOrEqual(16);
  expect(geometry.chrome.runtimeBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(geometry.chrome.runtimeShadow).not.toBe("none");
  expect(geometry.chrome.activityRadiusTopLeft).toBe("0px");
  expect(geometry.chrome.activityRadiusTopRight).toBe("0px");
  expect(Number.parseFloat(geometry.chrome.activityRadiusBottomLeft)).toBeGreaterThanOrEqual(16);
  expect(Number.parseFloat(geometry.chrome.activityRadiusBottomRight)).toBeGreaterThanOrEqual(16);
  expect(geometry.chrome.activityBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(geometry.chrome.activityShadow).toBe("none");
  expect(new Set(geometry.typography.families).size).toBe(1);
  expect(geometry.typography.runtimeTitle).toBeGreaterThanOrEqual(15);
  expect(geometry.typography.logTitle).toBeCloseTo(geometry.typography.runtimeTitle, 1);
  expect(geometry.typography.runtimeState).toBeGreaterThanOrEqual(12);
  expect(geometry.typography.runtimeMetric).toBeLessThanOrEqual(16);
  expect(geometry.typography.runtimeQualifier).toBeGreaterThanOrEqual(12);
  expect(geometry.typography.logBody).toBeGreaterThanOrEqual(12);
  expect(geometry.pageOverflow).toBe(0);
});

test("runtime evidence remains readable in the phone topology flow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${SITE}/demo?start=1`);
  await expect(page.getByTestId("actions").locator("li")).toHaveCount(11);
  await expect(page.getByRole("region", { name: "Technical log" })).toContainText(
    "No actions in this session.",
  );

  const geometry = await page.evaluate(() => {
    const documentBox = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Mobile runtime element is missing: ${selector}`);
      const box = element.getBoundingClientRect();
      return {
        x: box.x + window.scrollX,
        y: box.y + window.scrollY,
        width: box.width,
        height: box.height,
        right: box.right + window.scrollX,
        bottom: box.bottom + window.scrollY,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
      };
    };
    const panel = documentBox("[data-runtime-panel]");
    const activity = documentBox("[data-runtime-activity]");
    const runtime = documentBox("[data-runtime-status]");
    const events = documentBox("[data-runtime-activity] ol");
    const firstProviderLabel = documentBox('[data-node-id^="provider:"] [id^="provider-label-"]');
    const firstProvider = documentBox('[data-node-id^="provider:"]');
    const activityElement = document.querySelector<HTMLElement>("[data-runtime-activity]");
    const panelElement = document.querySelector<HTMLElement>("[data-runtime-panel]");
    const runtimeElement = document.querySelector<HTMLElement>("[data-runtime-status]");
    if (!activityElement || !panelElement || !runtimeElement) {
      throw new Error("Mobile runtime layers are missing");
    }
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>("[data-runtime-activity] li"),
    ).map((row) => ({ clientHeight: row.clientHeight, scrollHeight: row.scrollHeight }));
    const runtimeBounds = runtimeElement.getBoundingClientRect();
    const runtimeTextContained = Array.from(
      runtimeElement.querySelectorAll<HTMLElement>("h2, [role='status'], p"),
    ).every((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        bounds.left >= runtimeBounds.left - 1 &&
        bounds.right <= runtimeBounds.right + 1 &&
        bounds.top >= runtimeBounds.top - 1 &&
        bounds.bottom <= runtimeBounds.bottom + 1
      );
    });
    return {
      panel,
      activity,
      runtime,
      events,
      firstProviderLabel,
      firstProvider,
      rows,
      runtimeTextContained,
      panelBackground: getComputedStyle(panelElement).backgroundColor,
      panelRadius: getComputedStyle(panelElement).borderRadius,
      activityBackground: getComputedStyle(activityElement).backgroundColor,
      activityRadius: getComputedStyle(activityElement).borderRadius,
      runtimeBackground: getComputedStyle(runtimeElement).backgroundColor,
      runtimeRadius: getComputedStyle(runtimeElement).borderRadius,
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });

  expect(geometry.runtime.width - geometry.activity.width).toBeCloseTo(32, 0);
  expect(geometry.activity.x + geometry.activity.width / 2).toBeCloseTo(
    geometry.runtime.x + geometry.runtime.width / 2,
    0,
  );
  expect(geometry.activity.y - geometry.runtime.bottom).toBeGreaterThanOrEqual(-13);
  expect(geometry.activity.y - geometry.runtime.bottom).toBeLessThanOrEqual(-11);
  expect(geometry.panel.height).toBeLessThanOrEqual(12 * 16);
  expect(geometry.firstProvider.y).toBeGreaterThanOrEqual(geometry.panel.bottom);
  expect(geometry.panel.bottom).toBeLessThanOrEqual(geometry.firstProviderLabel.y - 4);
  expect(geometry.runtime.scrollWidth).toBeLessThanOrEqual(geometry.runtime.clientWidth);
  expect(geometry.runtimeTextContained).toBe(true);
  expect(geometry.events.scrollHeight).toBeLessThanOrEqual(geometry.events.clientHeight);
  expect(geometry.rows.every((row) => row.scrollHeight <= row.clientHeight + 1)).toBe(true);
  expect(geometry.panelBackground).toBe("rgba(0, 0, 0, 0)");
  expect(geometry.panelRadius).toBe("0px");
  expect(geometry.activityBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(geometry.activityRadius).toBe("0px 0px 18px 18px");
  expect(geometry.runtimeBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(Number.parseFloat(geometry.runtimeRadius)).toBeGreaterThanOrEqual(16);
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
});

test("the demo says what you are looking at, when asked", async ({ page }) => {
  await page.goto(`${SITE}/demo?start=1`);
  // Eleven, because all three sites are held. Named rather than counted would be
  // better here, except that the count IS the claim on this page: the list is
  // one list, not one list per business.
  await expect(page.getByTestId("actions").locator("li")).toHaveCount(11);

  // Shut by default. This page carried a paragraph about the security model
  // above the fold and a caption under every heading, all of it cut because a
  // stranger did not need any of it. Cutting it left four labelled boxes and no
  // way to find out what they are.
  await expect(page.getByRole("region", { name: "What is this" })).toHaveCount(0);

  await page.getByRole("button", { name: "What is this?" }).click();
  const what = page.getByRole("region", { name: "What is this" });

  // Every box on the page is named, including the one holding the sites. That
  // box used to be labelled with the single site's name; no business name is
  // true above a box containing another business, so it is labelled plainly.
  await expect(what.getByText("Display preview", { exact: true })).toBeVisible();
  await expect(what.getByText("Connected websites", { exact: true })).toBeVisible();
  await expect(what.getByText("Available actions", { exact: true })).toBeVisible();
  await expect(what.getByText("Technical log", { exact: true })).toBeVisible();

  // And the line that says what to do, which is the point of the whole panel.
  await expect(what.getByText(/Choose an action on the Display/)).toBeVisible();

  await page.getByRole("button", { name: "What is this?" }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "What is this" })).toHaveCount(0);
});

test("somebody who owns glasses can reach the pairing form from a running session", async ({
  page,
}) => {
  /*
   * The front door's one button mints a session and embeds the panel, and the
   * pairing form lives on the page that button skips. So a visitor who
   * actually owns a pair had no route to it at all.
   */
  await page.goto(`${SITE}/demo?start=1`);
  await expect(page.getByTestId("actions").locator("li")).toHaveCount(11);

  await page.getByRole("button", { name: "Use Ray-Ban Display" }).click();

  await expect(page.getByRole("heading", { name: "Connect your display." })).toBeVisible();
  await expect(page.getByLabel("Six-letter pairing code")).toBeVisible();
  await expect(page.locator("#pair-instruction")).toHaveText(
    "Enter the six-letter code shown on your lens.",
  );

  // The session left the URL too, so a reload does not drop straight back into
  // the embedded panel it was just backed out of.
  await expect(page).not.toHaveURL(/session=/);
});

test("the pairing page exposes the browser demo in the shared navigation", async ({ page }) => {
  // `?start=1` is what the front door links to. The page behind it is the only
  // way to pair real glasses, so it cannot quietly rot.
  await page.goto(`${SITE}/demo`);
  await expect(page.getByText("No glasses available?")).toHaveCount(0);
  const navigationGaps = await page
    .getByRole("banner")
    .getByRole("navigation")
    .evaluate((nav) => {
      const items = [...nav.children].map((item) => item.getBoundingClientRect());
      return items.slice(1).map((item, index) => item.left - items[index].right);
    });
  expect(navigationGaps).toHaveLength(2);
  expect(Math.abs(navigationGaps[0] - navigationGaps[1])).toBeLessThan(0.5);
  await page.getByRole("banner").getByRole("button", { name: "Open browser demo" }).click();
  await expect(page).toHaveURL(/session=[A-Z]{6}/);
  await expectReachableIn(page.frameLocator('iframe[title="Dusky on the glasses"]'), /Add to cart/);
});

test("the pairing code is the connection between this browser and the display", async ({
  page,
}) => {
  await page.goto(`${SITE}/demo`);

  const graph = page.getByTestId("pairing-graph");
  await expect(graph).toBeVisible();
  await expect(graph.locator('[data-side="browser"]')).toContainText("This tab");
  await expect(graph.locator('[data-side="display"]')).toContainText("Waiting for code");
  const connections = graph.locator("canvas");
  await expect(connections).toHaveAttribute("data-measured-edges", "2");
  await expect(connections).toHaveAttribute("data-orientation", "horizontal");
  await expect(page.getByText(/Choices|Confirmations|Results/)).toHaveCount(0);

  await page.getByLabel("Six-letter pairing code").fill("DUSKYA");
  await expect(graph).toHaveAttribute("data-ready", "");
  await expect(graph.locator('[data-side="display"]')).toContainText("Code ready");
  await expect(page.getByRole("button", { name: "Connect display" })).toBeEnabled();
});

test("the pairing page and topology canvas do not widen a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });

  await page.goto(`${SITE}/demo`);
  await expect(page.getByRole("heading", { name: "Connect your display." })).toBeVisible();
  await expect(page.getByTestId("pairing-graph").locator("canvas")).toHaveAttribute(
    "data-orientation",
    "vertical",
  );
  expect(
    await page.evaluate(() =>
      Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    ),
  ).toBe(0);

  await page.goto(`${SITE}/demo?start=1`);
  await expect(page.getByRole("heading", { name: "Display preview" })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    ),
  ).toBe(0);
});

test("the Display preview label centers its text inside the bisecting pill", async ({ page }) => {
  await page.goto(`${SITE}/demo?start=1`);
  const label = page.getByRole("heading", { name: "Display preview" });
  await expect(label).toBeVisible();

  const alignment = await label.evaluate((element) => {
    const text = element.firstElementChild;
    if (!(text instanceof HTMLElement)) throw new Error("Display label text is missing");
    const pillBox = element.getBoundingClientRect();
    const textBox = text.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      horizontalOffset: textBox.left + textBox.width / 2 - (pillBox.left + pillBox.width / 2),
      verticalOffset: textBox.top + textBox.height / 2 - (pillBox.top + pillBox.height / 2),
      paddingLeft: Number.parseFloat(style.paddingLeft),
      paddingRight: Number.parseFloat(style.paddingRight),
    };
  });

  expect(Math.abs(alignment.horizontalOffset)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(alignment.verticalOffset)).toBeLessThanOrEqual(0.5);
  expect(alignment.paddingLeft).toBeCloseTo(alignment.paddingRight, 1);
});

test("the shared motion system sequences entry and respects reduced motion", async ({ page }) => {
  await page.goto(SITE);
  const animatedEntry = await page.evaluate(() => ({
    rule: getComputedStyle(document.querySelector("#root") as Element, "::after").animationName,
    hero: getComputedStyle(document.querySelector("[data-motion-item]") as Element).animationName,
  }));
  expect(animatedEntry.rule).toBe("dusky-rule-draw");
  expect(animatedEntry.hero).toBe("dusky-item-enter");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const reducedEntry = await page.evaluate(() => ({
    rule: getComputedStyle(document.querySelector("#root") as Element, "::after").animationName,
    hero: getComputedStyle(document.querySelector("[data-motion-item]") as Element).animationName,
  }));
  expect(reducedEntry.rule).toBe("none");
  expect(reducedEntry.hero).toBe("none");

  await page.goto(`${SITE}/demo?start=1`);
  await expect(page.locator("canvas[data-reduced-motion]")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  await page.getByRole("button", { name: "Hide Verdant Market page" }).click();
  await page.getByRole("button", { name: "Show Verdant Market page" }).click();
  const inspectionMotion = await page.evaluate(() => ({
    provider: getComputedStyle(document.querySelector("[data-inspected]") as Element).animationName,
    pair: getComputedStyle(
      document.querySelector("[data-inspected]")?.closest("[data-topology-focus]") as Element,
    ).transitionDuration,
    control: getComputedStyle(
      document.querySelector('[aria-label="Hide Verdant Market page"]') as Element,
    ).transitionDuration,
  }));
  expect(inspectionMotion).toEqual({ provider: "none", pair: "0s", control: "0s" });
});

test("the topology meets the page rails and keeps provider rows distinct", async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${SITE}/demo?start=1`);
    await expect(page.getByTestId("actions").locator("li")).toHaveCount(11);

    const geometry = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLElement>('[data-testid="topology-canvas"]');
      if (!canvas) throw new Error("Topology canvas is missing");
      const canvasBox = canvas.getBoundingClientRect();
      const style = getComputedStyle(canvas);
      const frame = document.querySelector<HTMLElement>("#root");
      if (!frame) throw new Error("Shared page frame is missing");
      const frameBox = frame.getBoundingClientRect();
      const frameStyle = getComputedStyle(frame);
      const rail = frameBox.left + Number.parseFloat(frameStyle.borderLeftWidth);
      const railRight = frameBox.right - Number.parseFloat(frameStyle.borderRightWidth);
      const route = document.querySelector<HTMLElement>('[data-motion-route="workspace"]');
      if (!route) throw new Error("Workspace route is missing");
      const modeControl = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "Use Ray-Ban Display",
      );
      if (!modeControl) throw new Error("Header mode control is missing");
      const modeStyle = getComputedStyle(modeControl);
      const pairs = Array.from(
        document.querySelectorAll<HTMLElement>('[data-topology-focus^="provider:"]'),
      );
      const boxes = pairs.map((pair) => {
        const pairBox = pair.getBoundingClientRect();
        const providerBox = pair.querySelector("figure")?.getBoundingClientRect();
        const actionBox = pair.querySelector("article")?.getBoundingClientRect();
        const actionList = pair.querySelector<HTMLElement>("article ul");
        return {
          top: pairBox.top,
          bottom: pairBox.bottom,
          height: pairBox.height,
          childBottom: Math.max(providerBox?.bottom ?? 0, actionBox?.bottom ?? 0),
          actionHeight: actionBox?.height ?? 0,
          listClientHeight: actionList?.clientHeight ?? 0,
          listScrollHeight: actionList?.scrollHeight ?? 0,
        };
      });
      return {
        rail,
        railRight,
        canvasLeft: canvasBox.left,
        canvasRight: canvasBox.right,
        borderWidth: style.borderTopWidth,
        radius: style.borderTopLeftRadius,
        frameBorderLeft: frameStyle.borderLeftWidth,
        frameBorderRight: frameStyle.borderRightWidth,
        sharedRuleHeight: getComputedStyle(frame, "::after").height,
        routeBorderTop: getComputedStyle(route).borderTopWidth,
        bodyRule: getComputedStyle(document.body, "::after").content,
        modeHeight: modeControl.getBoundingClientRect().height,
        modePadding: Number.parseFloat(modeStyle.paddingInlineStart),
        boxes,
      };
    });

    expect(Math.abs(geometry.canvasLeft - geometry.rail)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.canvasRight - geometry.railRight)).toBeLessThanOrEqual(1);
    expect(geometry.borderWidth).toBe("0px");
    expect(geometry.radius).toBe("0px");
    expect(geometry.frameBorderLeft).toBe("1px");
    expect(geometry.frameBorderRight).toBe("1px");
    expect(geometry.sharedRuleHeight).toBe("1px");
    expect(geometry.routeBorderTop).toBe("0px");
    expect(geometry.bodyRule).toBe("none");
    expect(geometry.modeHeight).toBeGreaterThanOrEqual(36);
    expect(geometry.modePadding).toBeGreaterThanOrEqual(12);
    geometry.boxes.forEach((box) => {
      expect(box.childBottom).toBeLessThanOrEqual(box.bottom + 1);
      expect(box.actionHeight).toBeLessThanOrEqual(box.height + 1);
    });
    expect(geometry.boxes[1]?.actionHeight).toBeLessThan((geometry.boxes[1]?.height ?? 0) - 4);
    expect(geometry.boxes[1]?.listScrollHeight).toBeLessThanOrEqual(
      (geometry.boxes[1]?.listClientHeight ?? 0) + 1,
    );
    for (let index = 1; index < geometry.boxes.length; index += 1) {
      expect(geometry.boxes[index]?.top).toBeGreaterThanOrEqual(
        (geometry.boxes[index - 1]?.bottom ?? 0) - 1,
      );
    }

    const overflowSizing = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>('[data-node-id^="actions:"]');
      const list = card?.querySelector<HTMLElement>("ul");
      const row = list?.querySelector("li");
      if (!card || !list || !row) throw new Error("Action card is not measurable");
      for (let index = 0; index < 8; index += 1) list.append(row.cloneNode(true));
      return {
        cardHeight: card.getBoundingClientRect().height,
        maxHeight: Number.parseFloat(getComputedStyle(card).maxHeight),
        clientHeight: list.clientHeight,
        scrollHeight: list.scrollHeight,
      };
    });
    expect(overflowSizing.cardHeight).toBeLessThanOrEqual(overflowSizing.maxHeight + 1);
    expect(overflowSizing.scrollHeight).toBeGreaterThan(overflowSizing.clientHeight);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${SITE}/demo?start=1`);
  const compactFlow = page.getByRole("button", {
    name: "Flow: top to bottom at this window width",
  });
  await expect(compactFlow).toBeVisible();
  await expect(compactFlow).toBeDisabled();
  expect(
    await page.evaluate(() =>
      Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    ),
  ).toBe(0);
  const mobileFlow = await page.evaluate(() => {
    const activity = document.querySelector<HTMLElement>("[data-runtime-activity]");
    const firstProvider = document.querySelector<HTMLElement>('[data-topology-focus^="provider:"]');
    if (!activity || !firstProvider) throw new Error("Mobile topology flow is missing");
    return {
      activityBottom: activity.getBoundingClientRect().bottom + window.scrollY,
      firstProviderTop: firstProvider.getBoundingClientRect().top + window.scrollY,
    };
  });
  expect(mobileFlow.firstProviderTop).toBeGreaterThanOrEqual(mobileFlow.activityBottom);

  expect(
    await page.evaluate(() =>
      Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    ),
  ).toBe(0);
});

test("website pages stay mounted, open independently, and fit every responsive layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/demo?start=1`);
  await expect(page.getByTestId("actions").locator("li")).toHaveCount(11);

  const frames = page.locator('iframe[id^="provider-page-"]');
  const verdantFrame = page.locator('iframe[title="Verdant Market"]');
  const originalFrame = await verdantFrame.elementHandle();
  expect(originalFrame).not.toBeNull();
  await expect(frames).toHaveCount(3);
  await expect(page.locator('[data-node-id^="provider:"][data-inspected]')).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Hide all website pages" })).toBeVisible();
  await expect(page.getByText("live page", { exact: true })).toHaveCount(0);
  await expect(page.getByText("website", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Hide all website pages" }).click();
  await expect(page.locator('[data-node-id^="provider:"][data-inspected]')).toHaveCount(0);
  await expect(frames).toHaveCount(3);
  for (const frame of await frames.all()) {
    await expect(frame).toHaveAttribute("tabindex", "-1");
    await expect(frame).toHaveAttribute("aria-hidden", "true");
    await expect(frame).toHaveCSS("pointer-events", "none");
  }

  await page.getByRole("button", { name: "Show Verdant Market page" }).click();
  await page.getByRole("button", { name: "Show Amber & Oak page" }).click();
  await page.getByRole("button", { name: "Hide Verdant Market page" }).click();
  await page.getByRole("button", { name: "Show Northstar Dispatch page" }).click();
  await expect(page.locator('[data-node-id^="provider:"][data-inspected]')).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Hide Amber & Oak page" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide Northstar Dispatch page" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show Verdant Market page" })).toBeVisible();

  const currentFrame = await verdantFrame.elementHandle();
  expect(currentFrame).not.toBeNull();
  if (originalFrame && currentFrame) {
    expect(await originalFrame.evaluate((node, other) => node === other, currentFrame)).toBe(true);
  }

  for (const width of [390, 841, 900, 1024, 1100, 1200, 1279, 1320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const expectedLayout = width >= 1320 ? "horizontal" : "vertical";
    await expect(page.getByTestId("topology-canvas")).toHaveAttribute(
      "data-layout",
      expectedLayout,
    );
    const geometry = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLElement>('[data-testid="topology-canvas"]');
      if (!canvas) throw new Error("Topology canvas is missing");
      const canvasBox = canvas.getBoundingClientRect();
      const pairs = Array.from(
        document.querySelectorAll<HTMLElement>('[data-topology-focus^="provider:"]'),
      ).map((pair) => pair.getBoundingClientRect());
      const compactProvider = document.querySelector<HTMLElement>(
        '[data-node-id^="provider:"]:not([data-inspected])',
      );
      const compactControls = compactProvider?.querySelector<HTMLElement>(
        "[data-provider-controls]",
      );
      const incomingPort = compactProvider?.querySelector<HTMLElement>(
        "[data-compact-port][data-provider-origin]",
      );
      const outgoingPort = compactProvider?.querySelector<HTMLElement>(
        '[data-compact-port][data-action-end="provider"]',
      );
      if (!compactProvider || !compactControls || !incomingPort || !outgoingPort) {
        throw new Error("Compact website connection geometry is missing");
      }
      const controlsBox = compactControls.getBoundingClientRect();
      const incomingBox = incomingPort.getBoundingClientRect();
      const outgoingBox = outgoingPort.getBoundingClientRect();
      const compactPortsFollowVisibleControl =
        canvas.dataset.layout === "horizontal"
          ? Math.abs(incomingBox.left - controlsBox.left) < 1 &&
            Math.abs(outgoingBox.left - controlsBox.right) < 1 &&
            Math.abs(incomingBox.top - (controlsBox.top + controlsBox.height / 2)) < 1 &&
            Math.abs(outgoingBox.top - (controlsBox.top + controlsBox.height / 2)) < 1
          : Math.abs(incomingBox.left - (controlsBox.left + controlsBox.width / 2)) < 1 &&
            Math.abs(outgoingBox.left - (controlsBox.left + controlsBox.width / 2)) < 1 &&
            Math.abs(incomingBox.top - controlsBox.top) < 1 &&
            Math.abs(outgoingBox.top - controlsBox.bottom) < 1;
      return {
        layout: canvas.dataset.layout,
        overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        contained: pairs.every(
          (pair) => pair.left >= canvasBox.left - 1 && pair.right <= canvasBox.right + 1,
        ),
        compactPortsFollowVisibleControl,
      };
    });
    expect(geometry.overflow, `horizontal overflow at ${width}px`).toBe(0);
    expect(geometry.contained, `provider row outside canvas at ${width}px`).toBe(true);
    expect(
      geometry.compactPortsFollowVisibleControl,
      `compact website ports detached from their visible control at ${width}px`,
    ).toBe(true);
    expect(geometry.layout).toBe(expectedLayout);
  }

  await page.setViewportSize({ width: 900, height: 900 });
  await expect(
    page.getByRole("button", { name: "Flow: top to bottom at this window width" }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("button", { name: "Flow: left to right" })).toBeEnabled();
});

test("a lens code stays in glasses mode across a reload", async ({ page }) => {
  await page.goto(`${SITE}/demo`);

  const code = "DUSKYA";
  await page.getByLabel("Six-letter pairing code").fill(code);
  await page.getByRole("button", { name: "Connect display" }).click();

  await expect(page).toHaveURL(new RegExp(`session=${code}`));
  await expect(page).toHaveURL(/mode=glasses/);
  await expect(page.getByRole("heading", { name: "Ray-Ban Display" })).toBeVisible();
  await expect(page.locator('iframe[title="Dusky on the glasses"]')).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Ray-Ban Display" })).toBeVisible();
  await expect(page.locator('iframe[title="Dusky on the glasses"]')).toHaveCount(0);
});

test("a gesture in the embedded panel changes the partner site in the same tab", async ({
  page,
}) => {
  await page.goto(`${SITE}/demo?start=1`);

  const lens = page.frameLocator('iframe[title="Dusky on the glasses"]');
  const cart = page.frameLocator('iframe[title="Verdant Market"]').getByTestId("cart");

  await clickChoiceIn(lens, /Add to cart/);
  const compose = lens.locator('input[type="text"]');
  await expect(compose).toBeVisible();
  await compose.fill("oat-1");
  await compose.press("Enter");

  // Gated, so nothing has happened yet.
  await expect(lens.getByRole("button", { name: /Confirm/ })).toBeVisible();
  await expect(cart).toHaveText("empty");

  await lens.getByRole("button", { name: /Confirm/ }).click();
  await expect(cart).toContainText("Organic oat milk");
  await expect(lens.getByText("Cart total")).toBeVisible();

  /*
   * And you can SEE it change without scrolling the shop.
   *
   * The cart used to sit under the catalogue, about 200px below the fold of the
   * panel this page embeds the shop in. It is the only element that moves when
   * a tool runs, so the proof that anything happened was the one thing off
   * screen: the lens said "Add to cart done" and the shop appeared inert.
   */
  const frame = await page.locator('iframe[title="Verdant Market"]').boundingBox();
  const seat = await page
    .frameLocator('iframe[title="Verdant Market"]')
    .getByTestId("cart")
    .boundingBox();
  expect(frame).not.toBeNull();
  expect(seat).not.toBeNull();
  if (frame && seat) expect(seat.y - frame.y + seat.height).toBeLessThanOrEqual(frame.height);
});

/*
 * Found by wearing the glasses, 2026-08-28.
 *
 * The composer commits on Enter or on blur, and on real hardware neither was
 * reachable. A tap on a focused text field is taken by the OS to open its own
 * writing surface, so it never arrives as `Enter`, and `useDpad` wraps focus
 * with `% count`, which for a frame offering only the composer never moves.
 * A wearer could write `oat`, watch it sit in the field, and have no way to
 * send it. "Done" is what focus moves to, and leaving the input is what
 * commits.
 */
test("free text has somewhere for focus to go, and only once there is text", async ({ page }) => {
  await page.goto(`${SITE}/demo?start=1`);

  const lens = page.frameLocator('iframe[title="Dusky on the glasses"]');
  await clickChoiceIn(lens, /Add to cart/);

  const compose = lens.locator('input[type="text"]');
  await expect(compose).toBeVisible();

  // Nothing written yet, so there is nothing to send and no row offering to.
  // A row that accepts a press and does nothing reads as a hang on a panel
  // with no cursor.
  await expect(lens.getByRole("button", { name: "Done" })).toHaveCount(0);

  await compose.fill("oat-1");

  // Now there is something to send, so there is somewhere for focus to go.
  const done = lens.getByRole("button", { name: "Done" });
  await expect(done).toBeVisible();

  // And moving focus off the input is what commits, which is the whole point:
  // clicking Done blurs the field, and the blur sends the value.
  await done.click();
  await expect(lens.getByRole("button", { name: /Confirm/ })).toBeVisible();
});

test("a tool with no arguments is not named twice on the confirm frame", async ({ page }) => {
  await page.goto(`${SITE}/demo?start=1`);
  const lens = page.frameLocator('iframe[title="Dusky on the glasses"]');

  // empty_cart is gated and takes no arguments, which is the combination that
  // used to print the label as the title AND as the target: the wearer read
  // "Empty cart" over "Empty cart" and had to confirm it.
  await clickChoiceIn(lens, /Empty cart/);

  await expect(lens.getByText("This cannot be undone")).toBeVisible();
  await expect(lens.getByText("Empty cart", { exact: true })).toHaveCount(1);

  // A tool that DOES take arguments still names what it is acting on, so the
  // fix removed a duplicate rather than the line. product_id is a plain string
  // on this site, so it arrives through the composer rather than as buttons.
  await lens.getByRole("button", { name: "Cancel" }).click();
  await clickChoiceIn(lens, /Add to cart/);
  const compose = lens.locator('input[type="text"]');
  await expect(compose).toBeVisible();
  await compose.fill("oat-1");
  await compose.press("Enter");
  await expect(lens.getByText("oat-1", { exact: true })).toBeVisible();
  await expect(lens.getByText("Add to cart", { exact: true })).toHaveCount(1);
});

/**
 * What replaced "the same tab can be pointed at a completely different site".
 *
 * That test drove the source switcher, and the switcher is gone with the
 * restriction it controlled. Its real subject survives and is stronger stated
 * this way: one tab, one session, one code, one menu, and two businesses that
 * have never heard of each other reachable from it at the same time. Pointing
 * at one site at a time was the thing being demonstrated; holding both is.
 */
test("one tab holds three unrelated businesses, on one menu", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/demo?start=1`);

  const lens = page.frameLocator('iframe[title="Dusky on the glasses"]');

  /*
   * Never accused of granting nothing while it is still answering.
   *
   * The sites load independently and the first discovery legitimately returns
   * zero for a site whose frame has not registered yet. The console reported
   * that as "the grant is missing", which is a real failure with a real remedy,
   * about a site that was fine. Holding several sites makes this worse rather
   * than better, because one site arriving is not evidence about another, so
   * the console now settles each origin on its own. Polled rather than asserted
   * once, because the bug lives in a window of a few hundred milliseconds and a
   * single check would step over it.
   */
  for (let i = 0; i < 12; i++) {
    await expect(page.getByText("offered nothing")).toHaveCount(0);
    await page.waitForTimeout(60);
  }

  // Both sites' actions, in one list, ordered by what a press costs rather than
  // by which business published them.
  const actions = page.getByTestId("actions");
  await expect(actions.getByText("Add to cart")).toBeVisible();
  await expect(actions.getByText("Book table")).toBeVisible();
  await expect(actions.getByText("Send message")).toBeVisible();
  await expect(actions.locator("li")).toHaveCount(11);

  // Actions are grouped beside the provider that exposed them, rather than
  // repeating the provider name on every row.
  await expect(
    page.getByRole("article", { name: "Verdant Market actions" }).locator("li"),
  ).toHaveCount(4);
  await expect(
    page.getByRole("article", { name: "Amber & Oak actions" }).locator("li"),
  ).toHaveCount(3);
  await expect(
    page.getByRole("article", { name: "Northstar Dispatch actions" }).locator("li"),
  ).toHaveCount(4);
  await expect(
    page
      .getByRole("article", { name: "Verdant Market actions" })
      .getByRole("heading", { name: "4 actions" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("article", { name: "Amber & Oak actions" })
      .getByRole("heading", { name: "3 actions" }),
  ).toBeVisible();
  await expect(actions.getByRole("heading", { name: "Available actions" })).toHaveCount(0);

  // One paired Display owns one shared Browser Runtime trunk. Runtime then
  // fans out through three independent cubic edges, while each origin retains
  // its own measured capability relationship.
  await expect(page.locator('[data-runtime-end="display"]')).toHaveCount(1);
  await expect(page.locator('[data-runtime-end="browser"]')).toHaveCount(1);
  await expect(page.locator('[data-provider-end="runtime"]')).toHaveCount(1);
  await expect(page.locator("[data-provider-origin]")).toHaveCount(3);
  const connections = page.locator("canvas[data-runtime-edges]");
  await expect(connections).toHaveAttribute("data-runtime-trunks", "1");
  await expect(connections).toHaveAttribute("data-provider-buses", "0");
  await expect(connections).toHaveAttribute("data-provider-branches", "3");
  await expect(connections).toHaveAttribute("data-runtime-edges", "4");
  await expect(connections).toHaveAttribute("data-action-edges", "3");
  await expect(connections).toHaveAttribute("data-connected-origins", "3");
  await expect(connections).not.toHaveAttribute("data-activity-edges");

  // A node drag only repositions that logical group. It no longer masquerades
  // as a canvas pan and pull every other component along with it.
  const displayNode = page.locator('[data-node-id="display"]');
  const runtimeNode = page.locator('[data-node-id="runtime"]');
  const providerNode = page.locator('[data-node-id^="provider:"]').first();
  const actionNode = page.locator('[data-node-id^="actions:"]').first();
  const displayBefore = await displayNode.boundingBox();
  const runtimeBefore = await runtimeNode.boundingBox();
  const providerBefore = await providerNode.boundingBox();
  const actionBefore = await actionNode.boundingBox();
  expect(displayBefore).not.toBeNull();
  expect(runtimeBefore).not.toBeNull();
  expect(providerBefore).not.toBeNull();
  expect(actionBefore).not.toBeNull();
  if (displayBefore && runtimeBefore && providerBefore && actionBefore) {
    const actionHandleBox = await actionNode.getByRole("heading").boundingBox();
    expect(actionHandleBox).not.toBeNull();
    if (!actionHandleBox) throw new Error("Action card drag handle was not measurable");
    await page.mouse.move(
      actionHandleBox.x + actionHandleBox.width / 2,
      actionHandleBox.y + actionHandleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      actionHandleBox.x + actionHandleBox.width / 2 - 54,
      actionHandleBox.y + actionHandleBox.height / 2 + 24,
      { steps: 5 },
    );
    await page.mouse.up();

    const displayAfter = await displayNode.boundingBox();
    const runtimeAfter = await runtimeNode.boundingBox();
    const providerAfter = await providerNode.boundingBox();
    const actionAfter = await actionNode.boundingBox();
    expect(displayAfter?.x).toBeCloseTo(displayBefore.x, 0);
    expect(displayAfter?.y).toBeCloseTo(displayBefore.y, 0);
    expect(runtimeAfter?.x).toBeCloseTo(runtimeBefore.x, 0);
    expect(runtimeAfter?.y).toBeCloseTo(runtimeBefore.y, 0);
    expect(providerAfter?.x).toBeCloseTo(providerBefore.x, 0);
    expect(providerAfter?.y).toBeCloseTo(providerBefore.y, 0);
    expect(actionAfter?.x).toBeCloseTo(actionBefore.x - 54, 0);
    expect(actionAfter?.y).toBeCloseTo(actionBefore.y + 24, 0);

    await page.getByRole("button", { name: "Center" }).click();
    await expect(actionNode).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

    // Freeform placement is bounded by the visible topology surface. The
    // node's floating label counts as part of that visual boundary, so an
    // extreme pointer move cannot leave either the panel or its label beyond
    // a page rail.
    const dragCanvas = page.getByTestId("topology-canvas");
    const dragCanvasBox = await dragCanvas.boundingBox();
    const displayHandleBox = await displayNode.getByRole("heading").boundingBox();
    expect(dragCanvasBox).not.toBeNull();
    expect(displayHandleBox).not.toBeNull();
    if (!dragCanvasBox || !displayHandleBox) {
      throw new Error("Display containment geometry was not measurable");
    }
    const dragDisplayTo = async (x: number, y: number) => {
      const handle = await displayNode.getByRole("heading").boundingBox();
      if (!handle) throw new Error("Display drag handle was not measurable");
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 5 });
      await page.mouse.up();
      return displayNode.evaluate((node) => {
        const canvas = node.closest<HTMLElement>('[data-testid="topology-canvas"]');
        if (!canvas) throw new Error("Display canvas is missing");
        const canvasBox = canvas.getBoundingClientRect();
        const boxes = [
          node.getBoundingClientRect(),
          ...Array.from(node.querySelectorAll<HTMLElement>("[data-node-boundary]"), (child) =>
            child.getBoundingClientRect(),
          ),
        ];
        const visualBox = {
          top: Math.min(...boxes.map((box) => box.top)),
          right: Math.max(...boxes.map((box) => box.right)),
          bottom: Math.max(...boxes.map((box) => box.bottom)),
          left: Math.min(...boxes.map((box) => box.left)),
        };
        return {
          inside:
            visualBox.left >= canvasBox.left &&
            visualBox.top >= canvasBox.top &&
            visualBox.right <= canvasBox.right &&
            visualBox.bottom <= canvasBox.bottom,
          visualBox,
          canvasBox: {
            top: canvasBox.top,
            right: canvasBox.right,
            bottom: canvasBox.bottom,
            left: canvasBox.left,
          },
        };
      });
    };
    expect(
      (
        await dragDisplayTo(
          dragCanvasBox.x - dragCanvasBox.width,
          dragCanvasBox.y - dragCanvasBox.height,
        )
      ).inside,
    ).toBe(true);
    expect(
      (
        await dragDisplayTo(
          dragCanvasBox.x + dragCanvasBox.width * 2,
          dragCanvasBox.y + dragCanvasBox.height * 2,
        )
      ).inside,
    ).toBe(true);

    // A desktop offset cannot leak into a narrower responsive layout.
    await page.setViewportSize({ width: 1200, height: 900 });
    await expect(displayNode).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    const resizedDisplay = await displayNode.evaluate((node) => {
      const canvas = node.closest<HTMLElement>('[data-testid="topology-canvas"]');
      if (!canvas) throw new Error("Resized display canvas is missing");
      const nodeBox = node.getBoundingClientRect();
      const canvasBox = canvas.getBoundingClientRect();
      return nodeBox.left >= canvasBox.left && nodeBox.right <= canvasBox.right;
    });
    expect(resizedDisplay).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    // The resize handler deliberately clears desktop offsets. Let that React
    // update commit before starting a new drag, or a late resize commit can
    // erase the movement after the pointer has already been released.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );

    // Provider cards are direct grid children. Moving one across its original
    // column boundary must not expose an invisible intermediate scrollport;
    // only the visible topology canvas is allowed to clip movable nodes.
    const providerHandleBox = await providerNode.locator("#provider-label-0").boundingBox();
    expect(providerHandleBox).not.toBeNull();
    if (!providerHandleBox) throw new Error("Provider card drag handle was not measurable");
    await page.mouse.move(
      providerHandleBox.x + providerHandleBox.width / 2,
      providerHandleBox.y + providerHandleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      providerHandleBox.x + providerHandleBox.width / 2 - 140,
      providerHandleBox.y + providerHandleBox.height / 2 - 40,
      { steps: 5 },
    );
    await page.mouse.up();
    await page.waitForTimeout(100);

    const movedProvider = await providerNode.evaluate((node) => {
      const pair = node.closest<HTMLElement>("[data-topology-focus]");
      const field = pair?.parentElement;
      const canvas = node.closest<HTMLElement>('[data-testid="topology-canvas"]');
      const edgeCanvas = canvas?.querySelector<HTMLCanvasElement>("canvas[data-provider-branches]");
      const providerPort = node.querySelector<HTMLElement>("[data-provider-origin]");
      const actionPort = node.querySelector<HTMLElement>('[data-action-end="provider"]');
      if (!pair || !field || !canvas || !edgeCanvas || !providerPort || !actionPort) {
        throw new Error("Moved provider geometry is incomplete");
      }

      const nodeBox = node.getBoundingClientRect();
      const fieldBox = field.getBoundingClientRect();
      const canvasBox = canvas.getBoundingClientRect();
      const sample = {
        x: fieldBox.left - 20,
        y: nodeBox.top + nodeBox.height * 0.35,
      };
      const internalClippers: string[] = [];
      for (let ancestor = node.parentElement; ancestor && ancestor !== canvas; ) {
        const style = getComputedStyle(ancestor);
        if (style.overflowX !== "visible" || style.overflowY !== "visible") {
          internalClippers.push(ancestor.tagName);
        }
        ancestor = ancestor.parentElement;
      }

      const context = edgeCanvas.getContext("2d");
      if (!context) throw new Error("Topology connection canvas is unavailable");
      const edgeBox = edgeCanvas.getBoundingClientRect();
      const ratioX = edgeCanvas.width / edgeBox.width;
      const ratioY = edgeCanvas.height / edgeBox.height;
      const inkAt = (element: HTMLElement) => {
        const box = element.getBoundingClientRect();
        const x = Math.round((box.left + box.width / 2 - edgeBox.left) * ratioX);
        const y = Math.round((box.top + box.height / 2 - edgeBox.top) * ratioY);
        const pixels = context.getImageData(Math.max(0, x - 6), Math.max(0, y - 6), 13, 13).data;
        let ink = 0;
        for (let index = 3; index < pixels.length; index += 4) {
          if ((pixels[index] ?? 0) > 0) ink += 1;
        }
        return ink;
      };

      return {
        deltaX: nodeBox.x - fieldBox.x,
        insideCanvas:
          nodeBox.left >= canvasBox.left &&
          nodeBox.top >= canvasBox.top &&
          nodeBox.right <= canvasBox.right &&
          nodeBox.bottom <= canvasBox.bottom,
        visibleAcrossFormerBoundary: document
          .elementsFromPoint(sample.x, sample.y)
          .some((element) => element === node || node.contains(element)),
        internalClippers,
        fieldOverflow: getComputedStyle(field).overflow,
        endpointInk: {
          provider: inkAt(providerPort),
          action: inkAt(actionPort),
        },
      };
    });
    expect(movedProvider.deltaX).toBeCloseTo(-140, 0);
    expect(movedProvider.insideCanvas).toBe(true);
    expect(movedProvider.visibleAcrossFormerBoundary).toBe(true);
    expect(movedProvider.internalClippers).toEqual([]);
    expect(movedProvider.fieldOverflow).toBe("visible");
    expect(Object.values(movedProvider.endpointInk).every((ink) => ink > 0)).toBe(true);

    await providerNode.getByRole("button", { name: "Hide Verdant Market page" }).click();
    await providerNode.getByRole("button", { name: "Show Verdant Market page" }).click();
    await expect(providerNode).toHaveAttribute("data-inspected", "");
    const expandedClippers = await providerNode.evaluate((node) => {
      const canvas = node.closest<HTMLElement>('[data-testid="topology-canvas"]');
      if (!canvas) throw new Error("Expanded provider canvas is missing");
      const clippers: string[] = [];
      for (let ancestor = node.parentElement; ancestor && ancestor !== canvas; ) {
        const style = getComputedStyle(ancestor);
        if (style.overflowX !== "visible" || style.overflowY !== "visible") {
          clippers.push(ancestor.tagName);
        }
        ancestor = ancestor.parentElement;
      }
      return clippers;
    });
    expect(expandedClippers).toEqual([]);
    await providerNode.getByRole("button", { name: "Hide Verdant Market page" }).click();

    await page.getByRole("button", { name: "Center" }).click();
    await expect(providerNode).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  }

  // Like the reference orchestration canvas, placement is deterministic but
  // the viewer can change the reading direction and pan the open field.
  const layout = page.getByRole("button", { name: "Flow: left to right" });
  await layout.click();
  await expect(page.getByRole("button", { name: "Flow: top to bottom" })).toBeVisible();
  await page.getByRole("button", { name: "Flow: top to bottom" }).click();
  await expect(layout).toBeVisible();

  const canvas = page.getByTestId("topology-canvas");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  if (canvasBox) {
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.52, canvasBox.y + 90);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.58, canvasBox.y + 125, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByRole("button", { name: "Center" })).toBeVisible();
  }

  // Same session, same panel, same code: both reachable from the one menu.
  await expectReachableIn(lens, /Add to cart/);
  await expectReachableIn(lens, /Book table/);
  await expectReachableIn(lens, /Send message/);
});
