# Provider guide

Dusky needs a page URL and the WebMCP tools that page explicitly exposes to the
console origin. It does not need a provider-specific adapter.

## 1. Register a tool with a real lifetime

Create the cancellation signal synchronously and abort it when the page or
component stops owning the registration:

```ts
const lifetime = new AbortController();

await document.modelContext.registerTool(
  {
    name: "estimate_shade",
    title: "Estimate shade",
    description: "Estimate canopy shade for a survey zone without changing it.",
    inputSchema: {
      type: "object",
      properties: {
        zone: {
          type: "string",
          enum: ["courtyard", "terrace", "garden"],
          description: "Which survey zone?",
        },
      },
      required: ["zone"],
    },
    annotations: { readOnlyHint: true },
    execute: async ({ zone }) =>
      JSON.stringify({
        survey_zone: zone,
        shade_percent: 62,
        canopy_condition: "healthy",
      }),
  },
  {
    exposedTo: ["http://localhost:7803"],
    signal: lifetime.signal,
  },
);

addEventListener("pagehide", () => lifetime.abort(), { once: true });
```

In React, create the controller at the start of the effect and call
`lifetime.abort()` in the effect cleanup. Do not wait for registration to
finish before creating its disposer.

The bundled fixtures use `registerTools` from `@dusky/webmcp` to isolate
browser compatibility behavior. External providers do not need that package.

## 2. Authorize the exact console origin

`exposedTo` is the provider's authorization decision. Use only the exact origin
for the console that will load the page:

```text
Local:    http://localhost:7803
Deployed: https://your-dusky-console.example
```

Do not include a path, query, trailing slash, preview URL, or different scheme.
A runtime query value cannot grant access on behalf of a provider.

## 3. Permit the console to embed the page

The provider runs in a cross-origin iframe. A restrictive
`Content-Security-Policy: frame-ancestors` directive or `X-Frame-Options:
DENY` or `SAMEORIGIN` will prevent the page from loading.

Authorize the intended console origin in `frame-ancestors`, for example:

```text
Content-Security-Policy: frame-ancestors http://localhost:7803 https://your-dusky-console.example
```

Keep only the console origins that should be allowed in each environment.

Embedding permission and WebMCP `exposedTo` are separate. Both must allow the
console, and the console iframe must carry `allow="tools"`.

## 4. Use a Display-operable schema

Dusky currently drives required top-level primitive parameters:

| Declared shape | Display interaction | Dusky check |
| --- | --- | --- |
| String with `enum` | One choice per allowed value | Exact declared enum member |
| Integer or number with `enum` | One choice per allowed value | Exact declared enum member |
| Boolean | Yes and No | Boolean or the text `true` or `false` |
| String | Glasses text composer | Primitive converted to text |
| Integer or number | Glasses text composer | Conversion to a finite JavaScript number |

Optional parameters are not requested. Required objects and arrays are not
Display-operable, so a planner cannot start a plan containing that tool.

Dusky does not enforce general JSON Schema constraints such as `minimum`,
`maximum`, `multipleOf`, `minLength`, `pattern`, `format`, or integer-only
semantics. Provider code must validate the complete input before performing an
action.

Use short titles, parameter descriptions, and enum labels. The Display is 600
by 600 with four interactive rows and no scrolling.

## 5. Return structured JSON

Return a JSON string for structured results:

```ts
return JSON.stringify({
  survey_zone: "garden",
  shade_percent: 62,
  canopy_condition: "healthy",
});
```

Dusky humanizes generic keys and renders bounded scalar facts. It does not need
a result mapping for a provider.

Return an explicit negative clearly:

```ts
return JSON.stringify({ ok: false, error: "No reading is available." });
```

An explicit negative is shown as failure. Unknown result shapes are not
automatically called failures.

## 6. Support generic choices and transfer when useful

A read-only lookup can become Display choices when its result contains an
array of objects with:

- an identifier key named `id`, `sku`, `key`, `uid`, `slug`, `value`, or ending
  in `_id`;
- a string label key named `name`, `title`, `label`, `summary`, `text`, or
  `description`.

If that conservative convention does not match, Dusky falls back to the text
composer. It does not guess a provider-specific mapping.

For a later task step, Dusky retains only bounded primitive projections and a
generic summary from a successful result. Current bounds are 32,768 input
characters, 128 visited nodes, depth 6, 12 projections, and 120 characters for
a complete string. Raw results, objects, arrays, markup, and incomplete long
strings are not transferred as an argument.

Cross-origin reuse always shows the exact bounded value to the wearer before it
is applied. Same-origin lookup behavior remains separate.

