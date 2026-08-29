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
  user's own session. It holds EVERY participating site at once, each in its own
  `allow="tools"` iframe, and announces the list to the relay on connect.

  Holding one site at a time was a single line, `[new URL(source.url).origin]`,
  and nothing downstream ever agreed with it: `getTools({fromOrigins})` has
  always taken a list, tool identity has always been `(origin, name)`, an
  ambiguous name has always been refused, and `menuOrder` has always given a
  mixed registry a total order. Removing the restriction needed no new
  capability. It needed one new RULE, which is the same-origin resolver in
  rule 6 below.

  `?source=` still narrows a window to one site. Nothing on the page offers it:
  a control for holding less of the web is a control for using less of the
  product. It survives because end-to-end tests need to assert about one site's
  tools without another's arriving mid-assertion.
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

   Two first-party sources exist to keep this honest, and both are held at the
   same time. `apps/market` sells things and `apps/reservations` holds tables,
   and they share no vocabulary:
   one returns `cart_total`, the other `reservation_id` and `party_size`. The
   second one also declares a string enum, an integer enum and a boolean, none
   of which the market has, so three branches of `paramKind` are reachable at
   all. `e2e/reservations.spec.ts` drives it end to end.

   Adding it needed no per-site branch, and it is worth stating what it DID
   need, because the weaker claim is the one that survives someone reading the
   log. `8254e30` added the whole service and touched no shared package. The
   next two commits changed three: `coerce` in `packages/session` was sending
   an integer enum a parsed copy of its label, `packages/webmcp` was passing
   through the empty `title` Chrome returns for an absent one, and `idKeyOf`
   in `packages/frames` was matching a list of nouns rather than a convention.
   None of those was a per-site branch. All three were genericity bugs that a
   single test source had kept unreachable, which is exactly the thing a
   second source is for. The first two are written up in FIELD-NOTES.md under
   "Building against WebMCP"; the third is not, and the commit is the only
   record.
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

   A hint is also not honoured when the tool contradicts itself. The soft
   lexicons are consulted only AFTER the hint, so with a hint present they
   protect nothing, and `place_order` claiming to be read-only ran with no
   confirmation and qualified as a resolver, which is the path with nobody
   watching. Letting soft signals override the hint is the wrong fix, because
   `cart` is in `add_to_cart` and `review_cart` alike. Those lists mix two
   kinds of word: `cart` and `booking` name a SUBJECT, `place` and `reserve`
   name a MUTATION. Only the second kind contradicts a claim, and it is
   matched against the FIRST word of the name as a whole word, because an
   identifier is conventionally verb-first. That keeps a bookshop's
   `search_books` a read while `book_table` is not.

   Those verbs are looked for in the SCHEMA as well as in the name, title and
   description. A tool could otherwise describe itself blandly, claim to be
   read-only, and declare what it really does in its parameters:
   `apply_changes`, "Applies pending changes.", with a `delete_everything`
   boolean, classified as a read and ran with nobody in front of it. The schema
   is the same kind of evidence as the annotation and was the only part not
   being read.

   Only the HARD lexicons consult it. A parameter is weaker evidence about what
   a tool DOES than the tool's own name: a hard verb names an action and is
   worth acting on wherever it appears, a soft one names a domain and needs the
   tool's own naming behind it, or a search with a `remove_duplicates` flag
   would stop for a human. Either way this can only raise ceremony, so the rule
   above still holds.
5. **Never auto-retry anything that is not read-only.** A timeout is "unknown",
   not "did not happen".
