# Deploy Dusky

Dusky has five static web surfaces and one WebSocket relay. The Display runs on
Meta Ray-Ban Display. Provider tools run inside provider pages in the console's
desktop browser.

## Choose deployment origins first

Every surface needs a stable public origin before the build-time variables can
be set. A self-hosted deployment needs values for:

| Surface | Project root | Example origin |
| --- | --- | --- |
| Display | `apps/display` | `https://display.example` |
| Console | `apps/console` | `https://console.example` |
| Market fixture | `apps/market` | `https://market.example` |
| Reservations fixture | `apps/reservations` | `https://reservations.example` |
| Communications fixture | `apps/dispatch` | `https://dispatch.example` |
| Relay | `apps/server` | `https://relay.example` |

The five static surfaces can run on any public CDN. The relay needs persistent
WebSocket support. Deployment protection or a login page prevents the glasses
or provider frames from loading.

## Static hosting

Create one Vercel project for each static root:

```text
apps/display
apps/console
apps/market
apps/reservations
apps/dispatch
```

For each project:

- set **Root Directory** to that app path;
- enable **Include source files outside of the Root Directory**;
- use `pnpm build` as the build command;
- use `dist` as the output directory;
- keep the framework set to Vite;
- make every surface public if it is intended to work on the glasses or inside
  the console.

`apps/console/vercel.json` supplies the SPA rewrite for `/demo`. Another host
must provide an equivalent fallback from application routes to `index.html`.

## Relay hosting

`render.yaml` defines the current Render service.

Build:

```bash
pnpm --version && pnpm install --prod --frozen-lockfile
```

Start:

```bash
pnpm --filter @dusky/app-server start
```

Health endpoint:

```text
/health
```

A healthy relay returns an object containing:

```json
{"ok":true}
```

The checked-in configuration mounts audit storage at `/var/data`. If the disk
is removed, remove `DUSKY_AUDIT_DIR` so the deployment is explicitly
memory-only. Avoid a relay plan that sleeps before a public demonstration.

Read [Security](./SECURITY.md) before exposing a relay to the public internet.
The current relay uses short pairing codes rather than accounts and does not
implement WebSocket Origin checks or request rate limiting.

## Environment

Vite reads `VITE_*` variables at build time. Changing one requires rebuilding
and redeploying that surface.

Replace every example hostname below with the origins chosen for the same
deployment.

### Display

| Variable | Self-hosted example |
| --- | --- |
| `VITE_RELAY_URL` | `wss://relay.example/display` |

### Console

| Variable | Self-hosted example |
| --- | --- |
| `VITE_RELAY_URL` | `wss://relay.example/console` |
| `VITE_DISPLAY_URL` | `https://display.example` |
| `VITE_MARKET_URL` | `https://market.example` |
| `VITE_RESERVATIONS_URL` | `https://reservations.example` |
| `VITE_DISPATCH_URL` | `https://dispatch.example` |

### Provider fixtures

Set this on market, reservations, and communications:

| Variable | Self-hosted example |
| --- | --- |
| `VITE_DUSKY_ORIGIN` | `https://console.example` |

### Relay

| Variable | Required | Value |
| --- | --- | --- |
| `DUSKY_AUDIT_DIR` | With persistent audit storage | A persistent directory such as `/var/data/audit` |
| `DUSKY_PLANNER` | No | `on` to enable interpreted and multi-step requests |
| `ANTHROPIC_API_KEY` | When using the current Anthropic planner | Store as a host secret |

The planner is optional. Without it, Dusky remains menu-driven. Enabling the
current planner sends the wearer's request and a bounded shortlist of
provider-authored tool metadata to Anthropic. See [Security](./SECURITY.md) for
the exact data boundary.

## Exact-origin authorization

`VITE_DUSKY_ORIGIN` becomes each fixture provider's WebMCP `exposedTo` grant.
It must exactly match that deployment's console origin.

For the self-hosted example:

```text
https://console.example
```

Do not add a trailing slash, path, query, different scheme, or unrelated
preview origin. One wrong grant may appear as an incomplete action list when
other providers still work. Runtime `site` values cannot override this
authorization.

## Secure WebSockets

HTTPS pages must use `wss://` URLs with the correct relay path:

```text
wss://relay.example/display
wss://relay.example/console
```

The browser blocks `ws://` from an HTTPS page as mixed content.

## Official deployment example

The repository's public demo currently uses these stable origins:

| Surface | Origin |
| --- | --- |
| Display | <https://dusky-display.vercel.app> |
| Console | <https://dusky-console.vercel.app> |
| Market fixture | <https://dusky-market.vercel.app> |
| Reservations fixture | <https://dusky-reservations.vercel.app> |
| Communications fixture | <https://dusky-dispatch.vercel.app> |
| Runtime provider | <https://dusky-canopy-lab.glendonchin.chatgpt.site> |
| Relay | <https://dusky-relay.onrender.com> |

These values are examples for the official deployment. Do not copy them into a
self-hosted deployment unless the intention is to connect to the official
services.

## Install on the glasses

In the Meta AI app, open:

**Devices → Display Glasses settings → App connections → Web apps → Add a web app**

Add the Display URL for the deployment. For the official example:

```text
https://dusky-display.vercel.app
```

An optional QR code can be generated with:

```bash
node scripts/glasses-qr.mjs --url https://display.example
```

After opening Dusky, read the six-letter code, open that deployment's console
demo, enter the code, and keep the console open while using the glasses.

## Release verification

Before claiming a production release works:

1. Record `git rev-parse HEAD`.
2. Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test:e2e`.
3. Deploy every affected surface.
4. Verify each environment variable on the correct project.
5. Wait for deployments and the relay restart.
6. Check the relay health endpoint.
7. Run a production browser suite against the exact deployed origins.
8. Require every test in that suite to pass.
9. Record the commit, date, environment, command, and complete result.

`pnpm test:prod` currently targets the six official origins hardcoded in
`e2e/production.spec.ts`. It does not verify a self-hosted deployment. Point an
equivalent suite at the self-hosted origins before making a self-hosted
production claim.

The official production suite also expects the official planner profile to be
enabled and usable. It checks browser-agent status and sends a live two-step
request. A menu-only deployment is supported by the application but cannot pass
that unchanged official suite.

## Historical production evidence

Commit `f7d9656` passed the then-current ten production tests against the
official deployment on 2026-08-29. That result applies only to that commit and
deployment state. A current production claim requires a new complete run after
the intended commit is deployed.
