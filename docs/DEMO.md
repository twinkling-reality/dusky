# Demo

The demo follows authorized WebMCP tools from provider documents in a desktop
browser to the Display interface.

The bundled providers are fixtures. They do not sell, reserve, send, or deliver
anything outside the demo.

## Start locally

Requirements:

- Node.js 22 or newer;
- pnpm 10;
- Chrome with `chrome://flags/#enable-webmcp-testing` enabled.

```bash
pnpm install
pnpm dev
```

Open <http://localhost:7803>.

The local system starts the Display on `7802`, console on `7803`, market on
`7801`, reservations on `7804`, communications on `7805`, and relay on `7900`.
Playwright also starts the test-only runtime provider on `7806`.

The planner is off in this default setup. Menus, parameters, confirmation,
invocation, and results remain usable without a model.

## Desktop path

1. Choose **Open Dusky**.
2. Wait for the requirements control to report WebMCP, tool registration, and relay availability.
3. Use the Display panel on the left.
4. Watch the selected provider page and activity log update.

The embedded panel loads the same Display application used on the glasses.

## Add a real fourth Website

Canopy Lab is a public HTTPS WebMCP provider that is deliberately absent from
Dusky's source registry. It authorizes both the official console and the local
console, so the same URL works in either demo:

```text
https://dusky-canopy-lab.glendonchin.chatgpt.site
```

1. Open **Configure Websites**.
2. Choose **Add Website**.
3. Paste the Canopy Lab URL and choose **Verify Connection**.
4. Add it with the default name or enter a display name.
5. Choose **Estimate shade** on the Display and select **garden**.

Dusky discovers the action from the live provider document, renders the
provider's enum as Display choices, invokes it once, and shows the returned
shade facts. Nothing for Canopy Lab is added to `apps/console/src/sources.ts`.

`http://localhost:7806` remains a test-only fixture used by Playwright. It is
not a URL to paste during a public demonstration.

## Glasses path

The official deployment may lag the repository. Check
[Verification](./VERIFICATION.md) for the exact deployed revision and test
status before using these URLs as evidence for a change.

In the Meta AI phone app, open:

**Devices → Display Glasses settings → App connections → Web apps → Add a web app**

Add:

```text
https://dusky-display.vercel.app
```

Then:

1. Open Dusky on the glasses.
2. Read the six-letter pairing code.
3. Open <https://dusky-console.vercel.app/demo> in a WebMCP-capable desktop browser.
4. Enter the code under **Six-letter pairing code**.
5. Keep the console open while using the glasses.

The glasses render frames and send input. Provider tools execute in the
desktop console's provider documents.

Pairing codes are short bearer capabilities. Use a fresh code, do not share
it, and see [Security](../SECURITY.md) before using a non-local relay.

## Hardware and keyboard controls

| Input | Effect |
| --- | --- |
| Up or Left | Previous row |
| Down or Right | Next row |
| Enter | Select the focused row |
| Escape | Go back |

Visible navigation rows provide more specific movement:

| Row | Effect |
| --- | --- |
| Back | Leave a parameter or value screen |
| Back to sites | Return from provider actions to the provider list |

For text, focus **Enter a value**, select it to open the composer, write or
dictate the value, and choose **Done**.

## Live cross-provider task

The reservation-to-message request requires the optional planner. Start the
local relay with a credential that the Anthropic SDK can resolve, for example:

```bash
DUSKY_PLANNER=on ANTHROPIC_API_KEY='replace-with-your-key' pnpm dev
```

This sends the wearer's request and bounded provider tool cards to Anthropic.
See [Trust model](./TRUST-MODEL.md) for the exact data boundary.

Submit:

> Reserve a table for four, then send the reservation details to Dana.

A live model can time out, decline, fill a parameter directly, or propose a
different valid route. The path is therefore a live demonstration, not a
deterministic assertion that every intermediate screen will appear.

When a compatible reservation value is selected for the communications
provider, the enforced consent behavior is:

1. the transfer frame shows source, destination, field, and exact value;
2. Share applies only that value to one declared argument;
3. the destination action follows its own policy gate;
4. a destination classified as non-read stops for a separate confirmation.

## Deterministic transfer proof

The fixed-planner browser test proves the exact reservation, contact lookup,
projection choice, transfer approval, and separate message confirmation path:

```bash
pnpm exec playwright test e2e/transfer.spec.ts
```

It uses real WebMCP provider tools in Chrome, but it instantiates `Session`
inside the test page. It does not exercise the relay transport, rendered
Display component, live model, or physical glasses. The broader round-trip
suite covers the relay and rendered Display separately.

## Runtime provider

Repeated `site` values replace the bundled fixture list for one console page:

```text
http://localhost:7803/demo?start=1&site=https%3A%2F%2Fprovider.example%2Ftools
```

A value can also contain a display name. Start with this object:

```json
{"name":"Example","url":"https://provider.example/tools"}
```

Then encode it as one `site` value:

```text
http://localhost:7803/demo?start=1&site=%7B%22name%22%3A%22Example%22%2C%22url%22%3A%22https%3A%2F%2Fprovider.example%2Ftools%22%7D
```

The URL selects a page to load. It does not grant WebMCP access. The provider
must permit iframe embedding and authorize the exact console origin.

The public Canopy Lab URL above is the maintained reference provider for this
flow. The placeholder URLs in this section document the general query format,
not a working public provider.

See [Provider guide](./PROVIDER-GUIDE.md) for the full contract.

## Limits

- Dusky does not work with arbitrary websites.
- Cross-origin WebMCP support remains experimental.
- The console must stay open while tools are available.
- The optional planner can time out or decline a plan.
- Desktop automation does not replace physical-glasses verification.
