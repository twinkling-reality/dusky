# Verification

## OpenAI Render production verification on 2026-09-02

Commits `021c589` and `ad38ffb` were pushed to `main`. The Render Blueprint now
selects OpenAI explicitly, retains `OPENAI_API_KEY` as a dashboard-managed
`sync: false` secret, and clears the obsolete paid-disk audit path. The final
free-instance startup log reported `planner enabled with openai`, followed by
the in-memory audit-store notice and the relay listener. No later disk
permission warning appeared. The public health endpoint returned HTTP 200 with
`{"ok":true,"sessions":1}`.

After the final deployment settled, `pnpm test:prod` passed all 12 production
Playwright tests in 46.9 seconds. The last test made one bounded live planner
request through the newly selected OpenAI adapter and advanced the intended
two-step Amber & Oak to Northstar Dispatch task to its first parameter screen.
This validates the deployed credential and adapter path and may have incurred
the ordinary API usage for that single request.

GitHub Actions run `33626925747` passed at `ad38ffb`: the verification job
completed lint, all package typechecks, all builds, and all deterministic
tests; the round-trip job completed the full local Playwright suite.

This deployment evidence does not resolve the separate physical-glasses
WebSocket upgrade, focus, composer, reconnect, sleep, radio, or changing-light
evidence boundary.

## Model-provider modularity local verification on 2026-09-01

Implementation commit `fd61c38` added the OpenAI Responses adapter, retained
the Anthropic Messages adapter, moved their stable decision schema into a
provider-neutral module, and made relay provider selection explicit. The
operator documentation and deployment configuration were then updated in the
following documentation commit.

Current official OpenAI documentation was checked before implementation. It
established the Responses API `text.format` strict JSON Schema shape, explicit
refusal and incomplete-response states, and current Responses plus Structured
Outputs support for the GPT-5.6 family. The adapter defaults to
`gpt-5.6-luna` for the fast tier and `gpt-5.6-terra` for the careful tier.

The complete local verification ran on macOS in Google Chrome 152 with
WebMCP Testing enabled:

- `pnpm test`: 451 of 451 unit and deterministic tests passed;
- `pnpm typecheck`: all 15 package typechecks passed;
- `pnpm lint`: no errors and the same five retained CSS specificity warnings;
- `pnpm build`: all six build tasks passed;
- `pnpm test:e2e`: all 49 local Playwright tests passed in 2.7 minutes; and
- `pnpm exec playwright test e2e/roundtrip.spec.ts`: all 7 focused real-WebMCP
  round-trip tests passed in 53.2 seconds.

The focused planner, adapter, server factory, and executable genericity run
passed 118 of 118 tests while iterating. OpenAI adapter coverage includes exact
Structured Outputs request shape, tier models, overrides, ordered multi-step
parsing, refusal, incomplete and malformed declines, observable authentication,
transport and in-band service failures, zero SDK retries, and propagated
timeouts. Server tests cover explicit OpenAI and Anthropic selection, missing
and invalid provider configuration, missing credentials, menu-only operation,
and the full session fallback through each adapter. Existing deterministic
planner tests continue to cover unknown and ambiguous tools, undeclared or
unsupported arguments, consequential actions, and hostile provider metadata.

No OpenAI or Anthropic credential was present in the local environment. Both
adapters were exercised against local HTTP stubs, and both complete
session-fallback paths were exercised against unreachable local endpoints. This
is adapter and wiring evidence, not a live OpenAI model call. After both browser
runs, no listener remained on ports 7801 through 7806 or 7900 and no spawned
Playwright, Chrome, Vite, or relay watcher remained.

No production claim is made in this entry. Deployment and production evidence
must name the subsequently deployed commit. The unresolved physical-glasses
WebSocket upgrade issue remains a separate evidence boundary.

## Model-provider modularity production verification on 2026-09-01

Commits `fd61c38` and `84db5a2` were pushed to `main`. The relay deployment at
`84db5a2` explicitly selected Anthropic through `DUSKY_MODEL_PROVIDER`, retained
the existing secret configured through Render's `sync: false` environment
entry, and restarted successfully. The public health endpoint returned HTTP
200 with `{"ok":true}` after the restart. The Console and Amber & Oak Vercel
deployments also completed successfully; the other public application sources
were unchanged.

