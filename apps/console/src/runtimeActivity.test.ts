import type {
  RuntimeToolRef,
  SessionActivityEvent,
  SessionActivitySnapshot,
} from "@dusky/contracts";
import { describe, expect, it } from "vitest";
import {
  createRuntimeActivityState,
  runtimeActivityReducer,
  sameRuntimeToolRef,
  selectActiveRuntimeInvocation,
  selectRuntimeInvocation,
  selectRuntimeInvocationForTool,
  selectRuntimeInvocations,
  selectRuntimeProviderHit,
} from "./runtimeActivity.js";

const marketSearch = tool("https://market.example", "search");
const dispatchSearch = tool("https://dispatch.example", "search");

function tool(origin: string, name: string): RuntimeToolRef {
  return { origin, name };
}

function snapshot(
  revision: number,
  overrides: Partial<SessionActivitySnapshot> = {},
): SessionActivitySnapshot {
  return {
    revision,
    displayConnected: true,
    frameId: `frame-${revision}`,
    frameKind: "idle",
    phase: "idle",
    ...overrides,
  };
}

function reduce(
  state: ReturnType<typeof createRuntimeActivityState>,
  ...actions: Parameters<typeof runtimeActivityReducer>[1][]
) {
  return actions.reduce(runtimeActivityReducer, state);
}

