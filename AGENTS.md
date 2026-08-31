# Dusky contributor rules

Dusky turns authorized WebMCP tools into a gesture-driven interface for Meta
Ray-Ban Display.

Do not guess about browser or device behavior. Inspect the implementation, run
the relevant tests, and prefer measured runtime evidence when it conflicts with
documentation.

## Read the focused documents

- [Architecture](./docs/ARCHITECTURE.md)
- [Trust model](./docs/TRUST-MODEL.md)
- [Provider guide](./docs/PROVIDER-GUIDE.md)
- [Genericity](./docs/GENERICITY.md)
- [Verification](./docs/VERIFICATION.md)
- [WebMCP and display runtime](./docs/WEBMCP-RUNTIME.md)
- [Deployment](./DEPLOY.md)
- [Field notes](./FIELD-NOTES.md)

Keep detailed rationale in those documents. Keep this file focused on rules
that must survive code changes.

## Runtime boundaries

- `apps/display` renders one frame and sends wearer input. It executes no tools and owns no task state.
- `apps/console` loads provider pages, discovers WebMCP tools, and invokes live handles in those pages.
- `apps/server` owns each paired task and pushes every visible frame to the Display.

Browser-managed cookies and session state are not copied into tool descriptors.
Tool arguments and raw result strings pass through the relay while a task runs.

## Load-bearing rules

### 1. No provider-specific behavior

Shared behavior must not branch on a known provider, origin, brand, complete
fixture tool name, or provider-specific result key.

The source registry may contain display metadata and URLs. It must not contain
tools, adapters, policy, argument mappings, or result parsers.

When a provider reveals a generic bug, fix the generic rule and add a test.

### 2. Identity is `(origin, name)`

A tool name is not unique. Wearer choices, live handles, queued steps, and
invocation targets must preserve both origin and name.

A bare name may resolve only when it is unique among the candidates offered.

### 3. The model proposes and code disposes

A planner may suggest tools and arguments. It cannot authorize them.

Validate planner output in `packages/planner` and independently in
`packages/session`. The tool must have been offered and Display-operable, its
identity must resolve, argument names must be declared, and values must pass
the supported primitive conversion or enum check.

Dusky does not implement full JSON Schema validation. Providers must validate
their complete input before performing an action.

Planner failure returns the wearer to deterministic menus and parameters.

### 4. Success comes from the returned result

Do not report success merely because invocation returned. An explicit negative
result is failure. Unknown shapes are not automatically failure.

Tool output is always untrusted and must remain bounded inert text.

### 5. Annotations may lower ceremony, not authority

`readOnlyHint` is a provider claim. Hard financial, destructive, schema, or
leading mutation evidence can prevent it from lowering ceremony.

Unknown tools default to write. Every non-read classification requires wearer
confirmation.

`packages/policy` remains deterministic and dependency-free. It has no model,
network, DOM, clock, random source, or application dependency.

### 6. Never retry a non-read action automatically

A timeout means the outcome is unknown. Only reads may offer an automatic retry.

A browser compatibility probe must use a temporary local read-only tool. Never
use an ordinary provider action to discover the browser's argument shape.

### 7. Automatic resolvers stay on the target origin

A resolver must be read-only and same-origin with its target. Filter candidates
before planning and validate the answer again in the session.

Cross-origin reuse requires explicit transfer consent.

### 8. Preserve origin fairness

Alphabetical ties must not allow one origin to occupy every remaining planner
slot. Keep positive matches in score order and fill unmatched capacity fairly
across origins.

Only domain-neutral action synonyms belong in the shared synonym list.

### 9. Accept a bounded plan whole

A task contains at most four ordered end actions. Validate every tool identity
and Display-operability before starting. Reject the whole plan if any tool is
unknown, ambiguous, unavailable, or cannot be driven on the Display.

Drop undeclared or incompatible proposed arguments and collect any remaining
required values through the ordinary Display flow.

Resolve each step again when it begins. Each step receives its own parameter
handling and policy gate. One approval never covers two invocations.

Bind parameter handling and policy to the exact discovered declaration. Recheck
that declaration in the session and again against the browser's live handle
immediately before invocation. A matching `(origin, name)` is not enough when
the declaration changed.

### 10. Cross-origin transfer requires exact consent

Retain only bounded projections with provenance. Do not retain the raw result as
task state or return it to the planner.

A transfer frame shows source, destination, destination argument, exact value,
Share, and Cancel.

Revalidate the destination identity, schema, argument, and value immediately
before applying it. Transfer approval does not approve the destination action.

Audit provenance and decisions, not transferred values or message bodies.

### 11. Push every visible transition

Transports push from `onTransition`, not only after a session method returns.
Planning, working, confirmation, transfer, result, and error frames must reach
the wearer when they happen.

Reconnects replay an unchanged frame with the same frame identifier so focus
does not reset.

Reject choices, text, and cancellation whose frame identifier is no longer
current. Replay the current frame without applying or acknowledging stale
input.

### 12. Outside agents cannot replace a wearer decision

Agent requests contain no session identifier and apply only to the session
paired with that console document.

Refuse a new task while the wearer is deciding or an unfinished task is active.
Cancellation remains allowed because it cannot authorize work. It clears
pending and future state but cannot recall an invocation already sent.

## Display constraints

- Fixed 600 by 600 pixels with no scrolling
- Interactive targets at least 88 pixels high
- At most four rows
- Visible Back on parameter and projection screens
- Back to sites inside provider submenus
- Navigation handled before argument coercion
- Additive-display palette
- No pointer, camera, microphone, notification, or raw-gesture assumptions
- Composer commits once on Enter or blur

## Browser and React traps

Production WebMCP compatibility belongs in `packages/webmcp`.

- Use `document.modelContext`.
- Cross-origin discovery requires provider `exposedTo`, consumer `fromOrigins`, and iframe `allow="tools"`.
- Filter discovery to requested origins.
- Parse `inputSchema` defensively.
- Do not depend on browser tool order.
- Forward session cancellation to the paired browser invocation.
- Keep a session deadline because browser cancellation may not stop execution.

React-specific rules:

- WebSocket effect disposal state belongs to that effect invocation, not a shared ref.
- Create the caller-owned registration controller synchronously.
- Do not rebuild stable origin arrays on every render when they are effect dependencies.

## Verification

```bash
pnpm dev
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
pnpm exec playwright test e2e/roundtrip.spec.ts
```

`e2e/roundtrip.spec.ts` is the load-bearing local proof. It must drive a Display
choice through the relay and console, invoke a real WebMCP tool in a provider
document, observe the result, and render the next frame.

Run production tests only after the intended commit is deployed:

```bash
pnpm test:prod
```

Record results with date, commit, and environment in
[Verification](./docs/VERIFICATION.md).
