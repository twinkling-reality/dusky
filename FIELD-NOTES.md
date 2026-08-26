# Field notes

Things that were only discovered by putting Dusky on a real pair of Meta
Ray-Ban Display glasses, deploying it to real hosts, and running it against a
real model. Every entry is something that looked fine on a desk.

Kept because the failures are more informative than the successes, and because
anyone building for this hardware will hit several of them.

---

## Wearing it

### A pairing code has to survive being read off a waveguide

`JN4CB2` was read back as `3N4CB2`, and twenty minutes went into debugging a
system that was working perfectly the whole time.

Two mistakes compounded. The code was minted with
`Math.random().toString(36)`, which mixes digits and letters, and it was
rendered inside the frame's smallest, dimmest text.

Codes are now letters only, minus `I`, `L` and `O`. Dropping digits kills every
digit-letter confusion at once (`0/O`, `1/I`, `5/S`, `8/B`, `2/Z`, `3/J`), and
dropping those three letters kills the ones that look like each other. That
leaves 23 symbols over 6 places, about 148 million codes, which is far more
than a relay holding a handful of live sessions needs.

The code also moved into the frame's largest and brightest slot. The one thing
a human has to transcribe was in the least legible element on the panel.

### You cannot de-emphasise by dimming on an additive display

The Display palette was built like a dark theme, where secondary text recedes
by being darker. That reasoning does not transfer. An additive waveguide has no
background: black emits nothing and is transparent against whatever the wearer
is looking at. Dimmer does not mean quieter, it means fewer photons competing
with a room.

`--emit-dim` went `#4f6d6c` to `#93aeac` to `#b0c2c0` over two rounds of
looking through the glasses, and was desaturated on the way. At small sizes the
teal cast read as *green text* rather than as *quiet text*; a neutral emits
across more of the spectrum and simply looks brighter at the same nominal
lightness. Teal is still right for `--emit-accent`, which is large and
deliberate.

Hierarchy on this panel comes from size, weight and case. Not brightness.

Related, found in the same pass:

- The eyebrow and footer text were **15px**, below Meta's own documented 16px
  floor. Out of spec as well as too dim.
- Body weight was **300**. A thin stroke is literally fewer lit pixels, which
  is the wrong trade when the background is an uncontrolled room. Now 400.
- Unfocused choice borders were `#1e2c2c` and emitted almost nothing, so the
  list read as a single bright row floating in space.

### The first thing a wearer saw was a lie

Before any browser paired, the glasses showed **"No actions available here /
This source declared no usable tools"**. The truth was that nothing had
connected yet, which is a completely different statement about a site.

The Display already had the right frame. It shows its own pairing screen with
the code until the relay sends something, and the relay was overwriting it
immediately on connect. The relay now stays silent until a console is actually
paired.

---

## Deploying it

### `corepack enable` fails on Render

```
Internal Error: EROFS: read-only file system, unlink '/usr/bin/pnpm'
```

Render's builder already ships pnpm at `/usr/bin/pnpm` and mounts that path
read-only, so corepack dies trying to replace a binary that was already there.
Three failed builds. The build command is just `pnpm install` and prints
`pnpm --version` first, so the next lockfile mismatch is readable from the
build log alone.

### A start command's dependencies are not dev dependencies

`tsx` runs the relay and was listed under `devDependencies`. Hosts set
`NODE_ENV=production` and skip those, so the first deploy would have died with
`tsx: command not found` after an hour of wiring environment variables, and the
obvious suspect would have been the environment variables.

Verified by doing a production-only install into a clean copy and hitting
`/health` before trusting it.

### Vercel protects deployments, and glasses cannot log in

Every new project had `ssoProtection` on, so all three URLs returned a Vercel
login page. The glasses have no way through that, and neither does a judge.
`vercel project protection disable <name> --sso`.

### Vercel refuses to store a `VITE_` variable as a secret

Correctly. Anything Vite inlines ends up in a public bundle, so calling it a
secret would be a lie. Use `--visibility config --no-sensitive`.

### Pushing to `main` drops every live session

Render auto-deploys on every commit. That kills every WebSocket, and because
the audit trail is an in-memory array it erases the record of whatever the
wearer just did. Found by pushing a fix seconds after a successful round trip
and losing the evidence of it.

Do not push while recording.

---

## Building against WebMCP

### `getTools({fromOrigins})` also returns your own tools

