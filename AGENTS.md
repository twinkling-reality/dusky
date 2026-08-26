# Dusky

A browser for a web made of tools instead of pages. Dusky turns a site's
declared WebMCP tools into a gesture-driven interface for Meta Ray-Ban Display.

Guidance for anyone, human or agent, working in this repository.

Most of what follows was established by running code against real browsers and
real SDKs rather than by reading documentation, and several points contradict
the published documentation. Where they do, the runtime wins and the discrepancy
is noted inline.

## The shape of the system

Three surfaces, and confusing them is the most common mistake:

- **`apps/display`** runs ON the glasses. It renders one `DisplayFrame` and
  sends one selection. It executes nothing and holds no state.
- **`apps/console`** runs in a normal browser. It is the ONLY surface that can
  touch WebMCP, because tools live inside the partner site's document in the
  user's own session. It holds the partner site in an `allow="tools"` iframe.
- **`apps/server`** owns the task state, so a console reload or a dropped socket
  replays the current frame rather than restarting the task.

The glasses hold attention and authority. The browser holds capability and
session. Dusky moves intent, never credentials.

**A transport must push on `onTransition`, not after the call returns.**
`Session` reports every frame the wearer should see as it happens. Reading only
the frame a call settles on is how the working frame ended up computed but
never transmitted: the wearer sat on an unchanged screen for the whole of a
model call and a tool invocation, which on a cursorless display is
indistinguishable from a crash. `apps/server/src/hub.ts` is the reference
implementation, and it is why the busy frames a planner introduces are visible
at all.

## Rules that are load-bearing

1. **No per-site branching, ever.** If a frame depends on WHICH site registered
   a tool, Dusky has become a hardcoded integration wearing a protocol costume.
   Everything the wearer sees is derived from tool schemas in `packages/frames`.
   This rule is easiest to break in the LAST frame, not the first. The result
   summarizer once matched `added`, `cart_total` and `removed`, which are the
   exact keys the first-party test market returns, so every other site on earth
   fell through to truncated JSON while the menu still looked perfect.
   `factsFromResult` replaced it and knows no site. Do not reintroduce a key
   because it made the demo read nicely.
2. **The model proposes, code disposes.** Whether a human must confirm is
   decided in `packages/policy`, which has no model, no network and no DOM.
   A `Planner` may only suggest; `Session` enforces. A proposal is checked
   against the candidates actually offered, and its arguments against the
   tool's own schema, in `packages/planner` AND again in `packages/session`.
   There are tests asserting a planner cannot launder a consequential tool
   through the resolver path, cannot name a tool it was not offered, and cannot
   smuggle an undeclared argument into an invocation. See "The planner" below.
3. **Success is asserted from a returned tool result, never from having called.**
   This cuts both ways, and the second edge is the one that got missed for a
   while: calling EVERY return a success is also asserting from having called.
   A site answering `{"ok": false, "error": "out of stock"}` has returned a
   result and that result is a failure. `outcomeFromResult` reads it. Only an
   explicit negative flips the verdict, because inventing a failure from a
   shape we do not recognise would be guessing in the other direction.
4. **An annotation may lower ceremony, never raise it.** `readOnlyHint` is a
   hint from a party that may be hostile, and Chrome passes only 1 of 4 WPT
   annotation tests. Hard danger verbs override it; see `classifyDetailed`.
5. **Never auto-retry anything that is not read-only.** A timeout is "unknown",
   not "did not happen".
6. **`packages/policy` must stay dependency-free.** If it ever imports the agent
   or a transport, the deterministic guarantee is gone.

## The planner, and why it cannot widen anything

`packages/planner` implements the `Planner` port that `packages/session`
defines. It is optional at runtime and off by default: set `DUSKY_PLANNER=on`
to enable it. Without it Dusky is menu-driven and fully usable, which is why a
model outage, a missing credential or a rate limit costs a wearer latency
rather than a dead end. The round-trip test passes either way.

The credential is read in `apps/server/src/planner.ts` and never leaves that
process. The Display and the console are never handed one.

**Three costs shape it.**