6. **A resolver must be same-origin as its target.** The one path where a
   proposal runs with no human in front of it is `planResolver`, and the
   wearer's own spoken words are what fill the lookup's arguments. Left
   unconstrained, a lookup published by one business receives what somebody said
   about another one, silently, on the path that never reaches a confirmation
   frame. It is also the baitable path: ranking scores tools on text their own
   site wrote, so a site wanting other people's requests need only publish a
   read-only tool that scores well against everything.

   Enforced in `packages/planner`, which filters the candidate list before a
   model sees it, and again in `packages/session`, which re-checks the answer,
   because a `Planner` is a port and another implementation reaches the machine
   without passing through that package. Two checks, one rule.

   This rule had nothing to forbid while a session held one site: every
   read-only tool was already same-origin with every target, which is why it
   was never written down. It is the rule that makes holding every site at once
   safe rather than merely possible.

   The cost is real and is the right cost. A genuinely cross-site lookup, "add
   what my recipe app lists to my cart", becomes a question for the wearer
   instead of something a model does quietly. Bridging two businesses is a
   decision a person should make.

7. **One origin may not take the whole shortlist.** `rank` scores lexically, so
   when an intent matches nothing every score is zero and "rank order" is
   alphabetical order. Measured: six tools named `aaa_*` through `aaf_*` at one
   origin took all six shortlist slots from a shop, whose tools never reached
   the model. That was a site starving itself while Dusky held one site; holding
   all of them it is one origin denying every other origin access to the model
   for the price of renaming its tools. `fairFill` shares the unmatched
   remainder round-robin across origins. Real lexical matches keep their slots
   outright, so nothing can lose a place it earned.

   It also made ranking better, which was not the point and is worth stating as
   a measurement rather than a claim: recall over the eval corpus went from
   13/19 to 14/19 at the shipped shortlist size, which is exactly what doubling
   the shortlist to eight used to buy, for no tokens.

8. **`packages/policy` must stay dependency-free.** If it ever imports the agent
   or a transport, the deterministic guarantee is gone. This was prose with
   nothing enforcing it until `index.test.ts` grew a test that reads the source
   and the manifest: one type import from `@dusky/contracts`, no other
   dependency, and no `Date.now`, `fetch`, `document` or `Math.random`. The
   pull is real rather than theoretical, because the classifier reads a JSON
   Schema by hand specifically to avoid importing the function in
   `packages/frames` that already does it.

   The edge in the other direction is fine and is now used: `packages/frames`
   imports `classify` to order the wearer's menu. Policy is the deterministic
   layer everything else may consult, which is only true while it consults
   nothing.

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
  hijack a familiar tool name by registering it too. The session enforces this
  independently, and it had to learn the rule the hard way: it resolved a
  gesture by name with `find`, which returns whichever tool the browser listed
  first, so an origin registering `checkout` could have its own tool run when
  the wearer picked somebody else's. A NAME IS NOT AN IDENTITY. Any origin may
  register any name, so identity is `(origin, name)`, which is what `toolId` in
  `packages/frames` builds and what a menu row now carries. A bare name still
  resolves, because a model is only ever shown names, but only while it is
  unique. Colliding rows are also labelled with their host, since two identical
  rows give a wearer no way to choose.
- A resolver must be read-only, checked in `packages/planner` AND again in
  `packages/session`. The planner does not rely on the session's filter: a
  guarantee that only holds while two files agree is not a guarantee. This is
  the one path where a proposal runs with no human in front of it.
- Arguments are filtered against the tool's own schema in both packages, so an
  invented `force` or `confirm` cannot ride along into an invocation and bypass
  the gate without anyone touching the gate. Values outside a declared enum are
  dropped rather than passed through.

  This was half true for a while, and the half that was missing is the
  instructive one. `packages/planner` validated names AND values; the session
  filtered names only. So the session's independent check was strictly weaker
  than the planner's, and a `Planner` is a PORT: another implementation reaches
  the session without passing through that package at all. `party_size: 9999`
  went to a site declaring `enum: [1,2,3,4]`, and an object argument went with
  it, invisible on the confirmation frame the wearer approved. The rule now has
  ONE implementation, `valueForParam` in `packages/frames`, which both packages
  call. Two checks, one rule; the thing to avoid is two rules.
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
`effort` setting are still reasoned rather than measured, and their latency and
accuracy should be read that way.

