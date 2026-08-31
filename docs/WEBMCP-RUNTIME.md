# WebMCP and display runtime

This document separates behavior measured by this repository from constraints
stated by the platform documentation.

## Verified Chrome runtime

Unless another date is stated, the WebMCP observations were measured on
2026-08-25 against Chrome `151.0.7922.174`.

Local browser tests launch Chrome with:

```text
--enable-features=WebMCPTesting
```

The matching setting is:

```text
chrome://flags/#enable-webmcp-testing
```

These findings are version-specific. A newer browser may remove a workaround
or introduce different behavior.

### API location

The runtime API is `document.modelContext`, not `navigator.modelContext`.

### Invocation arguments

The current specification accepts an object for `executeTool`. Chrome 151
requires JSON-string arguments.

Dusky registers a temporary local read-only tool and tests the object form on
that probe. Only the harmless probe may be repeated with a JSON string. Once
the browser shape is known, each provider tool is invoked exactly once.

A provider error, including one that contains the browser's parse-error text,
never triggers the compatibility probe or a second provider invocation.

### Input schemas

Chrome returns `inputSchema` as a JSON string rather than an already parsed
object. Dusky parses it defensively before rendering or validating parameters.

### Cancellation

Chrome 151 failed the measured `executeTool-abort` Web Platform Tests. When a
session deadline expires, the relay sends `cancelInvoke` to the paired console,
which aborts the exact browser invocation controller. Dusky also races the call
against its own deadline because the browser may ignore that signal.

A timeout does not prove that an action failed. Anything classified as non-read
is never retried automatically.

### Cross-origin access

Cross-origin discovery requires all three parts:

```ts
exposedTo: [consoleOrigin]
```

```ts
getTools({ fromOrigins })
```

```html
<iframe allow="tools">
```

If one part is missing or names the wrong origin, the browser returns no tools.

Runtime `site` values cannot grant WebMCP access.

### Calling-document tools

Verified on 2026-08-26, `getTools({fromOrigins})` also returned tools registered
by the calling document even when the requested origins named only providers.

Dusky filters results to the requested origins so its own browser-agent tools
cannot appear on the wearer's menu.

### Tool order

The browser owns the order returned by `getTools`. Dusky applies a deterministic
total order before building a menu.

### Tool-change events

The current specification exposes a `toolchange` event. Measured environments
have also exposed a legacy handler or no event surface at all.

`packages/webmcp` prefers the standard event, supports the measured legacy
handler, and uses a descriptor-signature poll only for the incomplete host
object that has neither.

### DevTools Protocol

Chrome 151 exposes a WebMCP DevTools Protocol domain containing:

- `invokeTool`;
- `toolsAdded`;
- `toolInvoked`;
- `toolResponded`.

The current browser flow does not depend on that domain.

## Meta Ray-Ban Display Web Apps

The following viewport, input, permission, storage, and delivery constraints
come from Meta's platform contract unless a paragraph explicitly names a Dusky
test or physical-glasses observation.

The glasses run an HTML, CSS, and JavaScript Web App from a public HTTPS URL.

### Display contract

- Fixed 600 by 600 viewport
- No scrolling
- Minimum 88-pixel interactive target
- 16-pixel body text
- 20 to 24-pixel primary text
- At most four interactive rows in a Dusky frame

Parameter and projection frames reserve Back. Provider submenus reserve Back
to sites. Navigation identifiers are handled before argument coercion and
cannot reach a provider as values.

### Light and color

The display is an additive waveguide. Black emits no light and appears
transparent against the surroundings.

The Display palette is separate from the desktop palette and must not be
treated as an ordinary dark theme.

### Input

The operating system translates Neural Band and temple input into:

- `ArrowUp`;
- `ArrowDown`;
- `ArrowLeft`;
- `ArrowRight`;
- `Enter`;
- `Escape`.

The Web App receives no cursor, pointer position, mouse event, or raw gesture.

### Text entry

Free text uses the glasses composer through handwriting or dictation. Dusky
commits once on Enter or blur rather than once per keystroke.

### Documented platform features

The Web App supports WebSocket, Fetch, Service Worker, and local storage up to
5 MB.

It does not receive camera, microphone, or notification access.

### Documented delivery budget

The target limits are under 3 seconds to load, under 500 KB of gzipped
JavaScript, and under 10 network requests.

The current Display build is approximately 64 KB gzipped. A local build does
not prove real-device loading time.

## Evidence boundary

Desktop Chrome verifies WebMCP behavior, frame geometry, and the keyboard form
of the input contract.

It does not verify physical-waveguide legibility, real Neural Band behavior,
composer behavior on hardware, sleep recovery, or device loading time.
