/**
 * Screenshots of the console in the browser a judge will actually use:
 * real Chrome with the WebMCP testing flag, which is the only configuration
 * where the requirements come back all green.
 *
 * Not a test. `npx playwright test` is what proves anything; this only makes
 * the result lookable-at. Output is gitignored.
 */

import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const OUT = process.argv[2] ?? "review";
const SITE = "http://localhost:7803";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  args: ["--enable-features=WebMCPTesting"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

async function shot(name, opts = {}) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
  console.log(`${OUT}/${name}.png`);
}

await page.goto(SITE);
await page.waitForTimeout(1200);
await shot("front");

// The panel a met browser never sees on its own, opened by hand so the glass
// can be looked at with everything passing.
await page.getByRole("button", { name: /Requirements/ }).click();
await shot("front-requirements");
await page.keyboard.press("Escape");

// The argument is a route of its own now, not a drawer under the hero.
await page.goto(`${SITE}/proof`);
await page.waitForTimeout(1200);
await shot("proof", { fullPage: true });

await page.setViewportSize({ width: 900, height: 1100 });
await page.goto(SITE);
await page.waitForTimeout(1200);
await shot("front-narrow", { fullPage: true });

await page.setViewportSize({ width: 420, height: 900 });
await page.goto(SITE);
await page.waitForTimeout(1200);
await shot("front-mobile", { fullPage: true });

// One click from the front door, so this is the page as a visitor meets it:
// already running, nothing typed, nothing else to press.
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${SITE}/demo?start=1`);
await page.waitForTimeout(2000);
await shot("demo", { fullPage: true });

await browser.close();
