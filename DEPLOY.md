# Deploying Dusky, and getting it onto the glasses

## Deployment target as of 2026-08-29

The console holds every partner site at once, so all five static surfaces have
to be up for the demo to be what it claims. `e2e/production.spec.ts` checks
each of them, which is why it exists: `dusky-reservations` once answered
DEPLOYMENT_NOT_FOUND with the rest of the suite green, because a claim nothing
asserts is a claim nothing can catch.

All six surfaces were deployed from `f7d9656` on 2026-08-29. The production
suite passed 10/10 against the stable URLs below, including three-origin WebMCP
discovery, a deployed tool invocation, browser-agent control, and a live
two-step planner result.

| Surface | URL |
| --- | --- |
| Display, for the glasses | https://dusky-display.vercel.app |
| Website and demo | https://dusky-console.vercel.app |
| Verdant Market | https://dusky-market.vercel.app |
| Amber & Oak | https://dusky-reservations.vercel.app |
| Northstar Dispatch | https://dusky-dispatch.vercel.app |
| Relay | https://dusky-relay.onrender.com |

Two deployment facts remain deliberately manual:

- `DUSKY_PLANNER=on` and `ANTHROPIC_API_KEY` are configured on the relay. The
  first cold live request exhausted the seven-second planning budget and fell
  back to the menu. Two immediate repeats produced the intended two-step task.
  This is measured live behavior, not a guarantee that every model call will
  answer inside the budget.
- Viewing the console needs WebMCP in the browser: the ChatGPT desktop app's
  built-in browser, or Chrome 149+ with `chrome://flags/#enable-webmcp-testing`.
  The console says so plainly when the API is missing.


Six surfaces. Five are static and belong on any CDN. One holds WebSockets and
does not.

| Surface | What it is | Where it runs | Host |
| --- | --- | --- | --- |
| `apps/display` | The 600x600 app the wearer sees | On the glasses | Vercel |
| `apps/console` | The website: front door at `/`, demo at `/demo` | A desktop browser | Vercel |
| `apps/market` | Verdant Market, a test service | A desktop browser | Vercel |
| `apps/reservations` | Amber & Oak, a second test service | A desktop browser | Vercel |
| `apps/dispatch` | Northstar Dispatch, a communications test service | A desktop browser | Vercel |
| `apps/server` | The session relay | A server | Render, Railway or Fly |

**Only the Display runs on the glasses.** Tools execute inside the partner
site's document in the console's browser, which is why Dusky never holds a
partner's credentials. A real test therefore needs the Display on the glasses
AND the console open on a computer, in Chrome with the WebMCP flag or in the
ChatGPT desktop browser. Glasses alone cannot do anything, and that separation
is the architecture rather than a limitation.

## Choose all six names before deploying anything

The console needs each partner site's URL, and each partner site needs the
console's origin. That looks circular and is not, because a Vercel project's URL
is derived from its name. Pick the names first and every value below is known
before the first deploy.

```
dusky-display.vercel.app
dusky-console.vercel.app
dusky-market.vercel.app
dusky-reservations.vercel.app
dusky-dispatch.vercel.app
dusky-relay.onrender.com
```

## 1. The relay

`render.yaml` in this repository describes the service. Point Render at the
repo and it reads it. Railway and Fly work from the same two commands:

```bash
corepack enable && pnpm install --prod --frozen-lockfile
pnpm --filter @dusky/app-server start
```

`tsx` is a runtime dependency of `@dusky/app-server` rather than a dev tool,
which is what lets `--prod` work. Verified by running a production-only install
in a clean copy and hitting `/health`.

Check it before going further:

```bash
curl https://dusky-relay.onrender.com/health
```

That must return `{"ok":true,"sessions":0}`.

**A free tier that sleeps will ruin a demo.** Render's free web services spin
down when idle and cold-start on the next request, which a judge or a wearer
experiences as Dusky being broken. Use a paid instance for anything anyone else
will touch.

## 2. The five static surfaces

Each is a separate Vercel project from the same repository.

- **Root Directory**: `apps/display`, `apps/console`, `apps/market`,
  `apps/reservations`, or `apps/dispatch`
- **Enable "Include source files outside of the Root Directory"**. The workspace
  packages live in `packages/`, so the build fails without it.
- Build command `pnpm build`, output `dist`. Vite is detected automatically.

**The console needs an SPA rewrite, and it has to be somewhere Vercel reads.**
`/demo` is a client-side route, so the host must serve `index.html` for every
path or a link straight to the demo returns a 404. Vercel reads `vercel.json`
from the project's **Root Directory**, which for this project is `apps/console`,
so the rewrite lives in `apps/console/vercel.json`.

Note the discrepancy: the files in `vercel/` use repo-root-relative paths
(`apps/console/dist`), which only makes sense if the Root Directory is the
repository root. Nothing in this repository reads them, so they are reference
copies rather than configuration. If a project's Root Directory really is the
repo root, the rewrite has to move to a `vercel.json` there instead.

