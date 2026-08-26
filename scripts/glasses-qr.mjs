#!/usr/bin/env node
/**
 * Put Dusky on a pair of Meta Ray-Ban Display glasses.
 *
 * Emits the `fb-viewapp://` deep link Meta's companion app understands, as a
 * QR code drawn in the terminal so a phone camera can read it straight off the
 * screen, and optionally as a file to paste into a README or a slide.
 *
 * The QR is a convenience and nothing more. It encodes exactly the two values
 * you would otherwise type into the Meta AI app under
 * Devices > Display Glasses settings > App connections > Web apps, so if the
 * scan ever misbehaves, type the name and URL by hand and carry on.
 *
 * Deep link format verified against github.com/facebook/meta-wearables-webapp,
 * which AGENTS.md names as the authoritative source. It has NOT been scanned
 * against real hardware from this repository.
 *
 *   node scripts/glasses-qr.mjs --url https://dusky-display.vercel.app
 *   node scripts/glasses-qr.mjs --url https://... --name Dusky --out dusky-qr.png
 */

import { argv, exit, stdout } from "node:process";
import QRCode from "qrcode";

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = "true";
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function die(message, hint) {
  console.error(`\n  ${message}`);
  if (hint) console.error(`  ${hint}`);
  console.error("");
  exit(1);
}

const args = parseArgs(argv.slice(2));

if (args["help"] || !args["url"]) {
  console.error(`
  Put Dusky on Meta Ray-Ban Display.

    node scripts/glasses-qr.mjs --url <https url> [--name <name>] [--out <file>]

    --url   Public HTTPS URL of the Display build. Required.
    --name  Name shown on the glasses. Defaults to "Dusky".
    --out   Also write the QR to a file. .png or .svg.
`);
  exit(args["url"] ? 0 : 1);
}

const name = (args["name"] ?? "Dusky").trim();
if (!name) die("A name cannot be empty.", "The glasses show it in the web apps list.");

let url;
try {
  url = new URL(args["url"]);
} catch {
  die(`Not a URL: ${args["url"]}`);
}

// The glasses fetch this over the open internet from a device that is not on
// your machine, so the two ways to waste an afternoon are both caught here.
if (url.protocol !== "https:") {
  die(
    `Meta Ray-Ban Display loads web apps over HTTPS only, and this is ${url.protocol}//`,
    "Deploy the Display build to a public HTTPS host first. See DEPLOY.md.",
  );
}
if (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|.*\.local)$/i.test(url.hostname)) {
  die(
    `${url.hostname} is only reachable from this machine, not from the glasses.`,
    "The glasses are a separate device on a separate network. See DEPLOY.md.",
  );
}

const deepLink = `fb-viewapp://web_app_deep_link?appName=${encodeURIComponent(
  name,
)}&appUrl=${encodeURIComponent(url.toString())}`;

const terminal = await QRCode.toString(deepLink, { type: "terminal", small: true });

stdout.write(`\n${terminal}\n`);
stdout.write(`  Name  ${name}\n`);
stdout.write(`  URL   ${url.toString()}\n`);
stdout.write(`  Link  ${deepLink}\n\n`);
stdout.write(`  Scan with your phone camera, or add it by hand in the Meta AI app:\n`);
stdout.write(
  `  Devices > Display Glasses settings > App connections > Web apps > Add a web app\n\n`,
);

if (args["out"]) {
  const file = args["out"];
  if (!/\.(png|svg)$/i.test(file)) die(`--out must end in .png or .svg, got ${file}`);
  await QRCode.toFile(file, deepLink, { width: 512, margin: 2 });
  stdout.write(`  Written to ${file}\n\n`);
}
