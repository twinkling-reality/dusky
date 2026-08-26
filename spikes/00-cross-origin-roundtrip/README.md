# Spike 00: cross-origin WebMCP round trip

Run 2026-08-25 against Chrome 151.0.7922.174, before any product code existed,
to answer the one question that could have killed the project: can a page
discover and invoke another origin's WebMCP tools, and does the site actually
change?

## Result: yes

| Step | Outcome |
| --- | --- |
| Site registers tools with `exposedTo: ["http://localhost:7802"]` | pass |
| Agent embeds it cross-origin with `allow="tools"` | pass |
| `getTools({fromOrigins})` returns name, description, schema, annotations | pass |
| `executeTool(search_products)` returns real results | pass |
| `executeTool(add_to_cart)` returns `{"ok":true,"cart_size":1,"cart_total":4.29}` | pass |
| Site DOM visibly changes to `Organic oat milk ($4.29)` | pass |
| An origin not named in `exposedTo` receives zero tools | pass |
| Same-origin caller sees no leaked tools | pass |

## What it taught us

Two runtime facts the specification does not state, both now encoded in
`packages/webmcp`:

1. Chrome requires JSON-string arguments to `executeTool`, not an object.
2. `inputSchema` is returned as a string.

It also surfaced the CDP `WebMCP` domain (`WebMCP.enable` succeeds;
`invokeTool`, `toolsAdded`, `toolInvoked`, `toolResponded` exist in the
binary), which is the eventual server-side path for sites that have not opted
in to `exposedTo`.

## Superseded by

`e2e/roundtrip.spec.ts`, which asserts the same round trip through the real
product code rather than a throwaway page. This directory is kept as dated
evidence, not as living code.
