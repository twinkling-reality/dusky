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
other. "Book a table for two tomorrow and add oat milk to my cart" becomes an
ordered task spanning a restaurant and a shop. Neither site knows the other
exists, and Dusky contains no branch for either one. The browser already holds
both sessions, so WebMCP supplies the missing common action layer.

The planner can propose up to four end actions, but it cannot authorize any of
them. Dusky validates the entire plan against the tools the browser actually
offered and refuses the whole plan if any step is invalid. Each future step is
looked up again in the live registry before it starts. Each consequential step
then reaches an independent policy gate and waits for a gesture from the
wearer. A successful intermediate result shows the next action and its place in
the task, so moving from one business to another is visible and deliberate.

Dusky uses WebMCP in both directions. It consumes partner sites' tools to build
the glasses interface, and it provides four tools of its own so an agent in the
same browser can inspect the display, list available actions, send a task to the
wearer, or cancel one. An agent may ask. Only the wearer can approve.

The demo includes two unrelated WebMCP sites with seven tools and different
vocabularies, schemas, parameter types, and result shapes. The same generic
frame compiler handles both. The deterministic shortlist reaches the expected
tool in 16 of 19 single-action requests at the shipped six-card limit, and
keeps every expected action for 4 of 4 compound requests. The repository has
307 unit tests plus 31 Playwright tests in real Chrome with WebMCP enabled.

Live demo: https://dusky-console.vercel.app

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
& Oak, and the live protocol log visible together.

Narration:

> The restaurant and the shop are separate sites in my browser. Each exposes
> its own tools to Dusky. There is no connector between them and no code in
> Dusky for either business.

Point briefly at the action list and the site labels. Let the log show
`getTools({fromOrigins})`.

### 0:35 to 1:45, the headline request

Send or dictate:

> Book a table for two tomorrow and add the organic oat milk to my cart.

Show the following sequence without skipping the decision frames:

1. Dusky asks for any restaurant value the planner could not honestly infer.
2. The booking reaches its confirmation frame. Say that nothing has run yet.
3. Confirm on the glasses. Show Amber & Oak update.
4. The result frame shows `Next: Add to cart` and `2/2`.
5. Advance. Dusky uses Verdant Market's same-origin search to offer real
   products rather than inventing an id.
6. The cart action reaches its own confirmation. Again, nothing has run yet.
7. Confirm and show Verdant Market update from its own returned result.

Narration over the transition:

> One sentence became two actions at two businesses. The first approval did
> not authorize the second. Dusky shows the handoff, checks the live tool again,
> and applies the policy gate again.

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

Return to the glasses result and both updated sites.

Narration:

> The browser holds capability and session. The glasses hold attention and
> authority. Dusky moves intent between them, never credentials.

## Recording preflight

- Push only after receiving explicit approval to commit.
- Wait for all four Vercel surfaces and the Render relay to finish deploying.
- Run `pnpm test:prod` and require all ten tests to pass against the live URLs.
- Open both demo sites and confirm all seven actions are present.
- Confirm the glasses can open a WebSocket to the relay before rehearsing.
- Clear the demo cart and reservations before every take.
- Record through Meta AI app, Devices, Record Display.
- Keep the final edit under three minutes and include narration audio.
- Upload publicly to YouTube, then replace the video placeholder above.
