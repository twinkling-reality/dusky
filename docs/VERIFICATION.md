# Verification

Dusky separates unit, browser, visual, deployment, and hardware evidence. A
passing result supports only the layer it exercised.

## Local development snapshot

On 2026-08-30, the local development snapshot passed:

- 371 of 371 unit and deterministic tests with `pnpm test`;
- type checking with `pnpm typecheck`;
- linting with `pnpm lint`;
- a complete build with `pnpm build`;
- 34 of 34 local Playwright tests with `pnpm test:e2e`, including all 6
  load-bearing round-trip tests and the focused five-frame visual check.

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

On 2026-08-29, commit `f7d9656` passed the 10 production tests that existed at
that time against the official deployment.

The current official production suite contains 11 tests. It has not passed
against a deployment containing the present local changes, so no current
production result is claimed.

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
