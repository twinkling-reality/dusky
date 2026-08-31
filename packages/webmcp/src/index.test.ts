import { afterEach, describe, expect, it, vi } from "vitest";
import { WebMcpBridge } from "./index.js";

afterEach(() => vi.unstubAllGlobals());

describe("tool registry changes", () => {
  it("listens without adding a property to a non-extensible ModelContext", () => {
    const modelContext = Object.assign(new EventTarget(), {
      registerTool: vi.fn(),
      getTools: vi.fn(),
      executeTool: vi.fn(),
    });
    Object.preventExtensions(modelContext);
    vi.stubGlobal("document", { modelContext });

    const changed = vi.fn();
    const off = new WebMcpBridge([]).onToolsChanged(changed);

    modelContext.dispatchEvent(new Event("toolchange"));
    expect(changed).toHaveBeenCalledOnce();
    expect(Object.hasOwn(modelContext, "ontoolchange")).toBe(false);

    off();
    modelContext.dispatchEvent(new Event("toolchange"));
    expect(changed).toHaveBeenCalledOnce();
  });

  it("watches the registry when a browser exposes no event surface", async () => {
    vi.useFakeTimers();
    const tools: Array<Record<string, unknown>> = [];
    const modelContext = Object.preventExtensions({
      registerTool: vi.fn(),
      getTools: vi.fn(async () => tools),
      executeTool: vi.fn(),
    });
    vi.stubGlobal("document", { modelContext });

    const bridge = new WebMcpBridge(["https://shop.example"]);
    await bridge.discover();
    const changed = vi.fn();
    const off = bridge.onToolsChanged(changed);

    tools.push({
      name: "search_products",
      description: "Search the catalog",
      origin: "https://shop.example",
      window: {},
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(changed).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(changed).toHaveBeenCalledOnce();

    off();
    tools.push({
      name: "review_cart",
      description: "Review the cart",
      origin: "https://shop.example",
      window: {},
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(changed).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