Either way `pnpm test:prod` checks that both `/` and `/demo` return the app,
so a misplaced rewrite fails loudly rather than waiting for a judge to find it.

**Turn deployment protection off for every public demo surface.** Vercel's
authentication sits in front of the page, and the glasses cannot log in. A
protected partner iframe also cannot expose tools to the console, so protecting
only one source produces a plausible but incomplete action list.

## 3. Environment

| Surface | Variable | Value |
| --- | --- | --- |
| relay | `DUSKY_PLANNER` | `on` to enable spoken requests, omit for menu-only |
| relay | `ANTHROPIC_API_KEY` | required only when the planner is on |
| relay | `DUSKY_AUDIT_DIR` | a directory that outlives the container, or unset for memory only |
| display | `VITE_RELAY_URL` | `wss://dusky-relay.onrender.com/display` |
| console | `VITE_RELAY_URL` | `wss://dusky-relay.onrender.com/console` |
| console | `VITE_MARKET_URL` | `https://dusky-market.vercel.app` |
| console | `VITE_RESERVATIONS_URL` | `https://dusky-reservations.vercel.app` |
| console | `VITE_DISPATCH_URL` | `https://dusky-dispatch.vercel.app` |
| console | `VITE_DISPLAY_URL` | `https://dusky-display.vercel.app` |
| market | `VITE_DUSKY_ORIGIN` | `https://dusky-console.vercel.app` |
| reservations | `VITE_DUSKY_ORIGIN` | `https://dusky-console.vercel.app` |
| dispatch | `VITE_DUSKY_ORIGIN` | `https://dusky-console.vercel.app` |

The `VITE_*` values are read at BUILD time by Vite, so changing one means
redeploying that surface, not restarting it.

`DUSKY_SOURCE` used to be here and is gone. It named ONE partner site for a
whole process, which was already a lie the moment a second site existed and is
unanswerable now that a console holds every site at once: no business name is
true above a menu containing another business's actions. A wearer reads the
name of whichever site a frame is about, sent by the console, which is the
surface that actually has them loaded. A session holding exactly one site still
reads that site's own name, derived from the tools that arrived rather than
from anything configured.

Trails on the audit disk are kept for a week and then expired, swept hourly and
once at boot. That bounds a directory whose filenames are pairing codes, which
anyone reaching the relay can invent. `/diagnostics/:id` answers "no trail for
this code" once a trail has aged out, which is deliberately a statement about
what is held rather than about what once happened.

### The two failures worth knowing in advance

**`VITE_DUSKY_ORIGIN` must be the console's exact origin.** It becomes each
partner site's `exposedTo` grant, and the browser compares it to the console's real
origin character by character. A trailing slash, a path, `http` instead of
`https`, or a preview URL instead of the production one, and Dusky discovers
zero tools. That failure looks identical to "WebMCP is broken", so check it
first whenever the console shows an empty tool list. No query parameter can
override this grant. Letting an embedding page choose its own authorization
origin would turn `exposedTo` into reflected input instead of a provider
decision. Check every site: the console holds them all at once, so one site's
grant being wrong shows up as a short list rather than an empty one.

**`wss://`, never `ws://`.** An HTTPS page cannot open an insecure WebSocket;
the browser blocks it as mixed content and the Display sits on "no connection".

## 4. Onto the glasses

Verified against `github.com/facebook/meta-wearables-webapp`, which is the
authoritative source. There is no developer mode, no registration, no
allowlisting and no review.

In the **Meta AI app** on your phone:

**Devices → Display Glasses settings → App connections → Web apps → Add a web app**

Enter a name and `https://dusky-display.vercel.app`. That is the whole install.

A QR code is optional. It encodes exactly the same two values and simply
automates typing them:

```bash
node scripts/glasses-qr.mjs --url https://dusky-display.vercel.app
```

That prints a QR in the terminal for your phone camera to read directly, and
refuses a URL the glasses could never reach. Add `--out dusky-qr.png` for a
file. The link it encodes is:

```
fb-viewapp://web_app_deep_link?appName=<name>&appUrl=<url-encoded-url>
```

This is a different path from the Device Access Toolkit, where a native phone
app renders to the glasses over Bluetooth. Here nothing is installed and
nothing is built for the phone: the glasses fetch a URL. See "Why Web Apps and
not the native toolkit" in `AGENTS.md`.

## 5. What to check on real hardware

None of this has met glasses yet, so treat every line as a hypothesis:

- Arrow keys and Enter arrive as `useDpad` expects, and Escape goes back.
- The WebSocket survives the display sleeping and dimming. The reconnect logic
  in `useRelay` exists and has never been tested against a real radio.
- The composer opens on focus-then-tap and commits exactly once, by handwriting
  and by dictation.
- The Display loads inside Meta's budget. The bundle is 63 KB gzipped, well
  under the 500 KB ceiling, but load time over the glasses' own link is unknown.

Report what fails rather than what works.
