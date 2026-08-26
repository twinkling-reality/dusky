# Deploying Dusky, and getting it onto the glasses

Four surfaces. Three are static and belong on any CDN. One holds WebSockets and
does not.

| Surface | What it is | Where it runs | Host |
| --- | --- | --- | --- |
| `apps/display` | The 600x600 app the wearer sees | On the glasses | Vercel |
| `apps/console` | Dusky's WebMCP client | A desktop browser | Vercel |
| `apps/market` | Verdant Market, the test service | A desktop browser | Vercel |
| `apps/server` | The session relay | A server | Render, Railway or Fly |

**Only the Display runs on the glasses.** Tools execute inside the partner
site's document in the console's browser, which is why Dusky never holds a
partner's credentials. A real test therefore needs the Display on the glasses
AND the console open on a computer, in Chrome with the WebMCP flag or in the
ChatGPT desktop browser. Glasses alone cannot do anything, and that separation
is the architecture rather than a limitation.

## Choose all four names before deploying anything

The console needs the market's URL, and the market needs the console's origin.
That looks circular and is not, because a Vercel project's URL is derived from
its name. Pick the names first and every value below is known before the first
deploy.

```
dusky-display.vercel.app
dusky-console.vercel.app
dusky-market.vercel.app
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

## 2. The three static surfaces

Each is a separate Vercel project from the same repository.

- **Root Directory**: `apps/display`, `apps/console`, `apps/market`
- **Enable "Include source files outside of the Root Directory"**. The workspace
  packages live in `packages/`, so the build fails without it.
- Build command `pnpm build`, output `dist`. Vite is detected automatically.

**Turn deployment protection off for the Display.** Vercel's authentication
sits in front of the page, and the glasses cannot log in. Meta's own
documentation calls this out. The console and market can stay protected if you
would rather they were.

## 3. Environment

| Surface | Variable | Value |
| --- | --- | --- |
| relay | `DUSKY_SOURCE` | `Verdant Market` |
| relay | `DUSKY_PLANNER` | `on` to enable spoken requests, omit for menu-only |
| relay | `ANTHROPIC_API_KEY` | required only when the planner is on |
| display | `VITE_RELAY_URL` | `wss://dusky-relay.onrender.com/display` |
| console | `VITE_RELAY_URL` | `wss://dusky-relay.onrender.com/console` |
| console | `VITE_MARKET_URL` | `https://dusky-market.vercel.app` |
| console | `VITE_DISPLAY_URL` | `https://dusky-display.vercel.app` |
| market | `VITE_DUSKY_ORIGIN` | `https://dusky-console.vercel.app` |

These are read at BUILD time by Vite, so changing one means redeploying that
surface, not restarting it.

### The two failures worth knowing in advance

**`VITE_DUSKY_ORIGIN` must be the console's exact origin.** It becomes the
market's `exposedTo` grant, and the browser compares it to the console's real
origin character by character. A trailing slash, a path, `http` instead of
`https`, or a preview URL instead of the production one, and Dusky discovers
zero tools. That failure looks identical to "WebMCP is broken", so check it
first whenever the console shows an empty tool list. The `?agent=` query
parameter on the market overrides it at runtime, which is the fastest way to
confirm a mismatch is the cause.

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
