/**
 * The only file in Dusky that knows what a browser's WebMCP implementation
 * actually does, as opposed to what the specification says it should do.
 *
 * Every workaround here is dated and attributed. When a browser catches up,
 * delete the workaround, not the abstraction.
 *
 * Verified against Chrome 151.0.7922.174 on 2026-08-25 by executing a real
 * cross-origin round trip. See spikes/00-cross-origin-roundtrip.
 */

import type { JsonSchema, RuntimeToolRef, ToolDescriptor } from "@dusky/contracts";

/* -------------------------------------------------- minimal ambient types */

interface RegisteredToolLike {
  name: string;
  title?: string;
  description: string;
  origin: string;
  window: Window;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
}

interface ModelContextLike {
  registerTool(tool: unknown, options?: unknown): Promise<void>;
  getTools(options?: { fromOrigins?: string[] }): Promise<RegisteredToolLike[]>;
  executeTool(
    tool: RegisteredToolLike,
    input?: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<string>;
  addEventListener?: (type: string, listener: EventListener) => void;
  removeEventListener?: (type: string, listener: EventListener) => void;
  ontoolchange?: ((this: unknown, ev: Event) => unknown) | null;
}

/** Fired only at the exact provider-execution boundary. */
export interface WebMcpInvokeLifecycleEvent {
  kind: "executing";
  tool: RuntimeToolRef;
}

export type WebMcpInvokeLifecycle = (event: WebMcpInvokeLifecycleEvent) => void;

const ARGUMENT_PROBE_PREFIX = "dusky_internal_argument_shape_probe_";
const COMPATIBILITY_SCAN_FAST_MS = 500;
const COMPATIBILITY_SCAN_SLOW_MS = 2_500;
const COMPATIBILITY_SCAN_FAST_COUNT = 20;
let argumentProbeSequence = 0;
const argumentProbeNames = new WeakMap<Window, Set<string>>();

/** A probe is local only when both its name and owning window say so. */
function isCallingDocumentProbe(tool: RegisteredToolLike): boolean {
  const owner = globalThis.window;
  return tool.window === owner && argumentProbeNames.get(owner)?.has(tool.name) === true;
}

function ctx(): ModelContextLike | null {
  const d = globalThis.document as unknown as { modelContext?: ModelContextLike } | undefined;
  return d?.modelContext ?? null;
}

export function isWebMcpAvailable(): boolean {
  return ctx() !== null;
}

/** Shown when the current browser cannot reach WebMCP. */
export const ENABLE_HINT =
  "WebMCP is not enabled in this browser. Use the ChatGPT desktop app's built-in " +
  "browser, or Chrome 149+ with chrome://flags/#enable-webmcp-testing.";

/* ---------------------------------------------------------- normalization */

/**
 * Chrome 151 returns `inputSchema` as a JSON STRING, while the specification
 * types it as an object. Accept both and never throw on a malformed schema:
 * a site with a broken schema should degrade to "no parameters", not crash
 * the wearer's session.
 */
export function normalizeSchema(raw: unknown): JsonSchema | null {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as JsonSchema;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as JsonSchema)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Annotations are partially implemented (WPT 1/4), so default conservatively. */
function normalizeAnnotations(raw: RegisteredToolLike["annotations"]) {
  return {
    readOnlyHint: raw?.readOnlyHint === true,
    untrustedContentHint: raw?.untrustedContentHint === true,
  };
}

/**
 * A blank title is an ABSENT title.
 *
 * Chrome returns `title: ""` for a tool registered without one rather than
 * omitting the field, verified against 151.0.7922.174 on 2026-08-26 by
 * registering a tool with no title at all. Anything downstream reaching for
 * `title ?? name` then gets the empty string, because `??` only catches null
 * and undefined, and renders nothing where a name should be. `label()` in
 * @dusky/frames already guarded against this; the console did not, and showed
 * a nameless row. Normalizing here keeps the knowledge in the one file that is
 * allowed to hold it.
 */
function normalizeTitle(raw: unknown): string | undefined {
  const t = typeof raw === "string" ? raw.trim() : "";
  return t === "" ? undefined : t;
}

function toDescriptor(t: RegisteredToolLike): ToolDescriptor {
  const title = normalizeTitle(t.title);
  return {
    name: t.name,
    ...(title !== undefined ? { title } : {}),
    description: t.description ?? "",
    origin: t.origin,
    inputSchema: normalizeSchema(t.inputSchema),
    annotations: normalizeAnnotations(t.annotations),
  };
}

function descriptorKey(tool: ToolDescriptor): string {
  return JSON.stringify({
    origin: tool.origin,
    name: tool.name,
    title: tool.title ?? null,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  });
}

/** Stable enough to notice a registry change without retaining live handles. */
function registrySignature(raw: RegisteredToolLike[], origins: readonly string[]): string {
  return JSON.stringify(
    raw
      .filter((tool) => origins.includes(tool.origin) && !isCallingDocumentProbe(tool))
      .map(toDescriptor)
      .sort((a, b) => `${a.origin}\u0000${a.name}`.localeCompare(`${b.origin}\u0000${b.name}`)),
  );
}

/* ----------------------------------------------------------------- client */

export class WebMcpBridge {
  /** Keeps the live handles that executeTool needs, keyed by origin + name. */
  private live = new Map<string, RegisteredToolLike>();