describe("runtime activity reducer", () => {
  it("hydrates a newer snapshot without replaying a transient cue", () => {
    const initial = createRuntimeActivityState("ABCDEF");
    const hydrated = runtimeActivityReducer(initial, {
      type: "relaySnapshot",
      snapshot: snapshot(4, {
        frameKind: "confirm",
        phase: "approval",
        tool: marketSearch,
      }),
    });

    expect(hydrated.revision).toBe(4);
    expect(hydrated.session).toMatchObject({
      frameKind: "confirm",
      phase: "approval",
      tool: marketSearch,
    });
    expect(hydrated.cueSequence).toBe(0);
    expect(hydrated.cue).toBeNull();
  });

  it("accepts strictly increasing relay revisions and never replays a snapshot", () => {
    const event: SessionActivityEvent = {
      kind: "display_input",
      revision: 5,
      frameId: "frame-4",
      input: "choice",
    };
    const afterEvent = reduce(
      createRuntimeActivityState("ABCDEF"),
      {
        type: "relaySnapshot",
        snapshot: snapshot(4, { tool: marketSearch }),
      },
      { type: "relayEvent", event },
    );

    expect(afterEvent.cue).toMatchObject({
      sequence: 1,
      kind: "display-input",
      direction: "display-to-runtime",
      tool: marketSearch,
    });

    const duplicate = runtimeActivityReducer(afterEvent, { type: "relayEvent", event });
    const sameRevisionSnapshot = runtimeActivityReducer(afterEvent, {
      type: "relaySnapshot",
      snapshot: snapshot(5, { phase: "error" }),
    });
    expect(duplicate).toBe(afterEvent);
    expect(sameRevisionSnapshot).toBe(afterEvent);

    const hydrated = runtimeActivityReducer(afterEvent, {
      type: "relaySnapshot",
      snapshot: snapshot(6, { phase: "parameters", frameKind: "choose" }),
    });
    expect(hydrated.revision).toBe(6);
    expect(hydrated.session.phase).toBe("parameters");
    expect(hydrated.cue).toBe(afterEvent.cue);
    expect(hydrated.cueSequence).toBe(1);

    const stale = runtimeActivityReducer(hydrated, {
      type: "relayEvent",
      event: { ...event, revision: 3 },
    });
    expect(stale).toBe(hydrated);
  });

  it("directs relay frame cues toward the Display and preserves exact tool identity", () => {
    const state = runtimeActivityReducer(createRuntimeActivityState("ABCDEF"), {
      type: "relayEvent",
      event: {
        kind: "frame",
        revision: 1,
        frameId: "working-1",
        frameKind: "working",
        phase: "invoking",
        tool: dispatchSearch,
        task: { current: 1, total: 2 },
      },
    });

    expect(state.session).toMatchObject({
      frameId: "working-1",
      phase: "invoking",
      tool: dispatchSearch,
      task: { current: 1, total: 2 },
    });
    expect(state.cue).toMatchObject({
      kind: "display-frame",
      direction: "runtime-to-display",
      tool: dispatchSearch,
    });
  });

  it("keys browser lifecycle state by request while matching tools by origin and name", () => {
    const state = reduce(
      createRuntimeActivityState("ABCDEF"),
      {
        type: "bridgeInvocation",
        requestId: "request-market",
        tool: marketSearch,
        stage: "executing",
      },
      {
        type: "bridgeInvocation",
        requestId: "request-dispatch",
        tool: dispatchSearch,
        stage: "executing",
      },
    );

    expect(state.invocations).toBeInstanceOf(Map);
    expect(state.invocations.size).toBe(2);
    expect(selectRuntimeInvocationForTool(state, marketSearch)?.requestId).toBe("request-market");
    expect(selectRuntimeInvocationForTool(state, dispatchSearch)?.requestId).toBe(
      "request-dispatch",
    );
    expect(sameRuntimeToolRef(marketSearch, dispatchSearch)).toBe(false);
  });

  it("emits one outbound cue at execution and one return cue when the provider settles", () => {
    const running = runtimeActivityReducer(createRuntimeActivityState("ABCDEF"), {
      type: "bridgeInvocation",
      requestId: "request-1",
      tool: marketSearch,
      stage: "executing",
    });
    expect(running.cue).toEqual({
      sequence: 1,
      kind: "invocation-start",
      direction: "runtime-to-provider",
      requestId: "request-1",
      tool: marketSearch,
    });

    const returned = runtimeActivityReducer(running, {
      type: "bridgeInvocation",
      requestId: "request-1",
      tool: marketSearch,
      stage: "returned",
    });
    expect(selectRuntimeInvocation(returned, "request-1")?.status).toBe("returned");
    expect(selectRuntimeProviderHit(returned, "request-1")).toBe(true);
    expect(returned.cue).toEqual({
      sequence: 2,
      kind: "invocation-return",
      direction: "provider-to-runtime",
      requestId: "request-1",
      tool: marketSearch,
    });
  });

  it("persists the session-owned outcome when a later tool becomes current", () => {
    const settled = reduce(
      createRuntimeActivityState("ABCDEF"),
      {
        type: "bridgeInvocation",
        requestId: "request-market",
        tool: marketSearch,
        stage: "executing",
      },
      {
        type: "bridgeInvocation",
        requestId: "request-market",
        tool: marketSearch,
        stage: "returned",
      },
      {
        type: "relayEvent",
        event: {
          kind: "frame",
          revision: 1,
          frameId: "result-market",
          frameKind: "result",
          phase: "result",
          tool: marketSearch,
          outcome: "succeeded",
        },
      },
      {
        type: "bridgeInvocation",
        requestId: "request-dispatch",
        tool: dispatchSearch,
        stage: "executing",
      },
      {
        type: "relayEvent",
        event: {
          kind: "frame",
          revision: 2,
          frameId: "working-dispatch",
          frameKind: "working",
          phase: "invoking",
          tool: dispatchSearch,
        },
      },
    );

    expect(selectRuntimeInvocation(settled, "request-market")?.outcome).toBe("succeeded");
    expect(settled.session.tool).toEqual(dispatchSearch);
  });

  it("distinguishes a preflight refusal from a failure after provider execution", () => {
    const preflightFailure = runtimeActivityReducer(createRuntimeActivityState("ABCDEF"), {
      type: "bridgeInvocation",
      requestId: "preflight",
      tool: marketSearch,
      stage: "failed",
    });
    expect(selectRuntimeInvocation(preflightFailure, "preflight")).toMatchObject({
      status: "failed",
      providerHit: false,
    });
    expect(selectRuntimeProviderHit(preflightFailure, "preflight")).toBe(false);
    expect(preflightFailure.cue?.direction).toBe("none");

    const providerFailure = reduce(
      createRuntimeActivityState("ABCDEF"),
      {
        type: "bridgeInvocation",
        requestId: "provider",
        tool: marketSearch,
        stage: "executing",
      },
      {
        type: "bridgeInvocation",
        requestId: "provider",
        tool: marketSearch,
        stage: "failed",
      },
    );
    expect(selectRuntimeInvocation(providerFailure, "provider")).toMatchObject({
      status: "failed",
      providerHit: true,
    });
    expect(selectRuntimeProviderHit(providerFailure, "provider")).toBe(true);
    expect(providerFailure.cue?.direction).toBe("provider-to-runtime");
  });

  it("pins a request to its first exact tool reference", () => {
    const running = runtimeActivityReducer(createRuntimeActivityState("ABCDEF"), {
      type: "bridgeInvocation",
      requestId: "request-1",
      tool: marketSearch,
      stage: "executing",
    });
    const wrongOrigin = runtimeActivityReducer(running, {
      type: "bridgeInvocation",
      requestId: "request-1",
      tool: dispatchSearch,
      stage: "returned",
    });

    expect(wrongOrigin).toBe(running);
    expect(selectRuntimeInvocation(wrongOrigin, "request-1")).toMatchObject({
      tool: marketSearch,
      status: "running",
    });
  });

  it.each(["returned", "failed", "unknown"] as const)(
    "keeps %s terminal when late lifecycle events arrive",
    (terminal) => {
      const settled = reduce(
        createRuntimeActivityState("ABCDEF"),
        {
          type: "bridgeInvocation",
          requestId: "request-1",
          tool: marketSearch,
          stage: "executing",
        },
        {
          type: "bridgeInvocation",
          requestId: "request-1",
          tool: marketSearch,
          stage: terminal,
        },
      );

      for (const stage of ["executing", "returned", "failed", "unknown"] as const) {
        const late = runtimeActivityReducer(settled, {
          type: "bridgeInvocation",
          requestId: "request-1",
          tool: marketSearch,
          stage,
        });
        expect(late).toBe(settled);
      }
      expect(selectRuntimeInvocation(settled, "request-1")?.status).toBe(terminal);
    },
  );

  it("turns only running requests unknown when the console disconnects", () => {
    const beforeDisconnect = reduce(
      createRuntimeActivityState("ABCDEF"),
      {
        type: "bridgeInvocation",
        requestId: "running-a",
        tool: marketSearch,
        stage: "executing",
      },
      {
        type: "bridgeInvocation",
        requestId: "returned",
        tool: dispatchSearch,
        stage: "returned",
      },
      {
        type: "bridgeInvocation",
        requestId: "running-b",
        tool: dispatchSearch,
        stage: "executing",
      },
    );

    const disconnected = runtimeActivityReducer(beforeDisconnect, { type: "disconnect" });
    expect(selectRuntimeInvocation(disconnected, "running-a")?.status).toBe("unknown");
    expect(selectRuntimeInvocation(disconnected, "running-b")?.status).toBe("unknown");
    expect(selectRuntimeInvocation(disconnected, "returned")?.status).toBe("returned");
    expect(disconnected.cue).toEqual({
      sequence: beforeDisconnect.cueSequence + 1,
      kind: "connection-lost",
      direction: "none",
    });

    const repeated = runtimeActivityReducer(disconnected, { type: "disconnect" });
    expect(repeated).toBe(disconnected);
  });

  it("clears revisions, requests, and transient cues when the session is replaced", () => {
    const active = reduce(
      createRuntimeActivityState("ABCDEF"),
      { type: "relaySnapshot", snapshot: snapshot(9) },
      {
        type: "bridgeInvocation",
        requestId: "request-1",
        tool: marketSearch,
        stage: "executing",
      },
    );

    expect(runtimeActivityReducer(active, { type: "replaceSession", sessionId: "ABCDEF" })).toBe(
      active,
    );

    const replacement = runtimeActivityReducer(active, {
      type: "replaceSession",
      sessionId: "UVWXYZ",
    });
    expect(replacement).toEqual(createRuntimeActivityState("UVWXYZ"));
    expect(replacement.invocations).not.toBe(active.invocations);
  });

  it("exports stable log and active-request selectors", () => {
    const state = reduce(
      createRuntimeActivityState("ABCDEF"),
      {
        type: "bridgeInvocation",
        requestId: "older-running",
        tool: marketSearch,
        stage: "executing",
      },
      {
        type: "bridgeInvocation",
        requestId: "newer-settled",
        tool: dispatchSearch,
        stage: "returned",
      },
    );

    expect(selectRuntimeInvocations(state).map((item) => item.requestId)).toEqual([
      "older-running",
      "newer-settled",
    ]);
    expect(selectActiveRuntimeInvocation(state)?.requestId).toBe("older-running");
  });
});