After deployment settled, `pnpm test:prod` passed all 12 production Playwright
tests in 34.5 seconds. The run proved that every official surface remained
public, all three bundled providers were discovered, a deployed Display gesture
changed a deployed provider, the public Canopy Lab provider connected and ran
without a registry entry, the browser agent reached the paired session, and the
live selected planner admitted the intended two-step Amber & Oak to Northstar
Dispatch task and advanced to its first parameter screen.

GitHub Actions run `33582595731` passed at `84db5a2`: the verification job
completed lint, all package typechecks, all builds, and all 451 deterministic
tests; the round-trip job completed all 49 local Playwright tests.

The first production attempt overlapped the rolling relay restart and completed
11 of 12 tests. Its retained trace showed the exact boundary: the HTTP health
endpoint had recovered while WebSocket upgrades still returned HTTP 500. The
console's retry connected with HTTP 101 just after the affected assertion's
30-second deadline, and the trace's final page snapshot showed the expected
three reservation actions. No product assertion failed after WebSocket service
stabilized, and the complete clean rerun is the production result claimed here.

This deployed verification exercises the retained live Anthropic configuration.
No OpenAI credential was available, so it is not evidence of a live OpenAI API
call. OpenAI request behavior is covered by the local stub and fallback tests in
the preceding entry. As with every browser and hosted-service record, this does
not resolve the physical-glasses WebSocket upgrade, focus, composer, reconnect,
sleep, radio, or changing-light evidence boundary.

## Hackathon release verification on 2026-09-01

Commit `653b0e2` was pushed to `main` and deployed to the official Console,
relay, and public Canopy Lab origins. Canopy Lab version 5 replaced the
internal provider-proof presentation with a public shade-planning interface
without changing its generic `estimate_shade` contract.

The final local release checks completed on macOS in Google Chrome 152 with
WebMCP Testing enabled:

- 432 of 432 unit and deterministic tests passed;
- all 15 package typechecks passed;
- lint completed with no errors and the same five retained CSS specificity
  warnings;
- all six build tasks passed;
- all 49 local Playwright tests passed in 2.6 minutes; and
- the rebuilt Canopy Lab passed its own lint and production build, loaded with
  no React hydration error, and completed the focused real-WebMCP runtime
  provider round trip.

After the final deployments and relay restart, all 12 production Playwright
tests passed in 35.8 seconds. The suite proved that every official surface was
public, all three bundled providers were discovered, a deployed Display
gesture changed a deployed provider, Canopy Lab connected and ran without a
registry entry, the browser agent reached the paired session, and the live
planner admitted the intended two-step cross-site task after discovery
settled. GitHub Actions run `33578453761` passed both the verification and
49-test round-trip jobs for the same commit.

This release record does not replace a fresh physical-glasses preflight. The
previous device-side WebSocket-upgrade failure, focus, composer, reconnect,
sleep, and changing-light checks remain hardware evidence only.

## Public runtime provider verification on 2026-09-01

Canopy Lab version 3 was published at
<https://dusky-canopy-lab.glendonchin.chatgpt.site>. The public response was
HTTP 200 with no `X-Frame-Options` or restrictive `frame-ancestors` header.

Two real Chrome round trips passed with WebMCP enabled:

- the product-facing flow pasted the public URL into **Add Website**, verified
  the live page, added it automatically as a fourth Website, and showed twelve
  actions across four branches;
- the local console loaded the public HTTPS provider through the runtime
  `site` value, discovered **Estimate shade**, rendered its `zone` enum, invoked
  `garden`, observed `62% shade` in the provider document, and rendered the
  returned result on the Display;
- the deployed console, relay, and Display completed the same path against the
  same public provider.

The focused local and production Playwright runs each passed 1 of 1 tests. The
provider remains absent from the default source registry. Port `7806` remains
only the equivalent local Playwright fixture.

Dusky separates unit, browser, visual, deployment, and hardware evidence. A
passing result supports only the layer it exercised.

## Browser compatibility measurement on 2026-09-01

The actual ChatGPT desktop built-in browser was not available to automate on
this host. The closest available surface was the Codex desktop in-app browser,
driven through its native Browser control, against the live official URLs.

That in-app browser produced a split result:

- the landing page's own main-world self-test reported WebMCP enabled, page
  tool registration working, and relay connected;