  /** Last registry returned by discovery, also the eventless-browser baseline. */
  private knownRegistry: string | null = null;

  /**
   * Which argument shape this browser actually accepts.
   *
   * The spec takes an object; Chrome wants a JSON string. We find out by
   * trying, but we find out ONCE. Retrying on every call was two bugs at
   * the same time.
   *
   * The first is cost: the in-browser leg of every invocation was paid twice,
   * because the spec-shaped attempt is guaranteed to fail on today's Chrome.
   *
   * The second is worse, and it broke rule 5. The retry fired on
   * `message.includes("Failed to parse input")`, and that message is written
   * by the SITE, on the failure path, after it has already run. A hostile
   * `pay_now` could charge the card, throw "Failed to parse input arguments",
   * and be invoked a second time by us. A tool that is not read-only must
   * never be auto-retried, and this was auto-retrying everything.
   *
   * One probe per document settles it. After that no call ever repeats.
   */
  private argShape: "unknown" | "object" | "string" = "unknown";

  /** Shared by concurrent first calls so the compatibility probe runs once. */
  private argShapeProbe: Promise<"object" | "string"> | null = null;

  constructor(private readonly origins: string[]) {}

  private key(origin: string, name: string): string {
    return `${origin} ${name}`;
  }

  /**
   * Discover tools exposed to this document.
   *
   * A site must name our origin in `exposedTo`, and the embedding frame must
   * carry allow="tools". If either is missing the browser returns nothing,
   * which is the correct and intended outcome, not an error to work around.
   */
  async discover(): Promise<ToolDescriptor[]> {
    const mc = ctx();
    if (!mc) throw new Error(ENABLE_HINT);
    const raw = await mc.getTools({ fromOrigins: this.origins });
    this.knownRegistry = registrySignature(raw, this.origins);
    this.live.clear();
    const out: ToolDescriptor[] = [];
    for (const t of raw) {
      // Chrome 151 returns THIS DOCUMENT's own registered tools even when
      // fromOrigins names only other origins, verified 2026-08-26 against
      // 151.0.7922.174. Once Dusky registered tools of its own, an unfiltered
      // getTools put "Send task to display" on the wearer's menu as though
      // the shop had offered it. We asked for specific origins, so we accept
      // answers only from those origins. Re-check when Chrome fixes this;
      // the filter is correct either way and should stay.
      if (!this.origins.includes(t.origin) || isCallingDocumentProbe(t)) continue;
      this.live.set(this.key(t.origin, t.name), t);
      out.push(toDescriptor(t));
    }
    return out;
  }

