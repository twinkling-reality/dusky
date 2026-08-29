#!/usr/bin/env node
/**
 * Pair a WebMCP-capable console to a running Dusky session, and hold it open.
 *
 * WebMCP is off by default in every stable browser, so operating Dusky
 * normally means enabling `chrome://flags/#enable-webmcp-testing` in the
 * browser you use every day and relaunching it. This launches a SEPARATE
 * Chrome with the flag already set, pairs it, and keeps it alive, which is
 * what you want when someone is standing there wearing the glasses, or when
 * you are recording and do not want your own browser in the shot.
 *
 * It holds the WebMCP half of the session: tools execute in THIS browser, in
 * the partner site's own document. It cannot approve anything. Every
 * consequential action still stops on the glasses and waits for the wearer,
 * which is the whole design rather than a limitation of this script.
 *
 *   node scripts/pair-console.mjs 3N4CB2
 *   node scripts/pair-console.mjs 3N4CB2 --console http://localhost:7803
 */

import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const code = args.find((a) => !a.startsWith("--"));
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
};

if (!code) {
  console.error(`
  Pair a console to a Dusky session and keep it open.

    node scripts/pair-console.mjs <pairing code> [--console <url>]

  The pairing code is the one shown on the glasses.
`);
  process.exit(1);
}

const consoleUrl = flag("console", "https://dusky-console.vercel.app");
const pairing = code.toUpperCase();

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--enable-features=WebMCPTesting"],
});

const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });

/*
 * `mode=glasses` is not optional here, and leaving it off is destructive.
 *
 * A session holds exactly one Display, and attaching a second closes the
 * first. Without this parameter the console defaults to `embedded`, mounts a
 * Display of its own in an iframe, and evicts the actual glasses: the wearer
 * gets "Another window took over" from the very script that was supposed to
 * pair them.
 *
 * The workspace also lives at `/demo`. `/` is the landing page, which has no
 * session on it at all.
 */
await page.goto(`${consoleUrl}/demo?session=${pairing}&mode=glasses`);

// Ask the browser directly rather than matching on a sentence in the UI. The
// wording has changed once already and a stale locator here reports "no
// WebMCP" for a browser that has it.
const hasWebMcp = await page.evaluate(() => "modelContext" in document);
if (!hasWebMcp) {
  console.error("This Chrome did not accept --enable-features=WebMCPTesting. Is it 149 or newer?");
  await browser.close();
  process.exit(1);
}

// No form to fill: a code in the URL pairs on arrival, which is also the path
// the demo link uses.

// Tool discovery is the moment that proves the exposedTo grant is right.
// Any declared action will do, and naming one tool would tie this script to
// one partner site.
await page
  .locator("li", { hasText: /gated|read/ })
  .first()
  .waitFor({ timeout: 30_000 });
console.log(`paired to ${pairing} against ${consoleUrl}`);

// Report through Dusky's own tools, which is also a live check that the
// provider half is registered and answering.
const status = await page.evaluate(async () => {
  const mc = /** @type {any} */ (document).modelContext;
  const tools = await mc.getTools();
  const t = tools.find((x) => x.name === "get_display_status");
  if (!t) return { error: "Dusky registered no tools in this browser" };
  return JSON.parse(await mc.executeTool(t, JSON.stringify({})));
});
console.log("display status:", JSON.stringify(status, null, 2));
console.log("\nHolding the session open. Stop this process to unpair.");

await new Promise(() => {});
