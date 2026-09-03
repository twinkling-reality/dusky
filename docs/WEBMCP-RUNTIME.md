# WebMCP and display runtime

This document separates behavior measured by this repository from constraints
stated by the platform documentation.

## Verified Chrome runtime

Unless another date is stated, the WebMCP observations were measured on
2026-08-25 against Chrome `151.0.7922.174`.

On 2026-09-01, the live official console was rechecked in Google Chrome
`152.0.7977.65` with the same `WebMCPTesting` feature. `document.modelContext`
was present, the three `allow="tools"` provider frames returned 4, 3, and 4
tools respectively through `getTools({ fromOrigins })`, and Dusky's four
calling-document tools also registered. The console rendered the filtered 11
provider actions and mounted the embedded Display.

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

### Provider execution evidence

The console does not treat receipt of an `invoke` relay message as evidence
that a provider ran. Descriptor revalidation, the harmless argument-shape
probe, and cancellation can all stop before the provider boundary.

`WebMcpBridge.invoke` accepts a lifecycle callback and fires `executing` with
the exact `(origin, name)` synchronously after those checks and immediately
before `document.modelContext.executeTool`. No asynchronous work sits between
the event and the call. A validation or pre-execution cancellation failure
emits no provider-hit event. A returned value remains a neutral return until
`packages/session` derives a semantic succeeded, failed, or unknown outcome
from the result.

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

### In-app browser compatibility is not one flag

Measured on 2026-09-01 in the Codex desktop in-app browser, the closest
automatable surface available to the ChatGPT desktop browser. Dusky's four
calling-document tools registered and were exposed to the browser agent, while
the three loaded cross-origin provider documents returned zero actions to the
console despite each iframe carrying `allow="tools"`.

This proves that calling-document registration is not a compatibility proxy
for cross-origin discovery. The Requirements panel names its tool-registration
probe as page-level and directs the full provider path to the measured Chrome
configuration. The actual ChatGPT desktop browser remains unmeasured.

### `allow="tools"` delegates WebMCP and nothing else

Measured on 2026-09-03 in Chrome 152 with `WebMCPTesting`.

`tools` is one policy-controlled feature among several, and Permissions Policy
defaults each of them to `self`. A provider mounted with `allow="tools"` alone
therefore gets WebMCP and no other delegated capability.

`e2e/position.spec.ts` measures the case Dusky depends on. With the browsing
context holding a geolocation grant, and the top-level Display in that same
context reading a position successfully, the provider document's own
`getCurrentPosition` returns `PERMISSION_DENIED` with no prompt.

Two consequences. A provider cannot read the wearer's position; it can only
receive one the wearer sent. And the failure is indistinguishable from a wearer
declining, so a provider must treat a missing coordinate as ordinary missing
input rather than as a refusal.

### No ambient-context channel exists

Checked against the specification source on 2026-09-03.

`executeTool` takes a registered tool, an input object, and an options bag
whose only member is an `AbortSignal`. The execute callback receives the same
two things. The draft contains no `_meta`, `clientContext`, elicitation,
sampling, or roots surface, and MCP's `_meta` defines an extension point with
no standard ambient key.

Context therefore has to travel as a parameter the provider declared. Dusky
recognizes the names sites already use for a coordinate rather than defining a
schema extension nothing could be expected to adopt. See
[Provider guide](./PROVIDER-GUIDE.md).

### Tool order

The browser owns the order returned by `getTools`. Dusky applies a deterministic
total order before building a menu.

### Tool-change events

The current specification exposes a `toolchange` event. Measured environments
have also exposed a legacy handler or no event surface at all.

`packages/webmcp` prefers the standard event, supports the measured legacy
handler, and uses a descriptor-signature poll only for the incomplete host
object that has neither. That compatibility watcher checks every 500
milliseconds only during the first 20 unchanged scans, then backs off to every
2.5 seconds. A registry change returns it to the fast settle window. Disposing
the bridge clears the pending timer. Chrome's event-capable implementation
never enters this polling path.