  /**
   * Settle the browser's input shape against a temporary read-only local tool.
   *
   * Compatibility detection must never use the provider tool as the probe. A
   * provider may complete a side effect and then throw any error string it
   * likes. Retrying that provider based on its message would turn one request
   * into two executions. This tool has no side effect and is removed as soon
   * as the browser shape is known.
   */
  private async probeArgumentShape(mc: ModelContextLike): Promise<"object" | "string"> {
    const name = `${ARGUMENT_PROBE_PREFIX}${++argumentProbeSequence}`;
    const owner = globalThis.window;
    const names = argumentProbeNames.get(owner) ?? new Set<string>();
    names.add(name);
    argumentProbeNames.set(owner, names);
    const lifetime = new AbortController();
    try {
      await mc.registerTool(
        {
          name,
          description: "Checks the local browser WebMCP argument format.",
          inputSchema: { type: "object", properties: {} },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute: async () => "{}",
        },
        { signal: lifetime.signal },
      );
      const registered = await mc.getTools();
      // Any provider may publish the same name, and browser order is not ours.
      // Only the handle owned by this calling document is the harmless probe.
      const handle = registered.find((tool) => tool.name === name && tool.window === owner);
      if (!handle) throw new Error("could not discover the local WebMCP argument probe");

      try {
        await mc.executeTool(handle, {});
        return "object";
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("Failed to parse input")) throw err;
        await mc.executeTool(handle, JSON.stringify({}) as unknown);
        return "string";
      }
    } finally {
      lifetime.abort();
      names.delete(name);
      if (names.size === 0) argumentProbeNames.delete(owner);
    }
  }

  private async argumentShape(mc: ModelContextLike): Promise<"object" | "string"> {
    if (this.argShape !== "unknown") return this.argShape;
    this.argShapeProbe ??= this.probeArgumentShape(mc);
    try {
      this.argShape = await this.argShapeProbe;
      return this.argShape;
    } finally {
      this.argShapeProbe = null;
    }
  }

  /** Fires whenever a page adds or removes tools, so we never poll. */
  onToolsChanged(cb: () => void): () => void {
    const mc = ctx();
    if (!mc) return () => {};
    const handler: EventListener = () => cb();

    // The current specification makes ModelContext an EventTarget. Prefer it
    // when the browser implements it, including on non-extensible host objects.
    if (mc.addEventListener && mc.removeEventListener) {
      mc.addEventListener("toolchange", handler);
      return () => mc.removeEventListener?.("toolchange", handler);
    }

    // Chrome 151 exposes the event handler attribute but not EventTarget.
    if ("ontoolchange" in mc) {
      const previous = mc.ontoolchange ?? null;
      mc.ontoolchange = handler;
      return () => {
        if (mc.ontoolchange === handler) mc.ontoolchange = previous;
      };
    }

    /*
     * The Codex in-app browser's WebMCP bridge, measured 2026-08-30, exposes a
     * non-extensible object with discovery and execution but no toolchange
     * event surface. Assignment crashes the whole React tree, while doing
     * nothing loses tools that register after the first discovery. Only that
     * incomplete implementation gets this compatibility poll. A descriptor
     * signature prevents unchanged scans from resetting the wearer's frame.
     */
    let disposed = false;
    let unchangedScans = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (disposed) return;
      const delay =
        unchangedScans < COMPATIBILITY_SCAN_FAST_COUNT
          ? COMPATIBILITY_SCAN_FAST_MS
          : COMPATIBILITY_SCAN_SLOW_MS;
      timer = setTimeout(() => void scan(), delay);
    };
    const scan = async () => {
      if (disposed) return;
      try {
        const raw = await mc.getTools({ fromOrigins: this.origins });
        const next = registrySignature(raw, this.origins);
        if (this.knownRegistry === null) {
          this.knownRegistry = next;
          unchangedScans += 1;
        } else if (next !== this.knownRegistry) {
          this.knownRegistry = next;
          unchangedScans = 0;
          cb();
        } else unchangedScans += 1;
      } catch {
        // Discovery itself owns error reporting. A background compatibility
        // check must never crash the page or replace that result.
      } finally {
        schedule();
      }
    };
    void scan();
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }

  /**
   * Invoke a tool and return its raw JSON string result.
   *
   * Two deviations from the current spec are handled here:
   *
   * 1. The spec accepted an object as of commit #246 (2026-08-17), but
   *    Chrome 151 still requires a JSON string. A temporary local read-only
   *    tool settles the shape before any provider is invoked. The provider is
   *    then called exactly once.
   *
   * 2. AbortSignal cancellation is unreliable (WPT executeTool-abort 0/5,
   *    executeTool-signal-cross-origin 0/2). We still pass the signal so we
   *    benefit when it lands, but the caller MUST enforce its own timeout and
   *    treat the result as possibly-arrived. Never assume a cancel worked.
   */
  async invoke(
    origin: string,
    name: string,
    args: Record<string, unknown>,
    expectedTool?: ToolDescriptor,
    signal?: AbortSignal,
    onLifecycle?: WebMcpInvokeLifecycle,
  ): Promise<string> {
    const mc = ctx();
    if (!mc) throw new Error(ENABLE_HINT);
    const handle = this.live.get(this.key(origin, name));
    if (!handle) throw new Error(`tool not currently exposed: ${name} from ${origin}`);
    if (expectedTool && descriptorKey(toDescriptor(handle)) !== descriptorKey(expectedTool)) {
      throw new Error("The provider changed this tool after it was shown.");
    }

    const opts = signal ? { signal } : undefined;

    const shape = await this.argumentShape(mc);
    // A timeout can land while the harmless compatibility probe is running.
    // Do not begin a provider call after the caller has already withdrawn it.
    if (signal?.aborted) {
      const error = new Error("Invocation was cancelled before provider execution.");
      error.name = "AbortError";
      throw error;
    }
    // Nothing asynchronous may sit between this evidence and executeTool. This
    // is the first point at which saying the provider was hit is truthful.
    onLifecycle?.({ kind: "executing", tool: { origin, name } });
    if (shape === "string") {
      return await mc.executeTool(handle, JSON.stringify(args) as unknown, opts);
    }
    return await mc.executeTool(handle, args, opts);
  }
}

