# Contributing to Dusky

Dusky turns authorized WebMCP tools in a desktop browser into a
gesture-controlled interface on Meta Ray-Ban Display.

Start with the [architecture](./docs/ARCHITECTURE.md),
[trust model](./docs/TRUST-MODEL.md), and
[genericity boundary](./docs/GENERICITY.md). Changes that weaken those
boundaries are not accepted merely because they improve a fixture demo.

## Development setup

Requirements:

- Node.js 22 or newer;
- pnpm 10;
- Chrome with WebMCP testing enabled for browser tests.

```bash
pnpm install
pnpm exec playwright install chrome
pnpm dev
```

Open <http://localhost:7803>.

Playwright launches that Chrome channel with `WebMCPTesting` enabled. For
manual browser use, enable `chrome://flags/#enable-webmcp-testing` yourself.

## Before submitting a change

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
```

The browser suite uses real Chrome WebMCP rather than a protocol mock. A change
to discovery, frames, policy, session behavior, provider registration, or relay
transport should include the relevant real-browser test.

## Design rules

### Do not add provider branches

Shared packages must not branch on a provider brand, known origin, complete
fixture tool name, or fixture-specific result key.

When a provider reveals a missing case, fix the schema, protocol, policy, or
result rule that generalizes beyond that provider.

### Preserve tool identity

Tool identity is `(origin, name)`. A name alone is not safe when more than one
origin can publish it.

### Keep models outside authority

A planner may propose. Deterministic code validates tool identity, candidates,
declared argument names, supported primitive conversion, enum membership,
policy, and live availability. Providers remain responsible for full JSON
Schema validation.

### Keep transfer consent separate

Approving a cross-origin value fills one destination argument. It never
approves the destination action.

### Do not retry uncertain writes

A timeout means the result is unknown. Never automatically retry an action
classified as non-read.

### Respect the Display contract

The Display is fixed at 600 by 600 with no scrolling. Interactive targets are
at least 88 pixels high. Parameter and projection screens keep a visible Back
row. Provider submenus keep Back to sites.

## Adding a provider fixture

A fixture should exercise a schema, result, security, or browser behavior that
existing fixtures cannot reach.

Do not add a fixture merely to expand a list of brands. Document the generic
case it exposes and add a browser test that invokes its real tool.

See [Provider guide](./docs/PROVIDER-GUIDE.md).

## Recording evidence

Do not describe a test as current without running it against the intended
working tree or deployment.

Record date, commit, environment, command, and complete result in
[Verification](./docs/VERIFICATION.md). Keep historical debugging narratives in
[Field notes](./FIELD-NOTES.md).

## Pull requests

Explain:

- what invariant or user behavior changes;
- why the change is provider-independent;
- which tests demonstrate the complete path;
- whether browser, deployment, or hardware evidence changed;
- any remaining limitation.

Do not include generated secrets, credentials, local audit trails, or pairing
codes.

Maintainers review changes against the documented runtime evidence and
load-bearing rules. WebMCP is experimental, so a browser workaround may change
when a measured runtime changes. A behavior described as compatible must name
the browser or provider path that was tested.

The project currently requires neither a contributor license agreement nor a
Developer Certificate of Origin sign-off. Contributions remain subject to the
repository's MIT license and [Code of Conduct](./CODE_OF_CONDUCT.md).