One of the four numbers is no longer a guess. `eval.fixtures.ts` and
`eval.test.ts` measure shortlist recall over nineteen spoken requests against
eleven tools from four domains, with no model and no credential, because
ranking is deterministic. At the shipped size of six the right tool is on the
list 14 times out of 19; at eight it is 15; with every slot free it is 19.

Both of the numbers below 19 have moved once, and each time the eval was what
found the reason rather than confirming a hunch. 19 used to be 17: `shortlist`
returned ONLY the tools with a nonzero score, so three matches meant three
cards even when six slots were free, and the right tool could be excluded at
every size. 14 used to be 13, until the leftover slots started being shared
between origins instead of handed out in rank order, which with every score at
zero is alphabetical order. That change was made for the reason in rule 7, and
buys at six exactly what doubling the shortlist to eight used to buy, for no
tokens at all.

Read the 14 carefully. It is not planner accuracy, because a model is what
happens next, and it is not an argument for a bigger shortlist, because going
to eight still buys one request. It says the binding constraint is the RANKER:
"find me some oat milk" puts `find_times` above `search_products`, on the
strength of the word "find" being in one name and nothing matching in the
other. That is the case the model tier exists for. It is also the number to
beat before anybody spends effort on the shortlist size.

## Dusky as a provider

Dusky consumes other sites' tools everywhere else. `apps/console/src/duskyTools.ts`
is the other direction: four tools an agent in the same browser can call to
drive a pair of glasses. Same protocol, both ends, one product. `e2e/provider.spec.ts`
proves it through `document.modelContext.executeTool` with nothing mocked.

The tools are `get_display_status`, `list_display_actions`,
`send_task_to_display` and `cancel_active_task`. `exposedTo` is deliberately
omitted, which is what makes them available to the browser's own agent, the
ChatGPT desktop browser case.

Two constraints are load-bearing and both are enforced in `SessionActor`,
never in the console. The console is a transport; a rule enforced in the
browser is enforced in the layer an attacker is already standing in.

1. **No request carries a session identifier.** `AgentRequest` has no field for
   one and no tool declares a parameter for one. The session is whichever one
   this console page is paired to. A tool that accepted a session id would let
   anyone reaching it drive any session whose pairing code they could guess,
   and codes are six characters because a wearer reads them off a lens.
2. **A task is refused while the wearer is mid-decision**, and the check runs
   BEFORE the planner check, because not interrupting someone is an invariant
   and must not depend on how a deployment is configured. Refusing during a
   pending confirmation is the security case: otherwise an agent could swap
   what is about to be approved while the wearer's attention is on the old
   target. Cancelling, by contrast, is always allowed, because it can only ever
   stop something from happening.

An agent can ask. Only the wearer can approve. A task goes through the same
`Session` a gesture does, so it meets `packages/policy` and the gate exactly
as a gesture would, and `list_display_actions` tells an agent up front which
actions will stop for a human.

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
  The wearer's menu did, until `menuOrder` in `packages/frames` gave it a total
  order of its own: the ceremony `packages/policy` assigns, then the label,
  then `toolId`. That is why the row a wearer lands on cannot cost them
  anything, and why the same sites produce the same menu twice. The argument
  for that order, and the three alternatives it turns down, are in the comment
  above it rather than here.

  A menu spanning several sites that will not fit four rows shows a row per
  site instead, and that site's actions one press behind it. Measured: seven
  tools flat is four pages of two with a planner configured, and reaching
  `add_to_cart` costs eight presses against six grouped. Grouping is navigation
  over a combined registry, never a partition of one: the planner still ranks
  every site's tools together and one spoken request still crosses two
  businesses.
- **`getTools({fromOrigins})` also returns THIS document's own registered tools**,
  even when `fromOrigins` names only other origins. Verified 2026-08-26 against
  151.0.7922.174, the day Dusky started registering tools of its own and
  "Send task to display" appeared on the wearer's menu as though the shop had
  offered it. `WebMcpBridge.discover` filters to the requested origins. Keep
  the filter even after Chrome fixes this; accepting only what you asked for is
  correct regardless.

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
pnpm dev         # all five surfaces
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
