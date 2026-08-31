# Genericity

Dusky has one provider-independent path from a WebMCP declaration to the
Display interaction.

Genericity does not mean automatic access to every website. Providers require
configuration and browser-enforced authorization.

## Configuration is not integration

The default console registry contains three first-party fixtures:

- Verdant Market;
- Amber & Oak;
- Northstar Dispatch.

A source record contains an identifier, display name, URL, and descriptive text
for the console. It does not contain tools, UI definitions, policy rules,
invocation adapters, argument mappings, or result parsers.

Runtime `site` parameters can replace the default registry. Public values must
use HTTPS. Loopback HTTP is accepted for development. Duplicate origins,
embedded credentials, and unsupported schemes are rejected.

## Browser authorization

Loading a provider page is not enough. All of these must be true:

1. The console loads it in an iframe with `allow="tools"`.
2. The provider registers WebMCP tools.
3. The provider names the console's exact origin in `exposedTo`.
4. The console requests that origin through `getTools({fromOrigins})`.

The browser enforces this boundary. Runtime configuration cannot override the
provider's grant.

Dusky also filters discovery results to the requested origins because the
tested Chrome version may include tools registered by the console document.

## Shared code path

After discovery, shared packages receive normalized tool descriptors rather
than source records.

- `packages/frames` builds parameters, menus, paging, results, and projections.
- `packages/policy` assigns deterministic ceremony.
- `packages/session` validates inputs, runs gates, invokes tools, and advances tasks.
- `packages/planner` may propose a bounded plan but cannot authorize it.
- `packages/webmcp` isolates browser compatibility behavior.

Tool identity is `(origin, name)`. Provider grouping on the Display is
navigation over a combined registry, not a provider-specific execution path.

There is no production connector between any pair of bundled fixtures and no
adapter that translates one fixture's vocabulary into another.

## Why the fixtures differ

The fixtures exercise different generic branches:

- market: products, carts, free text, mutation, and money-shaped results;
- reservations: string enums, integer enums, booleans, returned failures;
- communications: contacts, drafts, messages, and cross-origin handoff.

A new fixture can reveal a generic bug. The correct fix depends on schema or
protocol behavior, not provider identity or vocabulary.

## Fourth runtime provider

Playwright starts `e2e/runtime-provider` at `http://localhost:7806`.

It is not listed in `apps/console/src/sources.ts`. The test supplies it through
a runtime `site` parameter under the name Canopy Lab.

The provider declares `Estimate shade`, a `zone` enum, and result fields for a
survey zone, shade percentage, and canopy condition.

The browser test verifies that:

1. the runtime provider replaces the default fixtures;
2. its tool is discovered through cross-origin WebMCP;
3. its enum becomes Display choices;
4. Back remains visible;
5. selecting `garden` invokes the live provider tool;
6. the provider document records `garden: 62% shade, healthy`;
7. the Display renders facts from the unfamiliar result keys;
8. market-specific output is absent.

This proves the production code path for that provider and schema in a local
end-to-end test. The provider is still test code in this repository, so this
does not prove universal WebMCP compatibility.

## Executable-source guard

`packages/frames/src/genericity.test.ts` scans executable production TypeScript
in frames, session, policy, and planner.

It rejects:

- bundled fixture and runtime proof provider brands;
- complete tool names from those proof providers;
- selected provider-only result keys from those proof providers;
- application imports;
- source-registry imports.

This catches direct forms of provider coupling. It does not detect every
encoded identifier, synonym, indirect dependency, behavioral assumption, or
unsupported schema.

The scan is a regression guard, not mathematical proof.

Run it with:

```bash
pnpm vitest run packages/frames/src/genericity.test.ts apps/console/src/sources.test.ts
```

## Precise claim

Dusky accepts configured provider URLs, receives the tools those providers
authorize the browser to return, and drives the supported schemas through
shared code without a pairwise connector or provider-specific adapter.
