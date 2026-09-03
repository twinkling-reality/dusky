# Field notes

This is Dusky's chronological lab notebook.

It records failures found on real glasses, real hosts, real browsers, and real
model calls. The failures explain why several current rules exist.

This file is not the source of truth for the current architecture, guarantees,
or verification status. Read [Architecture](./docs/ARCHITECTURE.md),
[Trust model](./docs/TRUST-MODEL.md), [Verification](./docs/VERIFICATION.md),
and [WebMCP runtime](./docs/WEBMCP-RUNTIME.md) first.

The entries below remain in discovery order.

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

### A frame identifier must reject old input

The relay assigned stable frame identifiers so a reconnect would not reset
focus, but it accepted every incoming `frameId` without comparing it with the
current one. A delayed Enter, text commit, or Escape could therefore reach a
newer screen.

`SessionActor` now checks the identifier before acknowledging or forwarding an
input. A mismatch replays the current frame under its existing id and applies
nothing. The `Session` still owns state-level guards such as one approval per
invocation; transport staleness and state authorization are separate rules.

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

### The glasses stopped being able to open a WebSocket, and the panel said so badly

Unresolved as of 2026-08-28, and recorded because the evidence took an hour to
gather and nobody should gather it twice.

The symptom a wearer reports is "it flickers between a code and an error". The
code sits still for a few seconds after launch and then alternates with
**Cannot reach Dusky / The session relay is unreachable. Still trying.**

What that alternation means is worth stating, because it was misread twice
here before the relay settled it. The pairing frame renders the code whenever
the link is `connecting`, `open` or `reconnecting`, and only swaps to the error
once `attempts > RECONNECT_MS.length`. So the first few seconds are the
reconnect ladder, not a healthy connection, and the flicker afterwards is not
evidence that a socket ever opened.

The relay is the only place that can answer this, and it answers immediately:
a session actor is created on `hello`, so if a Display had ever completed a
handshake, `/health` would count it. It never did, across ten minutes and two
different phone network paths.

Ruled out, each by execution rather than by reasoning:

- The relay. A Node client held a `/display` socket open for 75 seconds,
  answered every `ping` with a `pong`, and correctly pushed no frame with no
  console paired.
- The deployed bundle. It dials `wss://dusky-relay.onrender.com/display`, with
  no `localhost` anywhere in it, and mints codes from the letters-only
  alphabet. Both `toString(36)` hits in it are React internals.
- A stale cached build. There is no service worker, and `/sw.js`,
  `/manifest.json` and friends all 404.
- CSP. The Display sends no `Content-Security-Policy` header at all.
- IPv6. Neither Render nor Vercel publishes an AAAA record, so an IPv6-only
  path could not have loaded the page either.
- Cloudflare filtering by client identity. The relay is Cloudflare-fronted and
  Vercel is not, which is a real asymmetry between the request that works and
  the one that does not, but the upgrade succeeds with no User-Agent, a curl
  one, a desktop Chrome one and a spoofed Meta wearable one.
- The phone's network. Wi-Fi and cellular behave identically.
- localStorage. The code is stable across relaunches, so `mintCode` is not
  re-running and storage is persisting. That much of `AGENTS.md` is right.

That leaves the glasses' own runtime, and one more web app settles which half
of it. Loading `https://dusky-relay.onrender.com/health` as a second web app
renders `{"ok":true,"sessions":14}` on the lens.

**So the glasses reach the relay perfectly well over HTTPS, and fail only on
the WebSocket upgrade.** Same host, same TLS, same DNS, same phone, minutes
apart. Whatever is broken sits between an ordinary GET and an `Upgrade:
websocket`, and it is on the device side, because every hop this end serves
both from the same process.

That is the useful shape of the finding. It rules out an entire class of
explanation that looks identical from the wearer's chair: the glasses are not
offline, the relay is not unreachable, the URL is not wrong, and nothing is
being filtered by host. A Meta web app can talk to this server. It just cannot
hold a socket to it.

Two things are worth keeping regardless of the cause.

The first is that this hardware demonstrably held WebSockets on 2026-08-26,
including surviving a forty second relay redeploy. So a Meta web app's ability
to hold a socket is not a property you verify once.

The second is a wording bug this exposed. "Cannot reach Dusky" is only
reachable BEFORE the first frame arrives, because the Display renders
`relay.frame ?? pairingFrame(...)` and a delivered frame is never taken back.
That is the correct design, and it also means the error frame is the one screen
a wearer sees when they cannot yet do the single thing that would clear it.
Nothing tells them the code is still valid and still worth typing. The panel
had the code a moment ago and replaced it with a sentence about plumbing.

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

