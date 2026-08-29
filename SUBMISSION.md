# Dusky submission

## One-line pitch

Dusky turns every WebMCP action available in your browser into one safe,
gesture-driven interface on Meta Ray-Ban Display.

## Text description

Dusky is a browser for a web made of tools instead of pages. Participating
sites publish what they can do through WebMCP. Dusky discovers those actions in
the user's own browser sessions, compiles each tool schema into a sequence of
600x600 frames, and lets a wearer operate them with the six inputs available on
Meta Ray-Ban Display.

One spoken request can cross businesses that have never integrated with each
other. "Reserve a table for four, then send the reservation details to Dana"
becomes an ordered task spanning a restaurant and a communications desk.
Neither site knows the other exists, and Dusky's shared packages contain no
branch for either one. The browser already holds both sessions, so WebMCP
supplies the missing common action layer.

The planner can propose up to four end actions, but it cannot authorize any of
them. Dusky validates the entire plan against the tools the browser actually
offered and refuses the whole plan if any step is invalid. Each future step is
looked up again in the live registry before it starts. Each consequential step
then reaches an independent policy gate and waits for a gesture from the
wearer. A successful intermediate result shows the next action and its place in
the task, so moving from one business to another is visible and deliberate.

When the message needs information from the reservation result, Dusky keeps
only bounded primitive projections and a generic summary with source
provenance. It never gives the raw result back to the model. Dana is resolved
through the communications site's own read-only contact lookup. The wearer
chooses a projection, then sees a dedicated transfer frame naming both sites,
the message-body argument, and the exact value. Share fills only that argument.
Send message then reaches its separate action confirmation. One approval cannot
stand in for the other.

Dusky uses WebMCP in both directions. It consumes partner sites' tools to build
the glasses interface, and it provides four tools of its own so an agent in the
same browser can inspect the display, list available actions, send a task to the
wearer, or cancel one. An agent may ask. Only the wearer can approve.

The demo includes three unrelated WebMCP sites with eleven tools and different
vocabularies, schemas, parameter types, and result shapes. The same generic
frame compiler handles all three. The deterministic shortlist reaches the
expected tool in 18 of 21 single-action requests at the shipped six-card limit,
keeps every expected action for 6 of 6 compound requests, and preserves an
exact compatible projection for 3 of 3 result-handoff fixtures. The repository
has 324 unit and deterministic tests plus 32 Playwright tests in real Chrome
with WebMCP enabled.

Existing live demo, still on the prior two-source build until deployment is
authorized: https://dusky-console.vercel.app

Source: https://github.com/twinkling-reality/dusky

Video: add the public YouTube URL here

## Demo script, target 2:40

### 0:00 to 0:15, start on the real glasses

Show the live Display recording, not a recreated panel.

Narration:

> This is Dusky running on Meta Ray-Ban Display. It turns the actions websites
> publish through WebMCP into one interface I can drive with gestures.

### 0:15 to 0:35, reveal the browser

Cut to the Dusky demo workspace. Keep the glasses panel, Verdant Market, Amber
& Oak, Northstar Dispatch, and the live protocol log visible together.

Narration:

> The shop, restaurant, and communications desk are separate sites in my
> browser. Each exposes its own tools to Dusky. There is no connector between
> them and no shared behavior written for any of their vocabularies.

Point briefly at the action list and the site labels. Let the log show
`getTools({fromOrigins})`.

### 0:35 to 1:45, the headline request

Send or dictate:

> Reserve a table for four, then send the reservation details to Dana.

Show the following sequence without skipping the decision frames:

1. Dusky asks for any restaurant value the planner could not honestly infer.
2. The reservation reaches its confirmation frame. Say that nothing has run.
3. Confirm on the glasses. Show Amber & Oak update from its own returned result.
4. The result frame shows `Next: Send message` and `2/2`.
5. Advance. Northstar Dispatch uses its same-origin contact lookup to offer Dana
   rather than inventing an id.
6. Choose the generic reservation summary. Stop on the transfer frame and read
   Amber & Oak, Northstar Dispatch, Body, and the exact preview aloud. The
   outbox is still empty.
7. Choose Share. Stop again on the Send message confirmation. The information
   has been approved for the message body, but no message has been sent.
8. Confirm and show the Northstar outbox update, then the final result with one
   provenance-bearing line for each completed site.

Narration over the transition:

> One sentence became two actions at two businesses. Sharing the reservation
> information did not authorize sending the message. Dusky showed the exact
> handoff, checked the live schema again, and applied the action gate again.

### 1:45 to 2:10, show schema derivation

Point at one restaurant schema with its string enum, integer enum, and boolean,
then at the generated choices on the panel.

Narration:

> These controls are compiled from the tool schema. A string enum becomes
> choices, an integer enum stays numeric, a boolean becomes yes or no, and free
> text opens the glasses composer. The restaurant exists to prove this is not a
> shop-shaped integration.

### 2:10 to 2:28, WebMCP in the other direction

Show the browser agent calling `list_display_actions` or
`send_task_to_display`.

Narration:

> Dusky also publishes WebMCP tools of its own. An agent in this browser can ask
> the glasses to take on a task, but it cannot name another session and it
> cannot approve for the wearer.

### 2:28 to 2:40, close on the product thesis

Return to the glasses result and the two updated sites, with all three sources
still held in the browser.

Narration:

> The browser holds capability and session. The glasses hold attention and
> authority. Dusky moves intent between them, never credentials.

## Recording preflight

- Push only after receiving explicit approval to commit.
- Wait for all five Vercel surfaces and the Render relay to finish deploying.
- Run `pnpm test:prod` and require all ten tests to pass against the live URLs.
- Open all three demo sites and confirm all eleven actions are present.
- Confirm the glasses can open a WebSocket to the relay before rehearsing.
- Clear the demo cart, reservations, drafts, and outbox before every take.
- Record through Meta AI app, Devices, Record Display.
- Keep the final edit under three minutes and include narration audio.
- Upload publicly to YouTube, then replace the video placeholder above.