Verified against Chrome 151.0.7922.174 on 2026-08-26. Asking for one origin's
tools returned that origin's tools **plus this document's own registered
tools**. The moment Dusky started providing tools of its own, the partner query
went from 4 results to 8, and "Send task to display" would have appeared on the
wearer's menu as though the shop had offered it.

Caught by probing the browser rather than trusting the filter. `WebMcpBridge`
now accepts answers only from the origins it asked about, which is correct
regardless of whether Chrome changes.

### Chrome returns `title: ""` rather than omitting an absent title

Every tool Verdant Market registers declares a `title`, so for as long as it was
the only source, nothing ever asked what an absent one looks like. Amber & Oak
declares a title on one tool out of three, on purpose, and two rows in the
console immediately rendered with no name at all: a leading index, a
description, and a gate chip, with a hole where the name goes.

`title ?? name` is the natural way to write that fallback and it does not work,
because `??` only catches null and undefined. An empty string is neither.

`label()` in `packages/frames` was already correct, because it happens to test
`tool.title?.trim()` for truthiness rather than for existence, so the glasses
were fine the whole time and only the console was broken. That is worth noting:
the same latent bug was fixed in one place and live in another, and nothing
connected them. It is normalized once now, in `packages/webmcp`, which is the
only file allowed to know what browsers actually do.

### Every value a Display can send is a string

The glasses can send exactly two things: a choice id, and whatever the composer
committed. Both are text. Verdant Market declares nothing but bare strings, so
that was invisible and correct at the same time.

Amber & Oak declares `party_size` as `{"type": "integer", "enum": [1,2,3,4]}`.
A wearer tapping the second button sent the string `"2"` to a site that had
declared it would receive a number. Nothing broke, because the site coerces
what it is given, the way any site handling a browser API should. A site that
validated its own schema would have been entitled to refuse the call, and would
have been right to.

`coerce` now consults the declared parameter. An enum returns the DECLARED
member rather than a parsed copy of the label, which handles an integer enum
with no type guessing at all. It also fixed a second thing on the way in: a
string parameter whose value happens to read `"true"` was being turned into a
boolean, because the old version tested the text and had no schema to consult.

Both of these are the same lesson in different clothes. A single test source
teaches you that your code runs. It cannot tell you which of your branches have
never executed.

### `messages.parse()` throws rather than returning null

The Anthropic SDK's return type suggests a null `parsed_output` when content
does not satisfy the schema. It raises instead. An unreadable answer is the
model declining, not an outage, so it is caught and treated as an abstention
while a typed `APIError` is rethrown.

Found by running the adapter against a stub that speaks the Messages API wire
format, which is now a test that runs in CI without a credential.

---

## Found by reading rather than running

Worth listing separately: these were all live in a passing test suite.

- **`workingFrame` was computed but never transmitted.** The session set it and
  the transport only read the frame a call settled on, so the wearer stared at
  an unchanged screen for the whole of a tool invocation. On a cursorless
  display that is indistinguishable from a crash. Frames are now reported as
  they happen.
- **The result summarizer was a per-site branch.** It matched `added`,
  `cart_total` and `removed`, which are the exact keys the first-party test
  market returns. Every other site on earth fell through to truncated JSON,
  which quietly made the whole no-per-site-branching claim untrue at the last
  frame of every flow. Replaced by a generic reader, and confirmed on the
  panel: a completed purchase shows `Added / Organic oat milk`, `Cart size / 1`,
  `Cart total / $4.29`, with every label humanised from the site's own key
  names and the price formatted because it is money.
- **Every returned result was reported as a success.** A site answering
  `{"ok": false, "error": "out of stock"}` has returned a result, and that
  result is a failure. Asserting success from the fact that a call came back is
  the same mistake the rule against it was written to prevent.
- **The same lie came back through a different door.** "No actions available
  here / This source declared no usable tools" was fixed once, in the relay,
  which now stays silent until a console pairs. It was still reachable three
  other ways, and only one of the four was true. The console caught a thrown
  `discover` and reported it to the relay as an empty tool list, so a browser
  with no WebMCP produced a confident statement about a shop it had never
  reached, while the actual reason went into the console's own activity log on
  a screen the wearer is not looking at. The `tools` message now carries an
  `error`, exactly as `invoked` always did, and the wearer gets "Cannot reach
  this source" with the real reason and a retry that works.

  The second half is subtler and worth keeping. Even when discovery SUCCEEDS,
  zero tools does not mean the site declared none: it may have declared plenty
  and not named this origin in `exposedTo`, or its page may not have registered
  yet. None of that is distinguishable from here. The note now says the source
  "has not offered any actions", which is a claim about what arrived rather
  than about somebody else's page, and is true in all four cases.

  The general lesson is that a message can be true when it is written and
  become a lie when a new code path reaches it. The fix that matters is
  wording that cannot be false, not another guard.
