# Dusky submission record

This file preserves the hackathon description and recording plan. It is not the
primary developer guide or a current deployment claim.

## One-line description

Dusky turns authorized website actions into simple Meta Ray-Ban Display
screens, with confirmation before any action it does not classify as read-only.

## Project description

Meta Ray-Ban Display has a 600 by 600 screen, no cursor, no scrolling, four
directional inputs, Enter, and Escape. A normal website does not fit that
interaction model.

Dusky starts from the actions a provider declares through WebMCP. It uses the
supported parts of each tool schema to build the screens needed to use it:
provider menus, allowed values, text entry, confirmation, progress, transfer
consent, and results.

Tools execute inside their provider pages in the user's desktop browser. The
provider must explicitly authorize the Dusky console origin before the browser
exposes its tools.

The browser holds live provider handles and browser-managed session state. The
relay holds task state and deterministic policy. Tool arguments and raw result
strings pass through the relay.

With the optional planner, one request can become a bounded plan of up to four
actions. The planner can propose but cannot authorize. Dusky validates the plan
against the tools the browser offered and rechecks each step against the live
registry and schema before it begins.

Cross-provider information transfer is a separate decision. Dusky retains only
bounded primitive projections and a generic summary from an intermediate
result. Before one value fills another provider's argument, the Display shows
the source, destination, field, and exact value. Sharing does not approve the
destination action.

The demo contains three first-party fixture providers with eleven tools across
shopping, reservations, and communications. A fourth test-only provider is
absent from the default registry. A real-Chrome test supplies its URL at
runtime, discovers its tool, builds an enum screen, invokes it, and renders its
unfamiliar result fields without a provider adapter.

This is evidence for the providers and schemas tested. It is not a claim of
compatibility with arbitrary websites or every possible WebMCP schema.

See [Verification](./docs/VERIFICATION.md) for dated local counts and the
separate production status. This record does not claim that its current text is
deployed.

The deterministic evaluation reports 18 of 21 shortlist recall, 6 of 6
compound coverage, and 3 of 3 compatible result handoffs. Recall means the
expected tool reached the shortlist. It is not model accuracy.

Source: <https://github.com/twinkling-reality/dusky>

## Demo script, target 2:40

### 0:00 to 0:15

Show the real Display recording.

> This is Dusky on Meta Ray-Ban Display. It converts supported WebMCP tool
> schemas into a 600 by 600 interface and confirms tools it classifies as
> non-read on the glasses.

### 0:15 to 0:35

Reveal the console, the three fixture providers, the Display panel, and the
protocol log.

> Each provider explicitly exposes its own WebMCP tools to the console. The
> browser holds the provider sessions. Dusky builds the Display interaction from
> the schemas the browser returns.

Point at `getTools({fromOrigins})`, the combined action registry, and the
provider labels.

### 0:35 to 1:40

Submit:

> Reserve a table for four, then send the reservation details to Dana.

This live model route can time out, decline, or fill parameters differently.
Record the following sequence only when it actually occurs, and do not edit
around a missing decision:

1. answer any missing reservation parameter;
2. stop on the reservation confirmation;
3. confirm and show the reservations page update;
4. stop on the visible next-step frame;
5. choose Dana from the communications provider's lookup;
6. choose the reservation projection;
7. stop on the transfer frame and read source, destination, field, and value;
8. choose Share;
9. stop on the separate message confirmation;
10. confirm and show the outbox and final result.

> Sharing the reservation value did not send the message. The transfer and the
> destination action were two separate wearer decisions.

### 1:40 to 1:58

Show a reservation schema beside generated enum, numeric, boolean, and composer
screens. Show the visible Back row.

> These controls come from JSON Schema. No reservation-specific Display screen
> exists in Dusky.

### 1:58 to 2:18

Show Canopy Lab supplied through a runtime `site` value. Choose `garden` and
show the returned shade and condition fields.

> Canopy Lab is absent from the default registry. The browser test supplies its
> URL at runtime and completes the same WebMCP-to-Display path without a provider
> adapter. That proves this provider path, not universal compatibility.

### 2:18 to 2:30

Show the browser agent calling `list_display_actions` or
`send_task_to_display`.

> Dusky also exposes WebMCP tools. An agent in this browser can request a task,
> while the session and confirmation rules remain in control.

### 2:30 to 2:40

Return to the final Display frame and updated fixture pages.

> WebMCP supplies provider capabilities. Dusky turns them into a Display
> interaction with the wearer in the visible decision path.

## Recording preflight

- Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
- Require all local Playwright tests to pass.
- Describe the planner configuration accurately.
- Do not skip either action confirmation or the transfer frame.
- Confirm Back and Back to sites remain visible.
- Confirm Canopy Lab is absent from the default registry.
- Describe all bundled providers as fixtures.
- Do not claim compatibility with arbitrary websites.
- Clear fixture state before each take.
- If recording a deployment, run `pnpm test:prod` after deploying the intended commit.
- Verify focus, Enter, Escape, composer, and reconnect behavior on physical glasses.
- Record through the Meta AI app.
- Keep the final edit under three minutes and include narration.