- *Tokens.* A model never sees a tool registry. `rank.ts` scores tools against
  the request with no model, and only the top few reach a prompt. `cards.ts`
  compiles each tool into a few lines, cached by tool version, so a task that
  takes many turns compiles each tool once.
- *Latency.* One `pickTool` or `planResolver` has a total budget. Escalation
  spends from that same budget rather than doubling it, and SDK retries are
  turned off so a 2.5s timeout cannot become 7.5s underneath us.
- *Being wrong.* A cheap model answers first. A stronger one is asked when the
  first is unsure, names something that was not on offer, or reaches for a tool
  the wearer would have to pay for. If the second tier will not stand behind an
  answer, the planner returns nothing and the wearer gets the menu.

Some requests need no model at all. When the winning tool takes no arguments
and wins its ranking outright, the planner answers directly. It never fills an
argument by lexical similarity, because a wrong argument is exactly what a
model is there to avoid.

**What is enforced in code rather than asked of the model.** Every one of these
has a test, and they are the reason a misbehaving model, a hostile site or both
together cannot widen what the machine will do.

- A name the model returns must match a candidate it was actually offered.
  Anything else is refused and recorded.
- A name two origins both registered is refused as ambiguous, so a site cannot
  hijack a familiar tool name by registering it too.
- A resolver must be read-only, checked in `packages/planner` AND again in
  `packages/session`. The planner does not rely on the session's filter: a
  guarantee that only holds while two files agree is not a guarantee. This is
  the one path where a proposal runs with no human in front of it.
- Arguments are filtered against the tool's own schema in both packages, so an
  invented `force` or `confirm` cannot ride along into an invocation and bypass
  the gate without anyone touching the gate. Values outside a declared enum are
  dropped rather than passed through.
- A planner that throws lands the wearer on the menu. It is assistance, never
  a dependency.

**Tool text is untrusted input going into a prompt.** Everything on a card
except `origin` was written by a third-party site. `safeText` strips control
characters, collapses all whitespace to single spaces and strips quotes before
delimiting, so a description cannot open a new line and impersonate a card
field, forge a second card, or close its own delimiter. A hostile description
can still argue with the model, which no escaping prevents. That is survivable
because nothing the model says is trusted: `packages/policy` decides ceremony
and never reads a description for that purpose, and a card states the ceremony
policy assigned rather than the one the site claims.

Ranking treats the same text as adversarial. Name evidence outweighs prose, and
description evidence is capped, so keyword stuffing can win a shortlist slot on
a request nothing else matches but can never outrank a genuine name match.

**Verified by execution, and what was not.** `packages/planner/src/anthropic.ts`
is the only file that knows a model provider exists. Its request shape was
checked against `@anthropic-ai/sdk` 0.120.0 by running it against a stub that
speaks the Messages API wire format, which is what
`packages/planner/src/anthropic.test.ts` does on every CI run without needing a
credential. That test found one thing worth knowing: `messages.parse()` THROWS
when content does not satisfy the schema rather than returning a null
`parsed_output`, whatever its return type suggests. An unreadable answer is
treated as the model declining; a typed `APIError` is rethrown so the planner
records a real failure and escalates.

Not verified: no request in this repository has ever reached the live API,
because tests here run without credentials. Model choice, tier defaults and the
`effort` setting are reasoned, not measured. Treat their latency and accuracy
as unmeasured until evals exist.

## Browser reality, verified 2026-08-25 against Chrome 151.0.7922.174

These are in `packages/webmcp`, the only file allowed to know them:

- The API is **`document.modelContext`**, not `navigator.modelContext`. It moved
  to `Document` on 2026-05-27. Most training data and blog posts are stale.