- **Two tabs on one pairing code rebuilt the wearer's screen four times a
  second, forever.** One session holds one console, and attaching a second
  closes the first. That rule was fine; the loser not being able to tell was
  not. It saw an ordinary close, reconnected after 250ms, and evicted the
  winner, which did the same back. Measured at 20 frame pushes in 5 idle
  seconds. Reachable by one click, because the demo link carries the code, so a
  reload into a duplicate tab is enough.

  Two things had to be true for it to run away. The relay could not say WHY it
  closed a socket, which a 4000-range close code fixes. And backoff reset the
  moment a socket OPENED, so a connection that opened and died immediately
  retried at the first delay forever and never escalated: the escalation
  existed but could not be reached. A connection now has to last five seconds
  before it counts as having worked.

  Worth generalising: a retry ladder that resets on connect rather than on
  success is not a retry ladder, it is a fixed delay wearing one.
- **A shortlist with six slots was sending three cards.** `shortlist` returned
  only the tools scoring above zero whenever any tool did, so a request that
  matched three tools produced a list of three even though the cap was six. The
  right tool could therefore be excluded at EVERY size, which no amount of
  raising the limit would have fixed and which reading the function did not
  make obvious.

  It took an eval to see it. Recall over the whole registry should be perfect
  by definition, because every tool fits; it was 17 out of 19. That gap is the
  entire finding, and it was invisible while the number was a guess rather than
  a measurement.
- **"Tap to speak" had nothing to tap.** The composer was only ever produced by
  the parameter-collection frame, so the planner's entry point was unreachable
  from the glasses and could only be driven by an agent.

---

## Still unknown

Honest gaps, not oversights.

- **WebSocket survival across display sleep and dim.** Partially answered,
  and the code no longer assumes the good case.

  The glasses survived a full relay redeploy on 2026-08-26: Render restarted
  the service, every socket dropped for roughly forty seconds, and the Display
  reconnected on its own with no wearer action and no lost pairing. That covers
  relay downtime while the panel is awake.

  It does not cover the radio going quiet because the DISPLAY slept, and that
  is a different failure in a way worth spelling out. A suspend closes nothing:
  no FIN, no RST, so `readyState` stays OPEN, `send` writes into a dead socket,
  and `onclose` never fires. Every recovery path in `useRelay` hung off
  `onclose`, so there was no recovery path at all. The wearer would have kept a
  stale frame with dead controls, no reconnecting badge, and a gesture
  acknowledgement sweeping forever, which is the exact "indistinguishable from
  a crash" failure this codebase refuses everywhere else. The relay would have
  gone on reporting `display_connected: true` and accepting agent tasks into a
  void.

  Now the Display pings every 15s and tears the socket down after 30s of
  silence, `visibilitychange` and `pageshow` probe on resume rather than
  waiting out a watchdog that could not have been running while the page was
  suspended, and the relay answers with `pong` even before a console has
  paired. The relay also pings at the socket level and terminates what does not
  answer, so a half-open connection stops being reported as live.
  `e2e/liveness.spec.ts` proves the traffic flows in a real browser.

  **Still untested: the suspend itself.** Nothing here has met a sleeping pair
  of glasses. The mechanism is now present and exercised; whether 15s and 30s
  are the right numbers against a real radio is a guess.
- **The composer's focus-then-tap behaviour** on handwriting and dictation.
- **How a wearer launches or exits a web app on the glasses.** Meta's own
  documentation covers deployment and the companion-app flow in detail and does
  not describe the on-device launcher at all.
- ~~**Audit durability.**~~ Resolved. The trail now goes through an
  `AuditStore` port with a memory implementation, a JSON Lines file
  implementation, and a tee that writes to both and reads the durable one.
  Diagnostics reads from the store rather than from a live actor, so a session
  that has ended, or one whose process has since been replaced, is still
  answerable. On Render this needs a persistent disk; without one the relay
  says so at boot rather than pretending otherwise.