## 7. Name a coordinate the way everyone else does

WebMCP has no channel for ambient context. `executeTool` receives the input
your schema declared and an `AbortSignal`, and nothing else, so a wearer's
position can reach a tool only as a parameter you asked for.

Dusky offers the wearer's device as an answer when a required parameter is
named for one half of a coordinate:

| Declared name | Offered as |
| --- | --- |
| `latitude`, `lat` | Latitude |
| `longitude`, `lng`, `lon` | Longitude |

Case and separators are folded, so `Latitude` and `lat_` match. Nothing else
is: `lat_1` and `platitude` do not. The parameter must be a string or a number;
a declared enum keeps its own choices, because those name every value you
actually accept.

This is a recognition rule, not a schema extension. There is nothing to adopt
and no Dusky-specific keyword to add. A site that already publishes a
coordinate API works unchanged, and a site that names these fields something
else simply gets the ordinary text composer.

```ts
inputSchema: {
  type: "object",
  properties: {
    latitude: { type: "number", description: "Latitude?" },
    longitude: { type: "number", description: "Longitude?" },
  },
  required: ["latitude", "longitude"],
}
```

What you receive is bounded and consented, twice over:

- The wearer presses a row to read their device. Nothing is read otherwise,
  there is no watch, and no position is stored anywhere in Dusky.
- Each coordinate then gets its own transfer frame naming your site, the
  destination field, and the exact value, and only Share applies it. A two
  field tool asks twice, because sharing fills one argument.
- Values arrive rounded to four decimal places, roughly eleven metres. Do not
  design a tool that needs more precision than that.

Your page cannot read the position itself. The console mounts providers with
`allow="tools"`, and Permissions Policy defaults every other feature to `self`,
so `navigator.geolocation` inside your frame fails with `PERMISSION_DENIED` and
no prompt. Handle a missing coordinate as ordinary missing input.

## 8. Describe consequences honestly

Set `readOnlyHint: true` only when execution does not change state.

Dusky treats annotations as untrusted hints. Hard financial, destructive, or
mutation evidence can raise the confirmation requirement. Unknown tools
default to write.

Provider code remains responsible for authorization, complete input
validation, idempotency, and transaction behavior.

## 9. Load the provider at runtime

For the product path, open **Websites** on the Dusky graph. Add an available
known provider with **Reconnect**, or choose **Add Website** and enter the exact
connection link supplied by a site that supports Dusky. **Verify Connection**
loads that page temporarily and requires at least one origin-authorized WebMCP
action before the optional naming step appears. **Add Website** or **Skip**
connects it immediately; there is no draft or separate graph update. An
ordinary homepage, restaurant page, or chat URL is not a connection link merely
because it is a valid URL. Connection changes are available only while the
Display is on its action menu.

The raw query path below remains useful for isolated development and automated
proofs. It replaces the sample list rather than mixing with it.

Supply a URL to the local console:

```text
http://localhost:7803/demo?start=1&site=https%3A%2F%2Fprovider.example%2Ftools
```

For a display name, encode this object as one `site` value:

```json
{"name":"Example provider","url":"https://provider.example/tools"}
```

The complete encoded local URL is:

```text
http://localhost:7803/demo?start=1&site=%7B%22name%22%3A%22Example%20provider%22%2C%22url%22%3A%22https%3A%2F%2Fprovider.example%2Ftools%22%7D
```

Repeat `site` to load several origins. Runtime values replace the bundled
fixture list for that console page.

Public providers must use HTTPS. Loopback HTTP is accepted for development.
Embedded credentials, unsupported schemes, duplicate origins, and invalid
values are rejected.

## 10. Verify the complete path

Do not stop at discovery. Verify that a real browser can:

1. embed the provider page;
2. discover the authorized tool through WebMCP;
3. render every required parameter on the Display;
4. invoke the live tool handle exactly once;
5. observe provider state when appropriate;
6. render the returned result;
7. enforce the expected transfer and action policy gates.

`e2e/runtime-provider` is the minimal in-repository example. Its Playwright
test supplies the provider at runtime with vocabulary absent from the default
registry.

The deployed reference provider is
<https://dusky-canopy-lab.glendonchin.chatgpt.site>. It is also absent from the
default registry, explicitly authorizes the local and official console
origins, and can be pasted into **Add Website** for a public demonstration.

Its `/field` page declares a coordinate tool instead of a zone enum, and is the
one to paste when demonstrating the wearer-position path.

```bash
pnpm exec playwright test e2e/roundtrip.spec.ts
```

See [WebMCP and display runtime](./WEBMCP-RUNTIME.md) before changing a browser
compatibility workaround.