- **`executeTool` requires JSON-string arguments in Chrome**, despite the IDL
  taking an object. The spec changed to objects on 2026-08-17 (#246) and Chrome
  has not caught up. We try the spec shape first, then fall back. Delete the
  fallback when Chrome stable accepts objects.
- **`inputSchema` comes back as a string**, not an object. Parse defensively.
- **AbortSignal cancellation does not work** (WPT `executeTool-abort` 0/5). We
  pass the signal anyway, but `Session.execute` RACES against its own deadline.
  Awaiting the invoke directly hangs forever against a site that ignores the
  signal. This was a real bug; do not reintroduce it.
- Cross-origin consumption is browser-enforced: the provider passes
  `exposedTo: [origin]`, the consumer passes `getTools({fromOrigins})`, and the
  iframe needs `allow="tools"`. An origin that was not named gets zero tools.
- Chromium ships a CDP `WebMCP` domain (`invokeTool`, `toolsAdded`,
  `toolInvoked`, `toolResponded`). That is the future server-side path.
- Flag: `--enable-features=WebMCPTesting`, matching
  `chrome://flags/#enable-webmcp-testing`.
- Tool ordering from `getTools` is the browser's business. Never depend on it.

## Meta Ray-Ban Display reality

- Web Apps are HTML/CSS/JS on a public HTTPS URL. Fixed **600x600**, no
  scrolling, **88px** minimum interactive target, 16px body / 20-24px primary.
- The display is an **additive waveguide**: black emits nothing and is
  transparent against the room. `packages/tokens` keeps a separate `--emit-*`
  palette for this. Never theme it, never invert it.
- Input is Neural Band and temple captouch translated by the OS into
  `ArrowUp/Down/Left/Right`, `Enter`, `Escape`. No mouse, no cursor, no raw
  gestures.
- **No camera, no microphone, no notifications.** Free text arrives through the
  on-glasses composer (handwriting or dictation) on focus-then-tap, committing
  via ordinary `input`/`change` events.
- WebSocket, fetch, Service Worker and localStorage (5 MB) are supported.
- Budget: under 3s load, under 500 KB JS gzipped, under 10 network requests.
  The Display bundle is currently about 63 KB gzipped. Keep it that way.
- The docs site 400s on plain curl. Use
  `https://wearables.developer.meta.com/llms.txt?full=true`, but note its
  capability index is STALE. The authoritative source is `AGENTS.md` in
  `github.com/facebook/meta-wearables-webapp`.

## React traps already hit here

Each of these cost real debugging time. Do not undo the fixes.

- **WebSocket disposal state must be local to the effect invocation**, not a
  `useRef`. A shared ref is reset by the next mount, so the previous socket's
  close handler sees "not disposed" and starts a reconnect nobody owns. Under
  StrictMode this becomes a reconnect storm, and every reconnect pushed a new
  frame that reset the wearer's focus to the top of the list.
- **`registerTools` takes a caller-owned `signal` created synchronously.**
  Registration is async; a disposer that only exists after the promise resolves
  leaves a window where StrictMode's second pass collides with the first,
  producing "Duplicate tool name" and then unregistering the survivors.
- Composer input commits exactly once, on Enter or blur, never per keystroke.

## Commands

```bash
pnpm dev         # all four surfaces
pnpm test        # unit
pnpm test:e2e    # round trip in real Chrome with the flag
pnpm typecheck
pnpm lint
```

The planner is off unless `DUSKY_PLANNER=on` is set on the relay, alongside a
credential the Anthropic SDK can resolve. Everything passes without one.

`e2e/roundtrip.spec.ts` is the load-bearing test. If it passes, Dusky works. Run
it before claiming anything works.

## Why Web Apps and not the native toolkit

Meta exposes Ray-Ban Display to third parties two ways, and Dusky deliberately
takes the second.

The **Device Access Toolkit** is a native iOS or Android SDK: a companion phone
app renders a fixed component tree to the glasses over Bluetooth. Its input
model is the constraint that rules it out here. The display runtime consumes
directional input to move focus and the app is told only what was activated, so
it never sees a direction and cannot bind a gesture to a specific action.

**Web Apps** are ordinary HTML, CSS and JavaScript on a public HTTPS URL. They
receive real `ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight`, `Enter` and
`Escape`, they run unmodified in a desktop browser, and they need no app review
to distribute. That is why `apps/display` is a web page rather than a Swift
target, and why anyone can exercise the full product without owning hardware.