- on `/demo?start=1`, the browser exposed Dusky's four calling-document tools:
  `get_display_status`, `list_display_actions`, `send_task_to_display`, and
  `cancel_active_task`;
- the embedded Display connected to the relay, and calling the read-only status
  tool returned that live paired session;
- all three provider iframe documents loaded, each iframe carried
  `allow="tools"`, and the provider pages rendered their fixture state; but
- after ten seconds, cross-origin discovery still returned zero provider
  actions from every origin, and the Display showed `No actions available
  here`.

The Browser controller's direct page evaluation runs in an isolated world and
reported `typeof document.modelContext === "undefined"`. That result is not
used as evidence about the page's main world. The page's own self-test
successfully registered and retrieved a temporary tool, and the Browser
controller enumerated Dusky's four producer tools, which proves functional
calling-document WebMCP. The failed fact is narrower and directly observed:
the same environment did not return the cross-origin provider tools needed for
the full Dusky path.

Chrome was measured separately through the repository's known-good launcher:
Google Chrome `152.0.7977.65`, `channel: "chrome"`, with
`--enable-features=WebMCPTesting`, against the same live `/demo?start=1` URL.
In that environment:

- `document.modelContext` was an object;
- `getTools({ fromOrigins })` returned 4 Verdant Market tools, 3 Amber & Oak
  tools, and 4 Northstar Dispatch tools;
- the same call also returned Dusky's four calling-document producer tools,
  which the console filtered out of the wearer registry;
- the console rendered all 11 provider actions; and
- Open Dusky redirected to a fresh session and mounted the embedded Display.

This was a read-only compatibility measurement, not a production task
invocation and not a production-suite run. It measures the live deployment as
served on 2026-09-01, not the uncommitted product-surface changes in this
working tree. Those changes require a console redeploy before they can be
claimed on the live URL.

## Pre-demo surface verification on 2026-09-01

The uncommitted working tree based on commit `7197ac3` passed locally on macOS
in Google Chrome 152 with `WebMCPTesting` enabled:

- 432 of 432 unit and deterministic tests with `pnpm test`;
- all 15 packages with `pnpm typecheck`;
- linting with `pnpm lint`, with no errors and the same five retained CSS
  specificity warnings;
- all six build tasks with `pnpm build`;
- a final full local Playwright run completed 45 of 46 tests, including all 7
  load-bearing real-WebMCP round-trip tests; its only failure was the first
  `page.goto` waiting 60 seconds for the full `load` event while the host was
  under heavy system load, before any product assertion ran;
- after that harness navigation was narrowed to `domcontentloaded`, both
  connections tests passed in a focused run through the supervised
  `pnpm test:e2e` wrapper. An earlier same-day full run had completed all 46
  tests before the final UI and compatibility-poll refinements.

The browser suite covered the visible producer controls, honest unavailable
state, discovery-settled agent admission, all three mounted-but-collapsed
provider frames, phone layout, reduced motion, exact approval targeting,
provider execution evidence, semantic success and explicit-negative failure,
durable multi-action log outcomes, and the complete Display-to-provider round
trip. It also selected a smaller sample set through Connections, restored the
third sample, added the fourth runtime provider by URL, observed four graph
branches and twelve actions, and proved that Apply is disabled during a wearer
confirmation. `git diff --check` also passed.

The first complete browser run caught a retained entrance `clip-path` clipping
a provider dragged beyond its original grid cell. That animation clip was
removed and the focused geometry regression passed. The final UI review also
measured zero horizontal overflow for every configured-site row at 1440 by 900
and 390 by 844, and the 1200-pixel open-page geometry regression passed. The
production suite was not run because these changes have neither a release
commit nor a deployment; the production record below remains evidence only for
its named deployed commit.

## Previous local development snapshot

On 2026-08-31, the local development snapshot passed:

- 393 of 393 unit and deterministic tests with `pnpm test`;
- type checking with `pnpm typecheck`;
- linting with `pnpm lint` with no errors and five retained CSS specificity
  warnings;
- a complete build with `pnpm build`;
- 42 of 42 local Playwright tests with `pnpm test:e2e`, including all 6
  load-bearing round-trip tests and the focused five-frame visual check.