### DevTools Protocol

Chrome 151 exposes a WebMCP DevTools Protocol domain containing:

- `invokeTool`;
- `toolsAdded`;
- `toolInvoked`;
- `toolResponded`.

The current browser flow does not depend on that domain.

### Local test-process lifecycle

Measured on 2026-08-31 while repeatedly auditing the console redesign. The
local browser suite starts the relay, console, Display, three sample providers,
the runtime-provider fixture, and Chrome with `WebMCPTesting` enabled. That is
seven local services across ports `7801` through `7806` and `7900`, plus the
browser process.

An interrupted Playwright command did not always retain a process-group owner
long enough to stop every descendant. A cancelled audit could therefore leave
Vite, the relay watcher, or WebMCP-enabled Chrome alive after the parent task
had ended. Repeating the audit could accumulate idle browser descendants, keep
the laptop hot, or collide with an already occupied test port.

This was a local test-orchestration defect, not evidence that the WebMCP
protocol leaks servers and not a production Dusky relay leak. WebMCP matters to
the reproduction because the load-bearing suite deliberately launches real
Chrome with the experimental feature enabled rather than substituting a mock.

`pnpm test:e2e` and `pnpm test:prod` now run through
`scripts/run-playwright.mjs`. For local runs, the wrapper gives Playwright its
own process group, forwards `SIGINT`, `SIGTERM`, and `SIGHUP` to that group, and
escalates to `SIGKILL` after three seconds only when graceful cleanup does not
finish. In hosted CI, Playwright stays inside the job's supervised process tree.
The wrapper does not kill a server that was already running before the test and
was reused by Playwright; that process remains owned by the person or task that
started it.

During the 2026-09-01 UI audit, one runtime-provider fixture on port `7806`
from an earlier direct Playwright invocation was found and terminated. The
final focused run used the supervised wrapper. After it completed and the
manually started development tree was stopped, no listeners remained on ports
`7801` through `7806` or `7900`.

For a later project submission, the defensible lesson is: testing an
experimental browser capability end to end also requires supervising the
browser and every local service as one disposable system. Do not describe this
as a WebMCP server bug unless a reproduction outside Dusky's test runner proves
that claim.

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

### Location and sensors

Meta documents `navigator.geolocation` as the standard API, with the fix
supplied by the paired mobile device rather than by the glasses, an expected
accuracy of 5 to 50 metres, a required wearer permission grant, and guidance
that the permission request follow a user gesture.

Dusky reads a position only from inside the Display's own keypress handler, on
a parameter that named a coordinate, and never otherwise.

Measured on hardware 2026-09-03: the read works, and so does the prompt. A
wearer pressed the location row on real glasses, answered the ordinary Allow
once and Allow always grant on the waveguide, and the device returned a real
fix that reached a provider through two transfer approvals.

Meta documents the permission requirement and the user-gesture guidance but not
what the prompt looks like on a 600 by 600 additive display. It is a standard
two-option grant and it is operable there. The ten second read timeout was
never reached because the fix returned promptly, and how long a grant survives
across launches is unmeasured.

Meta also documents `DeviceMotionEvent` and `DeviceOrientationEvent`. Dusky
uses neither. The Display contract here excludes raw-gesture assumptions, and
the published guidance contradicts its own sample over whether
`DeviceOrientationEvent.requestPermission()` exists on the glasses runtime. The
reasoning is recorded in [Field notes](../FIELD-NOTES.md).

### Documented delivery budget

The target limits are under 3 seconds to load, under 500 KB of gzipped
JavaScript, and under 10 network requests.

The current Display build is approximately 64 KB gzipped. A local build does
not prove real-device loading time.

## Evidence boundary

Desktop Chrome verifies WebMCP behavior, frame geometry, and the keyboard form
of the input contract.

It does not verify physical-waveguide legibility, real Neural Band behavior,
composer behavior on hardware, sleep recovery, or device loading time. The
position path itself has been worn; see [Verification](./VERIFICATION.md).
