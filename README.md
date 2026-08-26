# Dusky

A browser for a web made of tools instead of pages.

Dusky turns a website's declared [WebMCP](https://github.com/webmachinelearning/webmcp) tools
into a glanceable, gesture-driven interface for Meta Ray-Ban Display: a 600x600
additive waveguide with six keys of input and no cursor. Instead of rendering a
page you cannot read, Dusky reads the actions the site chose to publish and asks
you one question at a time.

There is no per-site integration anywhere in this repository. Point Dusky at a
participating site and the interface is derived from that site's tool schemas.

Two first-party services are included so that claim can be checked rather than
believed. Verdant Market sells things; Amber & Oak holds tables. They declare a
different number of tools, use different parameter types, and return completely
different result shapes. The same Dusky drives both, and adding the second one
changed nothing inside it.

## Try it without glasses

The Display client is an ordinary web page. The glasses translate Neural Band
pinches and temple swipes into arrow keys and Enter, so **the same build runs in
your browser, driven by the same code path**. What you cannot see without
hardware is the waveguide, not the product.

You need a WebMCP-capable browser:

- **Chrome 149 or later** with `chrome://flags/#enable-webmcp-testing` enabled, or
- **the ChatGPT desktop app's built-in browser**, which supports WebMCP by default.

```bash
pnpm install
pnpm dev
```

Then open <http://localhost:7803> and press **Try it now**. Dusky mints a
pairing code, opens the Display in the same tab, and pairs itself: the glasses
view, the partner site and every protocol call are all on one screen.

To drive a real pair of glasses instead, open the Display at
<http://localhost:7802>, read the six letters off the lens, and enter them on
the demo page.

Drive the Display with <kbd>↑</kbd> <kbd>↓</kbd> to move focus, <kbd>Enter</kbd>
to select, <kbd>Esc</kbd> to go back. Those six keys are the entire input
surface of the real device.

Watch the console's **Protocol activity** panel while you do it: every
`getTools` and `executeTool` call is logged as it happens, so nothing has to be
taken on trust.

## Watching a schema become an interface

Further down the console there is a JSON Schema on one side and the screens it
compiled to on the other, with every step in between labelled by the function
that took it. The panel is the component the glasses render, driven by the same
state machine over the same compiler, with a tool runner that answers from a
text box rather than from a network.

Which means the schema is editable. Change a parameter from a string to an enum
and the composer becomes buttons while you watch; paste a tool from a site
nobody here has seen and it compiles anyway. A hardcoded interface cannot
answer an edit, so this is the one part of the argument that costs no trust.
It also needs no WebMCP, which is why it works in any browser.

## On the actual glasses

1. Deploy `apps/display` to any HTTPS host.
2. In the Meta AI app, enable Developer Mode (Settings > App Info, tap the app
   version five times).
3. Go to App Settings > App Connections > Web Apps > Add a Web App and paste the
   URL.
4. Launch it from the glasses app grid.

The console still runs in a browser on your phone or laptop, because that is
where the partner site's session and tools live. You do not look at it.

## How it fits together

```
  GLASSES                    DUSKY BACKEND                  BROWSER
┌──────────────┐    wss    ┌────────────────────┐   wss   ┌──────────────────────────┐
│ Display Web  │◄─────────►│  Session actor     │◄───────►│  Console                 │
│ App 600x600  │           │  ├ task state      │         │  ├ iframe allow="tools"  │
│ ↑↓←→ ⏎ esc   │           │  ├ policy engine   │         │  │   └ partner site      │
│ composer     │           │  └ audit log       │         │  └ WebMCP bridge         │
└──────────────┘           └────────────────────┘         └──────────────────────────┘
   decides                     never holds                    executes tools in the
                               site credentials                site's own document
```

The glasses hold attention and authority. The browser holds capability and
session. Dusky moves intent between them and never moves credentials: a tool
runs inside the partner site's own document, in your own logged-in session,
mediated by the browser.

## Layout

| Path | What it is |
| --- | --- |
| `packages/contracts` | Shared types. The one place every surface agrees on shape. |
| `packages/policy` | Deterministic trust rules. No model, no network, no DOM. |
| `packages/frames` | The schema-to-frame compiler. Turns a tool schema into screens. |
| `packages/session` | The task machine. Intent in, frames out, ports for everything else. |
| `packages/webmcp` | The only file that knows what browsers actually do, versus what the spec says. |
| `packages/tokens` | Design tokens. Two palettes: console, and emitted light for the waveguide. |
| `packages/lens` | The 600x600 panel as a component, so the website renders the real one. |
| `apps/display` | The 600x600 Web App. The primary product surface. |
| `apps/console` | The website: the front door, and the demo that is Dusky's WebMCP client. |
| `apps/server` | Session relay. Owns task state so a reload cannot lose your place. |
| `apps/market` | A first-party WebMCP test service. Clearly labelled; nothing is sold. |
| `apps/reservations` | A second test service with nothing in common with a shop. Nothing is reserved. |
| `e2e` | The round trip, run against real Chrome with the real flag. |

## What Dusky does not claim

- **It does not work with arbitrary WebMCP sites.** Consuming another site's
  tools requires that site to name Dusky's origin in `exposedTo`. This is a
  deliberate security property of the specification and the browser enforces it.
- **It does not integrate with Meta AI** or extend its voice commands.
- **It has no microphone or camera on the Display.** Free text arrives through
  the on-glasses composer (handwriting or dictation), which the wearer opens.
- **It does not read raw Neural Band gestures.** The OS moves focus; the app is
  told what was activated.
- **It does not guarantee correct agent reasoning.** The policy layer is the
  guarantee: nothing consequential runs without an explicit human confirmation,
  and success is only ever reported from a tool's returned result.

## Development

```bash
pnpm test        # unit tests
pnpm test:e2e    # round trip in real Chrome with the WebMCP flag
pnpm typecheck
pnpm lint
```

`pnpm test:e2e` launches your installed Chrome with
`--enable-features=WebMCPTesting`, so the suite exercises a real browser rather
than a stub.

## License

MIT. See [LICENSE](./LICENSE).