### An in-app browser can expose your tools and still hide the providers'

Measured on 2026-09-01 against the live official deployment in the Codex
desktop in-app browser, the closest automatable surface available to the
ChatGPT desktop browser.

The calling document worked. Dusky registered all four of its own tools, the
browser agent enumerated them, and `get_display_status` reached the paired
relay session. The embedded Display was connected. The landing page's own
registration probe reported three of three requirements met.

The provider path did not work. Verdant Market, Amber & Oak, and Northstar
Dispatch all loaded completely in their cross-origin frames, each frame carried
`allow="tools"`, and their visible fixture state was readable. After ten
seconds the console had zero provider actions from all three origins, and the
Display showed no available actions.

Flagged Chrome 152 against the same URL returned 4, 3, and 4 provider tools and
all four calling-document tools in about two seconds. That isolates the split:
the in-app environment implemented enough WebMCP for the top document to be a
provider, but not the cross-origin consumer path Dusky needs.

The Requirements self-test used to label that outcome simply `3/3`, which made
top-level registration look like proof of the whole product path. It now names
the probe as page-level and states Chrome with WebMCP Testing as the measured
full-provider route. A compatibility probe has to exercise the boundary the
product depends on; success on the easier half is not evidence about the harder
one.

### Cancelling a browser audit left the whole local lab running

The load-bearing tests do not fake WebMCP. One run launches the Dusky relay,
console, Display, three provider apps, a runtime-only provider, and Chrome with
`WebMCPTesting` enabled. During the 2026-08-31 console redesign, cancelling
repeated Playwright audits could end the visible task without reliably ending
all of those descendants. The remaining processes held ports, accumulated
browser work, and kept the laptop hot even though the audit looked finished.

The fix was ownership rather than a broader kill command. The local Playwright
runner now lives in its own process group and forwards termination to the
group, with a bounded force-kill fallback. Hosted CI keeps Playwright in the
job's supervised process tree. Processes that predated the audit are not swept
up, because `reuseExistingServer` does not make somebody else's development
server ours to terminate.