After the Playwright run, no test-port listener or Playwright, Chrome, Vite,
relay watcher, or Turbo development descendant remained. See the
[local test-process lifecycle](./WEBMCP-RUNTIME.md#local-test-process-lifecycle)
for why cleanup is part of the local evidence.

These checks ran before the changes had a release commit, so this is dated
development evidence rather than an immutable release record. A production
claim must name the deployed commit and rerun the production suite.

The local Playwright suite used Chrome with WebMCP testing enabled. It exercised
real `document.modelContext`, registration, cross-origin discovery, one-shot
invocation, provider grouping, runtime provider replacement, browser-agent
control, session lifecycle constraints, and cross-provider value transfer.

The suite does not drop an established Display or console socket and prove
reconnect replay through a real browser. Frame-id preservation and stale-input
rejection have relay unit coverage.

The local suite excludes `e2e/production.spec.ts`.

## Deterministic planner measurements

The current evaluation corpus reports:

- shortlist recall: 18 of 21 at the shipped six-tool limit;
- compound coverage: 6 of 6;
- compatible result-handoff coverage: 3 of 3.

Recall means the expected tool reached the planner's shortlist. It is not model
accuracy.

Compound coverage means every expected end action reached the candidate set. It
does not mean a model selected or completed them.

Handoff coverage means a compatible bounded value survived generic extraction.
It does not approve a cross-provider transfer or destination action.

## Runtime provider proof

The round-trip suite starts a fourth provider on port `7806`. It is absent from
the default registry and uses schema and result vocabulary covered by the
shared-code genericity guard.

The test verifies runtime loading, real cross-origin discovery, generated enum
choices, visible Back navigation, invocation in the provider document, and
generic result facts.

This proves that provider and supported schema path. It is not evidence for
every possible provider or JSON Schema.

## Visual checks

The browser suite renders five critical frames through the real `FrameView`
component:

- parameter entry with Back;
- cross-origin transfer approval;
- destination confirmation;
- intermediate progress;
- final result.

Each fixture rendered at 600 by 600 pixels with equal client and scroll bounds.
Every button and input met the 88-pixel minimum. Manual inspection found no
clipped source, destination, exact-value preview, progress label, or final
provenance line. Focus hierarchy remained visible, and the transfer footer
wrapped within the frame.

These are desktop screenshots, not approved pixel baselines. They do not prove
waveguide legibility, contrast in changing light, Neural Band behavior,
composer behavior on hardware, sleep recovery, radio behavior, loading time,
or subjective quality.

## Historical official deployment evidence

On 2026-08-31, the official production suite passed against the deployed
application source at commit `ce2abe1`:

- 11 of 11 production Playwright tests passed with `pnpm test:prod` in 29.7
  seconds;
- the live planner created the intended two-step Amber & Oak to Northstar
  Dispatch task and advanced to the first action's parameter screen;
- the console waited for all 11 actions from all three provider documents
  before submitting that cross-site request;
- the official Console, Display, Verdant Market, Amber & Oak, Northstar
  Dispatch, and relay endpoints responded successfully; and
- scans of the deployed Console and provider bundles found neither of the
  removed placeholder strings `Tool activity` nor `Part of Dusky`.

Verdant Market and Northstar Dispatch were rebuilt and promoted manually
because those two Vercel projects did not have repository deployment links.
Northstar Dispatch's Vercel root directory was corrected to `apps/dispatch`
before deployment. Their application sources are unchanged between their
manual build revision and `ce2abe1`.

GitHub Actions run `33464803362` also passed at `ce2abe1`: the verification job
passed, and the round-trip job completed all 43 local Playwright tests. The
production planner measurements showed that the earlier failures were request
deadline failures rather than UI or provider discovery failures. The shipped
planner now gives its careful attempt a bounded seven-second window within a
ten-second total deadline, and the relay no longer reports an accepted agent
request when planning leaves the wearer on the idle menu.

This is browser and hosted-service evidence. It does not replace the hardware
checks listed under Visual checks.

On 2026-08-29, commit `f7d9656` passed the 10 production tests that existed at
that time against the official deployment.

`pnpm test:prod` targets the official URLs and includes a live planner request.
It does not verify a self-hosted or menu-only deployment without adaptation.

## Commands

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
pnpm exec playwright test e2e/roundtrip.spec.ts
pnpm exec playwright test e2e/frame-visual.spec.ts
pnpm test:prod
```

Run `pnpm test:prod` only after the intended revision is deployed. Record the
commit, date, environment, command, and complete outcome.
