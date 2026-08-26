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
- **"Tap to speak" had nothing to tap.** The composer was only ever produced by
  the parameter-collection frame, so the planner's entry point was unreachable
  from the glasses and could only be driven by an agent.

---

## Still unknown

Honest gaps, not oversights.

- **WebSocket survival across display sleep and dim.** Partially answered.
  The glasses survived a full relay redeploy on 2026-08-26: Render restarted
  the service, every socket dropped for roughly forty seconds, and the Display
  reconnected on its own with no wearer action and no lost pairing. That covers
  relay downtime while the panel is awake. What is still untested is the radio
  going quiet because the DISPLAY slept, which suspends the page rather than
  closing the socket, and is a different failure.
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