/**
 * Wrap a promise with a deadline we control, because the protocol's own
 * cancellation cannot be trusted yet. Resolving the race does NOT stop the
 * underlying tool, so callers must treat a timeout as "unknown", never as
 * "did not happen".
 */
export async function withDeadline<T>(
  p: Promise<T>,
  ms: number,
): Promise<{ ok: true; value: T } | { ok: false; reason: "timeout" }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ ok: false; reason: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), ms);
  });
  try {
    return await Promise.race([p.then((value) => ({ ok: true as const, value })), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/* --------------------------------------------------------------- provider */

/** A tool this document offers to agents. Mirrors ModelContextTool. */
export interface ProvidedTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: JsonSchema;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  /**
   * Returns the tool's result. Return a JSON string for anything structured:
   * `executeTool` resolves to a DOMString, so structure is conveyed as JSON.
   */
  execute: (input: Record<string, unknown>, options: { signal: AbortSignal }) => Promise<unknown>;
}

export interface RegisterOptions {
  /**
   * Origins allowed to see these tools, beyond the built-in browser agent.
   *
   * Omitting this is the correct default for a site that only wants ChatGPT or
   * Chrome's own agent to act. Naming an origin is an explicit grant to a
   * specific third party, and it is the ONLY way a page like Dusky can consume
   * another site's tools.
   */
  exposedTo?: string[];
  /**
   * Caller-owned lifetime. Create this SYNCHRONOUSLY at the call site.
   *
   * Registration is async, and a caller that only aborts once the promise
   * resolves has a window where a second registration pass collides with the
   * first. React 19 StrictMode double-invokes effects in development and hits
   * that window every time, producing "Duplicate tool name" and, worse, a
   * late disposer that unregisters the surviving tools.
   */
  signal?: AbortSignal;
}

/**
 * Register a set of tools and return a disposer.
 *
 * There is no `unregisterTool` in the specification (removed 2026-03-27);
 * unregistration happens by aborting the signal passed at registration time,
 * which is what the returned disposer does.
 */
export async function registerTools(
  tools: ProvidedTool[],
  options: RegisterOptions = {},
): Promise<() => void> {
  const mc = ctx();
  if (!mc) throw new Error(ENABLE_HINT);

  const controller = new AbortController();
  const external = options.signal;
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", () => controller.abort(), { once: true });
  }

  for (const t of tools) {
    // Bail the moment the caller loses interest, so an aborted pass cannot
    // keep registering names that a later pass is about to claim.
    if (controller.signal.aborted) return () => controller.abort();
    await mc.registerTool(
      {
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: {
          readOnlyHint: t.annotations?.readOnlyHint === true,
          untrustedContentHint: t.annotations?.untrustedContentHint === true,
        },
        execute: t.execute,
      },
      {
        ...(options.exposedTo ? { exposedTo: options.exposedTo } : {}),
        signal: controller.signal,
      },
    );
  }
  return () => controller.abort();
}
