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

## Rules that are load-bearing

1. **No per-site branching, ever.** If a frame depends on WHICH site registered
   a tool, Dusky has become a hardcoded integration wearing a protocol costume.
   Everything the wearer sees is derived from tool schemas in `packages/frames`.
2. **The model proposes, code disposes.** Whether a human must confirm is
   decided in `packages/policy`, which has no model, no network and no DOM.
   A `Planner` may only suggest; `Session` enforces. There is a test asserting a
   planner cannot launder a consequential tool through the resolver path.
3. **Success is asserted from a returned tool result, never from having called.**
4. **An annotation may lower ceremony, never raise it.** `readOnlyHint` is a
   hint from a party that may be hostile, and Chrome passes only 1 of 4 WPT
   annotation tests. Hard danger verbs override it; see `classifyDetailed`.
5. **Never auto-retry anything that is not read-only.** A timeout is "unknown",
   not "did not happen".
6. **`packages/policy` must stay dependency-free.** If it ever imports the agent
   or a transport, the deterministic guarantee is gone.

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
