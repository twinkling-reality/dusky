# Security

Dusky is experimental software built on an experimental browser API. It is not
an authenticated multi-tenant service.

## Reporting

Use GitHub's private vulnerability reporting for this repository if GitHub
shows that option. The repository does not currently publish a dedicated
security email address.

If private vulnerability reporting is unavailable, use a private contact
method listed on the repository owner's GitHub profile if one exists. If no
private channel is available, open a public issue that asks for a private
contact without including vulnerability details, exploit steps, credentials,
pairing codes, or user data.

Include privately:

- the affected commit or deployment;
- browser and version;
- provider and console origins;
- reproduction steps;
- whether a tool was read, write, financial, or destructive;
- whether the issue crossed origins, exposed relay data, or bypassed a wearer
  decision.

## Pairing codes are bearer capabilities

A Dusky pairing code is six letters. It is designed to be read from the lens
and typed into the console. It is not an account, an identity, or a strong
authentication secret.

Anyone who can reach the relay and knows a valid code can attach a Display or
console socket to that session. Attaching another socket with the same role
supersedes and disconnects the existing one. A code holder can also request the
session's audit trail from `/diagnostics/:id` while that trail exists.
The relay also returns permissive CORS headers, so a browser script from any
origin can read that diagnostics response when it knows the code.

The current relay:

- does not validate the WebSocket `Origin` header;
- does not authenticate users or devices beyond the pairing code;
- does not rate-limit connection attempts, code guesses, or diagnostics
  requests;
- accepts any syntactically valid code and creates a session actor for it;
- may persist audit metadata for seven days when file-backed audit storage is
  configured.

Use `wss://` so codes and session traffic are encrypted in transit. Do not post
codes, place them in screenshots, or reuse them as authorization elsewhere.

A code does not rotate. The Display mints one on first launch, stores it in
`localStorage`, and nothing in the codebase ever clears it, so a code that has
been shown once identifies that device until its site data is cleared. This is
deliberate, because it is what lets a wearer relaunch the web app without
re-pairing the console, but it means a code in a recording or a screenshot
stays valid.

To demonstrate or record with a throwaway code, open the Display with an
explicit one:

```text
https://your-dusky-display.example/?session=ABCDEF
```

A `session` query value takes precedence and is deliberately not written back
to storage, so the device keeps its own code. Draw the six characters from
`ABCDEFGHJKMNPQRSTUVWXYZ`.
The public demo relay should not carry sensitive or production tasks. A
deployment that needs stronger isolation must add appropriate authentication,
rate limiting, Origin policy, network controls, and diagnostics access control.

## Data flow

Browser-managed credentials such as cookies and session state remain inside
the provider documents in the console's browser. Dusky does not copy them into
tool descriptors or frames. A provider can still declare a credential-like
argument or return sensitive data, and that task data follows the relay path
described below.

The console and relay do exchange data needed to run a task:

- provider origins and normalized tool descriptors, including names,
  descriptions, annotations, and schemas;
- text the wearer submits as an intent or parameter value;
- tool names and argument values for invocation;
- raw tool result strings returned by provider pages;
- Display frames, choices, task progress, and consent decisions.

The relay is therefore trusted with task content even though it does not hold
provider cookies. Protect relay transport, host access, environment variables,
logs, memory, audit storage, backups, and diagnostics accordingly.

Audit events are designed to omit provider credentials, raw tool results,
transferred values, argument values, and message bodies. The pairing code is
the audit session identifier and is retained alongside provider origin, tool
name, policy decision, plan outcome, timing, and error categories. Treat the
audit trail as sensitive metadata rather than as public telemetry.

## Optional model data egress

The planner is off unless `DUSKY_PLANNER=on`, `DUSKY_MODEL_PROVIDER` explicitly
selects `openai` or `anthropic`, and the selected adapter has its matching
server-side credential. Dusky never selects a provider merely because its key
exists. The selected provider receives:

- the wearer's typed or composed request, truncated for the prompt;
- a bounded shortlist of provider-authored tool names, origins, titles,
  descriptions, parameter names, parameter descriptions, enum values, and the
  ceremony Dusky assigned;
- for resolver planning, the target tool name, missing parameter name, and its
  description;
- Dusky's system instructions and expected structured answer schema.

The planner does not intentionally send provider cookies, the full tool
registry, raw JSON Schemas, raw tool result strings, or retained cross-provider
result values. The wearer's request can contain any text they entered,
including sensitive text, so operators must not treat that request as free of
credentials. Tool metadata remains untrusted input even after it is flattened
and bounded for the prompt.

`OPENAI_API_KEY` and `ANTHROPIC_API_KEY` remain in the relay process. They are
not sent to the browser, Display, console, provider pages, prompts, frames,
logs, or audit records.

Enabling the planner creates a separate data relationship with the selected
model provider. Operators are responsible for reviewing that provider's terms,
retention, regional processing, access controls, and suitability for the data
their users may put into requests. Leave the planner off when that egress is not
acceptable.

## Enforced boundaries

### Provider authorization

A provider must explicitly expose WebMCP tools to the console's exact origin.
Runtime provider configuration cannot create or override that grant. The
provider page must also be one the operator intends to load and trust.

### Tool identity

Tools are identified by `(origin, name)`. Display labels and configured
provider names are not authorization identities. A bare name is refused when
more than one origin registered it.

### Planner authority

Planner output is untrusted. A proposed tool that was not offered is rejected.
Dusky filters arguments to declared properties and checks the primitive types
and enum values it supports before invocation.

OpenAI and Anthropic are interchangeable only at the proposal port. Neither
adapter executes WebMCP tools, approves an action, changes policy, or bypasses
the transfer and confirmation state machine.

This is not full JSON Schema validation. Dusky does not generally enforce
constraints such as string patterns, lengths, numeric ranges, or formats.
Providers must validate every argument again and apply their own authorization
and transaction rules.

### Wearer confirmation

Every tool Dusky classifies as non-read requires a current Display
confirmation. One confirmation applies to one invocation.

Classification is a defensive policy, not proof of what provider code will do.
A malicious or incorrect provider can misdescribe a side effect. Use only
providers the operator and wearer trust.

### Cross-origin transfer

Before a bounded result value fills another provider's argument, the Display
shows the source, destination, argument, and exact value. Transfer approval
does not approve the destination action. The destination tool and supported
argument shape are checked again before the value is applied.

### Timeouts

A timed-out non-read action has an unknown outcome and is not automatically
retried. Browser cancellation is not reliable, so provider code may still
finish after Dusky reports the timeout.

### Browser-agent requests

Dusky's browser-agent tools do not accept a pairing code or session identifier.
They affect only the session already paired with that console document and
cannot replace an active wearer decision. This restriction does not make the
relay itself authenticated. A separate client that knows a pairing code can
still attach directly as described above.

## Provider responsibilities

Dusky cannot inspect what provider code actually does. Providers remain
responsible for authentication, authorization, complete input validation,
transaction safety, idempotency, output handling, and user-data protection.

See [Trust model](./docs/TRUST-MODEL.md) for the code-level enforcement model.