This distinction matters if the story reaches a Devpost submission: Dusky's
real-browser WebMCP proof needs more lifecycle machinery than a mocked unit
test, but the observed leak was in our interrupted local orchestration, not in
the WebMCP protocol or the production relay. The measured behavior and cleanup
contract are recorded in [WebMCP runtime](./docs/WEBMCP-RUNTIME.md#local-test-process-lifecycle).

### Never discover the browser argument shape with a provider action

Chrome 151 requires JSON-string arguments while the current WebMCP shape uses
objects. The original bridge tried the object form on the first provider tool,
caught an error containing `Failed to parse input`, and called that same tool
again with a string.

The error text is not authority. A provider can perform a side effect and then
throw the same text, so the fallback could turn one approved action into two
invocations.

The bridge now registers a temporary local read-only probe, settles the browser
shape against that harmless tool, removes it, and invokes every provider tool
once. A regression test makes the provider throw the browser parse-error text
after its simulated side effect and asserts there is no second call.

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

### `allow="tools"` grants WebMCP and nothing else

Measured on 2026-09-03 in Chrome 152 with `WebMCPTesting`, while adding the
wearer position path.

Permissions Policy defaults every feature to `self`, and `tools` is one feature
among several. A provider mounted in the console's `allow="tools"` frame can
register and execute WebMCP tools and cannot read anything else about the
device. `e2e/position.spec.ts` proves the specific case that matters: with the
browsing context holding a geolocation grant, and the top-level Display in the
same context reading `45.5152` successfully, the provider document's own
`getCurrentPosition` returns `PERMISSION_DENIED` with no prompt at all.

Two things follow, and the second one is the reason this is written down.

The first is that a site cannot take a wearer's position. It can only receive
one the wearer sent. That is the property the whole feature rests on, and it is
enforced by the browser rather than by Dusky.

The second is that the silent failure looks exactly like a wearer declining. A
provider that wants a coordinate and never gets one has no way to distinguish
"the embedder did not delegate the feature" from "the person said no", and
neither does anyone reading its logs. This was worth measuring rather than
reading, because the spec text and the observed failure are the same sentence
from opposite ends.

### WebMCP has nowhere to put ambient context, by construction

Checked against the specification source on 2026-09-03, not inferred from a
summary. `executeTool` takes a `RegisteredTool`, an `inputObject` and an
options bag whose only member is an `AbortSignal`. The execute callback
receives the same two things. Grepping the draft for `_meta`, `clientContext`,
`elicitation`, `sampling`, `roots` and `ambient` returns nothing; the three
hits for `environment` are bibliography entries for HTML's environment settings
object. MCP's `_meta` is an extension point with no standard ambient key, and
its elicitation flow runs server to user rather than client to server.

So there is no channel for "here is where the wearer is" that is separate from
the site's own parameters, and there is no reserved name that a site could be
expected to already understand. Passing a coordinate means either recognising
names that sites already publish, or inventing a Dusky-specific schema
extension that every site would have to adopt.

Dusky does the first. `coordinateAxis` in `packages/frames` matches a folded
parameter name against a closed list, exactly the way `ID_KEYS` recognises an
identifier in a result, and falls back to the composer when it does not match.
That means a site with an ordinary `latitude`/`longitude` API works with no
changes and no knowledge that Dusky exists, and a site that names them
something else costs the wearer nothing they were not already going to pay.

The temptation was to invent `x-dusky-context: location`. Nothing would have
been able to consume it, because the only sites that could adopt it are sites
already able to rename a parameter.

### Head orientation was researched and deliberately not built

The platform exposes `DeviceOrientationEvent`, and a head-worn device reporting
its own orientation is genuinely tempting as an input channel: glance down to
page a long list without a temple gesture.

It was not built, and the reasons are worth recording so nobody re-derives
them.

The Display contract in this repository says no raw-gesture assumptions, and
that is not a style preference. The OS translates Neural Band and temple input
into six keys, and every one of Dusky's safety properties is expressed in terms
of discrete, deliberate input: a frame id rejects delayed input, one
confirmation authorizes one invocation, focus does not move on its own. Head
movement is continuous and largely involuntary. An input channel that can shift
focus while a wearer is walking, on a panel where one row may be an action that
spends money, weakens the exact property the confirmation frames exist to
protect. Adding a second input model to compete with the platform's own is a
different product, not an increment on this one.

The evidence is also worse than it looks. Meta's own documentation contradicts
itself on whether `DeviceOrientationEvent.requestPermission()` exists on the
glasses: the prose says to call it, and the comment in their own sample puts
the glasses in the branch where it does not exist. Chrome's plain
`deviceorientation` is relative rather than compass-referenced, so `alpha` is
not a heading without `deviceorientationabsolute` and the magnetometer feature.
Neither the event rate nor the absolute-orientation behaviour on the glasses is
documented, and no orientation code has ever been put in front of a pair to
find out.

Building a primary interaction on a sensor whose semantics we cannot verify,
against a rule written to keep this device's decisions deliberate, would have
been a feature that demos and does not hold. Position is different: it is one
value, read once, on request, and it goes through a decision the wearer makes
with the value in front of them.

---

## Running it with a planner on

Everything here is only reachable in production. `DUSKY_PLANNER` is off
locally, so the whole resolver path is unexecuted by `pnpm test` and
`pnpm test:e2e`, and both suites pass without ever entering it.

### A resolver asked to look something up, with nothing to look it up from

Choosing "Book table" on Amber & Oak spends a model call and shows a
`Looking up your options` frame, and then asks the wearer to type an opaque
slot id anyway. The lookup cannot succeed, and the reason is structural rather
than a mistake by the model.

`book_table` needs `slot_id`, which is text, so `Session.advance` takes the
branch that asks a planner for a read-only tool whose output would supply it.
It calls `planResolver(missing, target, readOnly, this.intent)`. On the MENU
path `this.intent` is still `""`, because only `submitIntent` ever assigns it.

So the model is asked which arguments `find_times` should be called with, for a
wearer whose request is the empty string. `find_times` declares `date` as an
enum of `today`, `tomorrow`, `this weekend` and `party_size` as an integer enum
of 1 to 4, and the card does tell the model both lists. With nothing to infer
from it guesses anyway, the guesses are not enum members, and `valueForParam`
drops them. The audit trail is exact about it:

```
plan  find_times  {"stage":"proposed","droppedArgs":["date","party_size"]}
plan  find_times  {"path":"planResolver","accepted":true,"args":{}}
```

`find_times({})` is then a perfectly valid call that returns `{"slots":[]}`,
verified by invoking it directly through `document.modelContext`. No candidates,
so the wearer gets the composer they would have got instantly with no planner
at all, one model call and one working frame later.

The argument filter did its job and the gate did its job. What is missing is
that nothing checks whether a proposal still satisfies the target's `required`
list AFTER filtering. `required` is read in `cards.ts`, in `planner.ts` for the
no-model shortcut, and twice in `frames`, and in none of those places is it
used to reject a proposal that has been emptied out.

The cheaper observation is that a resolver invoked with an empty intent has no
information to resolve from, and asking a model to invent one is the one thing
the planner is documented not to do: "It never fills an argument by lexical
similarity, because a wrong argument is exactly what a model is there to
avoid." An empty intent is a weaker basis than lexical similarity.

Worth contrasting with what DOES work, because it is the anti-hardcoding
argument and it works exactly as claimed. "Find a table" compiles straight from
the schema with no model involved:

```
CHOOSE  Which day?        today / tomorrow / this weekend
CHOOSE  How many people?  1 / 2 / 3 / 4
```

A string enum and an integer enum, both rendered as buttons, from a site whose
vocabulary shares nothing with the market's.

### Free text could be written and never sent

The composer was the last thing on the unverified list, and it was broken. A
wearer could open it, write `oat`, watch the text land in the field, and have
no way at all to submit it.

Three things were each individually reasonable and together left no way out.

`Composer` commits on exactly two events, which is correct and deliberate:

```tsx
onBlur={(e) => commit(e.currentTarget.value)}
onKeyDown={(e) => { if (e.key === "Enter") commit(...) }}
```

`Enter` never arrives. A tap on a focused text field is taken by the glasses OS
to open its own writing surface, so it is consumed before the page sees a key
at all. Tapping again just reopens that surface, which is what the wearer
reports: the same dictate-or-handwrite chooser, over and over.

And blur could not fire either, because `paramFrame` offered exactly one row:

```ts
choices: [{ id: "__compose", label: "Enter a value", meta: "tap" }]
```

`useDpad` moves focus with `(i +/- 1 + count) % count`. For `count === 1` that
is always `0`, so every arrow press re-focuses the input the wearer is already
on. There is no other focusable element on the frame and therefore nothing that
could take focus away.

None of the three parts is wrong on its own. The composer's two commit paths
are the right two. Wrapping focus is right on a list. The OS taking a tap on a
text field is right. What is wrong is that the only frame that needs a way OUT
of a text field was also the only frame with nowhere else to go.

The fix is a second row rather than a third commit path. "Done" gives focus
somewhere to move, and moving off the input fires the blur that was always
supposed to commit. Selecting it is a no-op the session ignores.

That last part needed a guard, and finding it was worth the trip on its own.
`handle` falls through to "selecting a value for the parameter currently on
screen" for any id it does not recognise, so a wearer pressing "Done" on an
empty field would have set `product_id` to the literal string `"__submit"` and
carried it to the confirmation. `__compose` had exactly the same hole and had
simply never been reachable on a frame with something pending. Reserved ids are
now refused before that branch.

Two smaller things from the same session, both undocumented by Meta:

- **Swipe left moves the cursor, it does not delete.** There is no documented
  way to erase a character. Escape backs out of the composer without
  committing, which is the only reliable correction.
- **Meta's full developer documentation, all 210KB of `llms.txt?full=true`,
  contains nothing about handwriting, dictation, or any editing gesture.**
  Searching it for `backspace`, `delete`, `erase`, `handwrit` and `dictat`
  returns only instructions for deleting projects from their web dashboard.
  That is now three gaps in the same place: the launcher, the exit, and the
  entire text input surface. Meta documents how to ship a web app in detail and
  documents nothing about what a wearer's hands actually do.

The general lesson is the one this file keeps relearning. Every part of this
was reachable in a browser, where a mouse click can blur an input and a
keyboard has an Enter key. The desk has affordances the waveguide does not, and
a test that passes at a desk is evidence about the desk.

### A budget that bounded the cheap half

Choosing "Search catalog" on the glasses sat on a `Looking up your options`
frame for nearly five seconds and then showed the composer. The audit says
exactly where the time went:

```
02:00:56.377  plan  {"stage":"shortlist","path":"planResolver","considered":1,"sent":1}
02:00:57.515  plan  {"stage":"abstained","tier":"fast",    "ms":1138}
02:01:00.073  plan  {"stage":"abstained","tier":"careful", "ms":3696}
```

Nothing there is wrong. The planner was asked whether any read-only tool could
supply the `query` for `search_products`, and both tiers correctly said no,
because a search query IS the input and no upstream tool can ever produce one.
The escalation to a careful tier is by design: an abstention is exactly the
"unsure" case a second tier exists for.

The bug is that `packages/session` says this, on the constant:

> A lookup that saves typing must not cost more than the typing would.

and then applied it to the wrong half:

```ts
const budget = Math.min(this.o.invokeTimeoutMs ?? 15_000, RESOLVER_BUDGET_MS);
const out = await this.invokeWithin(resolver.origin, resolver.name, args, budget);
```

That bounds the invocation. The two model calls happen above it and were bounded
by nothing the session knew about, so the ceiling the comment names could be
exceeded without either half going over it. The expensive part was the part
with no deadline.

Worth separating the two things this got wrong, because only one of them is
about a number.

The first is a scope error: a deadline on the second step of a two step
operation is not a deadline on the operation. The wearer is waiting from the
first step.

The second is that the two halves are not worth the same. Time spent deciding
buys nothing on its own; time spent invoking is what produces the choices. A
budget split evenly can be spent in full and still leave an empty list. So the
planning share is now `RESOLVER_PLAN_BUDGET_MS`, well under half of the total,
and the invocation gets what is LEFT rather than a fresh allowance.

Giving up on deciding is also recorded now, as `stage: "undecided"`. A wearer
sent to the composer because a model was slow and one sent there because no
tool could have helped see an identical screen, and those want different fixes.

The general shape is worth keeping: an optional convenience with no deadline is
not optional, because the wearer cannot skip it. Everything here that can hold
a frame has a budget, and this was the one path where the budget was measured
from the wrong moment.

### The production suite went stale in the two ways a UI suite always does

`e2e/production.spec.ts` failed four of nine, and none of the failures were
production. One locator matched a sentence that had been reworded, and three
asserted that `add_to_cart` was on the Display's first page.

The second kind is the interesting one, because nothing about `add_to_cart`
changed. `menuOrder` began sorting by what a press costs, so reads come first,
and the composer took a permanent slot once a planner was configured. Two
changes elsewhere moved a row onto page two, and the test that named that row
was the only thing that noticed.

A readiness assertion should not name a specific tool. It now waits for the
idle frame's own heading, and the test that genuinely needs a gated tool pages
to it the way a wearer would.

---

## Found by reading rather than running

Worth listing separately: these were all live in a passing test suite.

- **A transfer frame with two choices still accepted every old input path.**
  The first cross-site result implementation drew only Share and Cancel, but
  `Session.handle` still accepted any choice id while a parameter was pending,
  and `submitText` still accepted text. A stale frame or somebody writing to the
  display socket could therefore replace the proposed value and move directly
  to the destination action gate without recording a transfer decision.

  The retained value itself was not silently sent, but the state-machine rule
  was still false: a transfer frame was not actually a transfer boundary. While
  a pending transfer exists, the machine now accepts only `__share` and
  `__cancel`; text and every other id leave the frame unchanged. This has a unit
  test because the panel cannot be the guard. Display messages are untrusted
  input even when the screen that produced them had only two controls.
- **The final provenance line contained the whole value and rendered only its
  prefix.** Exact 600 by 600 captures showed `Book table:` at the right edge
  while the returned reference `AO-4417` was outside the panel. The DOM still
  contained it, which is worse than a missing fact because an accessibility
  inspection and a screenshot disagreed about what the wearer could approve or
  transcribe. A flex child keeps its content width unless `min-width: 0` lets it
  shrink. The result value now owns the remaining row width and wraps within it.
  The capture utility in `scripts/frame-review.mjs` renders transfer,
  confirmation, working, progress, and final frames through the real lens
  component at the device viewport.
- **A tool result became a new security boundary the moment a later step could
  use it.** Keeping raw JSON in task state would make size, privacy, and prompt
  injection somebody else's problem. `shareableProjectionsFromResult` instead
  parses only within 32,768 characters, visits at most 128 nodes through depth
  6, keeps no more than twelve projections, and excludes any complete string
  longer than 120 characters. A projection has a stable location and type, but
  no executable interpretation. The audit records bounded structural location
  metadata and the two origins without copying the value or a provider-written
  JSON key. Three deterministic handoff fixtures are 3/3, and hostile,
  oversized, deeply nested, stale-schema, cancellation, and audit-leak cases
  are tests rather than prose.

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
- **A default source list looked like an integration list until it could be
  replaced without code.** The shared engine was already generic, but the
  console could hold only the three URLs compiled into `sources.ts`. Repeated
  `site` query parameters now replace that fixture list with validated runtime
  providers. The parser accepts public HTTPS and loopback HTTP, deduplicates by
  origin, rejects credentials and active schemes, and discards every supplied
  field except display name and URL. A real Chrome test loads a renamed runtime
  source and discovers its tools with no rebuild. An executable-source audit
  rejects fixture vocabulary and imports from applications or their registry in
  frames, session, policy and planner.
- **The provider grant was reflected caller input.** Each test provider read an
  `agent` query parameter and copied it into `exposedTo`. That made preview
  deployments convenient, but it let the embedding page choose the origin the
  provider authorized. The three providers now take the exact allowed origin
  only from trusted build configuration, and a source audit prevents the query
  override from returning.
- **Escape support did not make a parameter screen visibly escapable.** The
  contact prompt showed only its composer, so the wearer had to know a hardware
  gesture that the frame never named. Every parameter and projection page now
  reserves one physical row for Back, and every site submenu reserves one for
  Back to sites. Those ids are consumed before argument coercion. The 600 by 600
  visual test renders the contact prompt, transfer, destination confirmation,
  intermediate progress and final result through the real lens component. All
  five fit without overflow and every interactive target measures at least 88
  pixels high.

---

## Still unknown

Honest gaps, not oversights.

- ~~**Whether a wearer can read a position on the glasses.**~~ Answered
  2026-09-03. The path was worn: the location row rendered, the device returned
  a real fix, two transfer approvals filled `latitude` and `longitude`, and the
  provider's tool ran and came back on the lens. `navigator.geolocation` works
  in a Meta Ray-Ban Display Web App, as documented.

  The permission prompt appeared and was answerable. It was the ordinary
  two-option grant, Allow once and Allow always, and the wearer answered it on
  the glasses before the read returned. That was the whole open question, and
  it is why the read is triggered inside the Display's own keypress handler:
  Meta's guidance is that a permission request follow a user gesture, and a
  relay-initiated read would have had none to offer.

  Not recorded: which option was chosen, so nothing here says how long a grant
  survives across launches of the web app.

  One thing the session did settle by accident. The first approval frame sat on
  the lens for four and a half minutes while the wearer was doing something
  else. `isConfirmationFresh` caps an approval at 120 seconds, so the session
  invalidated it and asked again rather than applying a coordinate agreed to
  before the pause. That is the first time that guard has fired on hardware
  against a real value, and it fired without anybody arranging it.

- ~~**Whether a wearer can answer a location permission prompt on the
  glasses.**~~ Answered 2026-09-03. It appears, it offers Allow once and Allow
  always, and it can be answered with the glasses' own input. Meta's
  documentation describes the permission requirement and the user-gesture
  guidance but never says what the prompt looks like on a 600x600 additive
  waveguide; now there is an observation rather than an assumption.

  The read is therefore triggered from inside the Display's own keypress
  handler, which is the only place on that surface with a user activation, and
  every refusal path returns the wearer to the composer with a sentence saying
  why. That is the mechanism; whether the prompt itself is reachable is
  unmeasured. Verified in desktop Chrome with a granted permission and an
  emulated position, which proves the plumbing and not the device.

  Superseded on 2026-09-03: the path has since been worn, and the entry above
  records what that settled and what it did not.

  The mechanism refuses to hang while that stays unknown. `getCurrentPosition`
  starts its own timeout only AFTER permission is granted, per the Geolocation
  specification, so a prompt nobody answers produces no success callback and no
  error callback at all. A separate fifteen second watchdog on the Display
  answers `timeout` in that case, because a swept gesture acknowledgement on a
  cursorless panel is the failure mode this repository refuses everywhere else.

  Also unmeasured: the ten second timeout. A fix that crosses to a paired phone
  and back has a different cost from one on the phone itself, and ten seconds
  is a guess of the same kind the 15s and 30s liveness numbers were.

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
- **Why a Meta web app can reach a host over HTTPS but not open a WebSocket to
  it.** It could on 2026-08-26 and could not on 2026-08-28, from the same
  glasses against the same relay, with `/health` rendering on the lens the
  whole time. Everything on this end is ruled out by execution. Written up
  under "Wearing it". The open question is now entirely about the device
  runtime, which is the half we cannot instrument.
- ~~**The composer's focus-then-tap behaviour** on handwriting and
  dictation.~~ Answered 2026-08-28. Focus-then-tap DOES open Meta's composer
  and it offers both dictation and handwriting. Sending what you wrote did not
  work at all; see "Free text could be written and never sent".
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
