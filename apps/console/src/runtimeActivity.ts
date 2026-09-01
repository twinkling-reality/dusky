import type {
  DisplayFrame,
  RuntimeToolRef,
  SessionActivityEvent,
  SessionActivitySnapshot,
  SessionOutcome,
  SessionPhase,
  SessionTaskRef,
} from "@dusky/contracts";

/**
 * Browser-observed provider execution state.
 *
 * `returned` deliberately does not mean semantic success. The relay owns that
 * decision and reports it separately through `SessionOutcome`.
 */
export type RuntimeInvocationStatus = "running" | "returned" | "failed" | "unknown";

export interface RuntimeInvocation {
  requestId: string;
  tool: RuntimeToolRef;
  status: RuntimeInvocationStatus;
  /** Session-owned semantic outcome, retained after later actions begin. */
  outcome: SessionOutcome | null;
  /** True only once the bridge reached its immediate pre-execute boundary. */
  providerHit: boolean;
  /** Local ordering only; no wall clock is needed by this pure reducer. */
  sequence: number;
}

/** The latest relay-owned, non-sensitive view of the paired session. */
export interface RuntimeSessionActivity {
  displayConnected: boolean | null;
  frameId: string | null;
  frameKind: DisplayFrame["kind"] | null;
  phase: SessionPhase | null;
  tool: RuntimeToolRef | null;
  task: SessionTaskRef | null;
  outcome: SessionOutcome | null;
}

export type RuntimeCueDirection =
  | "none"
  | "display-to-runtime"
  | "runtime-to-display"
  | "runtime-to-provider"
  | "provider-to-runtime";

export type RuntimeCueKind =
  | "display-presence"
  | "display-input"
  | "display-frame"
  | "invocation-start"
  | "invocation-return"
  | "invocation-failure"
  | "invocation-unknown"
  | "connection-lost";

/**
 * One bounded animation instruction. Consumers key on `sequence`; persistent
 * truth remains in `session` and `invocations` after the cue has played.
 */
export interface RuntimeVisualCue {
  sequence: number;
  kind: RuntimeCueKind;
  direction: RuntimeCueDirection;
  requestId?: string;
  tool?: RuntimeToolRef;
}

export interface RuntimeActivityState {
  /** Activity messages contain no session id, so the owner scopes them here. */
  sessionId: string | null;
  /** Highest relay revision accepted for this session. */
  revision: number;
  session: RuntimeSessionActivity;
  /** Browser invocations are correlated only by the relay request id. */
  invocations: Map<string, RuntimeInvocation>;
  /** Monotonic local ordering for invocation rows. */
  invocationSequence: number;
  /** Monotonic key for bounded visual effects. */
  cueSequence: number;
  cue: RuntimeVisualCue | null;
}

export type BridgeInvocationStage = "executing" | "returned" | "failed" | "unknown";

export type RuntimeActivityAction =
  | { type: "replaceSession"; sessionId: string | null }
  | { type: "relaySnapshot"; snapshot: SessionActivitySnapshot }
  | { type: "relayEvent"; event: SessionActivityEvent }
  | {
      type: "bridgeInvocation";
      requestId: string;
      tool: RuntimeToolRef;
      stage: BridgeInvocationStage;
    }
  | { type: "disconnect" };

const EMPTY_SESSION: RuntimeSessionActivity = {
  displayConnected: null,
  frameId: null,
  frameKind: null,
  phase: null,
  tool: null,
  task: null,
  outcome: null,
};

export function createRuntimeActivityState(sessionId: string | null = null): RuntimeActivityState {
  return {
    sessionId,
    revision: -1,
    session: { ...EMPTY_SESSION },
    invocations: new Map(),
    invocationSequence: 0,
    cueSequence: 0,
    cue: null,
  };
}

export function runtimeActivityReducer(
  state: RuntimeActivityState,
  action: RuntimeActivityAction,
): RuntimeActivityState {
  switch (action.type) {
    case "replaceSession":
      return action.sessionId === state.sessionId
        ? state
        : createRuntimeActivityState(action.sessionId);
    case "relaySnapshot":
      return reduceRelaySnapshot(state, action.snapshot);
    case "relayEvent":
      return reduceRelayEvent(state, action.event);
    case "bridgeInvocation":
      return reduceBridgeInvocation(state, action);
    case "disconnect":
      return reduceDisconnect(state);
  }
}

function reduceRelaySnapshot(
  state: RuntimeActivityState,
  snapshot: SessionActivitySnapshot,
): RuntimeActivityState {
  if (!canAcceptRelayRevision(state, snapshot.revision)) return state;

  // Hydration updates persistent truth only. Replaying animation after attach
  // or reconnect would make old activity look as though it just happened.
  return {
    ...state,
    revision: snapshot.revision,
    session: sessionFromSnapshot(snapshot),
  };
}

function reduceRelayEvent(
  state: RuntimeActivityState,
  event: SessionActivityEvent,
): RuntimeActivityState {
  if (!canAcceptRelayRevision(state, event.revision)) return state;

  if (event.kind === "display_presence") {
    return withCue(
      {
        ...state,
        revision: event.revision,
        session: { ...state.session, displayConnected: event.connected },
      },
      { kind: "display-presence", direction: "none" },
    );
  }

  if (event.kind === "display_input") {
    return withCue(
      { ...state, revision: event.revision },
      {
        kind: "display-input",
        direction: "display-to-runtime",
        ...(state.session.tool ? { tool: state.session.tool } : {}),
      },
    );
  }

  const withSession = {
    ...state,
    revision: event.revision,
    session: {
      ...state.session,
      frameId: event.frameId,
      frameKind: event.frameKind,
      phase: event.phase,
      tool: event.tool ?? null,
      task: event.task ?? null,
      outcome: event.outcome ?? null,
    },
  };
  const persisted =
    event.tool && event.outcome
      ? persistInvocationOutcome(withSession, event.tool, event.outcome)
      : withSession;
  return withCue(persisted, {
    kind: "display-frame",
    direction: "runtime-to-display",
    ...(event.tool ? { tool: event.tool } : {}),
  });
}

function reduceBridgeInvocation(
  state: RuntimeActivityState,
  action: Extract<RuntimeActivityAction, { type: "bridgeInvocation" }>,
): RuntimeActivityState {
  if (state.sessionId === null || action.requestId.length === 0) return state;

  const current = state.invocations.get(action.requestId);
  if (current && !sameRuntimeToolRef(current.tool, action.tool)) return state;

  const nextStatus = statusForStage(action.stage);
  if (current?.status === nextStatus || (current && isTerminal(current.status))) return state;

  const invocationSequence = state.invocationSequence + 1;
  const invocations = new Map(state.invocations);
  invocations.set(action.requestId, {
    requestId: action.requestId,
    tool: copyTool(action.tool),
    status: nextStatus,
    outcome: current?.outcome ?? null,
    providerHit: current?.providerHit === true || action.stage === "executing",
    sequence: invocationSequence,
  });

  const hadProviderExecution = current?.status === "running";
  return withCue(
    { ...state, invocations, invocationSequence },
    cueForInvocation(action, hadProviderExecution),
  );
}

function persistInvocationOutcome(
  state: RuntimeActivityState,
  tool: RuntimeToolRef,
  outcome: SessionOutcome,
): RuntimeActivityState {
  const invocation = selectRuntimeInvocationForTool(state, tool);
  if (!invocation || invocation.outcome === outcome) return state;
  const invocations = new Map(state.invocations);
  invocations.set(invocation.requestId, { ...invocation, outcome });
  return { ...state, invocations };
}

function reduceDisconnect(state: RuntimeActivityState): RuntimeActivityState {
  let invocations: Map<string, RuntimeInvocation> | null = null;
  let invocationSequence = state.invocationSequence;

  for (const [requestId, invocation] of state.invocations) {
    if (invocation.status !== "running") continue;
    invocations ??= new Map(state.invocations);
    invocationSequence += 1;
    invocations.set(requestId, {
      ...invocation,
      status: "unknown",
      sequence: invocationSequence,
    });
  }

  if (!invocations) return state;
  return withCue(
    { ...state, invocations, invocationSequence },
    { kind: "connection-lost", direction: "none" },
  );
}

function canAcceptRelayRevision(state: RuntimeActivityState, revision: number): boolean {
  return (
    state.sessionId !== null &&
    Number.isSafeInteger(revision) &&
    revision >= 0 &&
    revision > state.revision
  );
}

function withCue(
  state: RuntimeActivityState,
  cue: Omit<RuntimeVisualCue, "sequence">,
): RuntimeActivityState {
  const sequence = state.cueSequence + 1;
  return { ...state, cueSequence: sequence, cue: { ...cue, sequence } };
}

function cueForInvocation(
  action: Extract<RuntimeActivityAction, { type: "bridgeInvocation" }>,
  hadProviderExecution: boolean,
): Omit<RuntimeVisualCue, "sequence"> {
  const common = { requestId: action.requestId, tool: copyTool(action.tool) };
  switch (action.stage) {
    case "executing":
      return {
        ...common,
        kind: "invocation-start",
        direction: "runtime-to-provider",
      };
    case "returned":
      return {
        ...common,
        kind: "invocation-return",
        direction: "provider-to-runtime",
      };
    case "failed":
      return {
        ...common,
        kind: "invocation-failure",
        // A pre-execution bridge refusal did not travel to the provider.
        direction: hadProviderExecution ? "provider-to-runtime" : "none",
      };
    case "unknown":
      return { ...common, kind: "invocation-unknown", direction: "none" };
  }
}

function statusForStage(stage: BridgeInvocationStage): RuntimeInvocationStatus {
  return stage === "executing" ? "running" : stage;
}

function isTerminal(status: RuntimeInvocationStatus): boolean {
  return status !== "running";
}

function sessionFromSnapshot(snapshot: SessionActivitySnapshot): RuntimeSessionActivity {
  return {
    displayConnected: snapshot.displayConnected,
    frameId: snapshot.frameId,
    frameKind: snapshot.frameKind,
    phase: snapshot.phase,
    tool: snapshot.tool ? copyTool(snapshot.tool) : null,
    task: snapshot.task ? { ...snapshot.task } : null,
    outcome: snapshot.outcome ?? null,
  };
}

function copyTool(tool: RuntimeToolRef): RuntimeToolRef {
  return { origin: tool.origin, name: tool.name };
}

export function sameRuntimeToolRef(
  left: RuntimeToolRef | null | undefined,
  right: RuntimeToolRef | null | undefined,
): boolean {
  return (
    left !== null &&
    left !== undefined &&
    right !== null &&
    right !== undefined &&
    left.origin === right.origin &&
    left.name === right.name
  );
}

export function selectRuntimeSessionActivity(state: RuntimeActivityState): RuntimeSessionActivity {
  return state.session;
}

export function selectRuntimeInvocation(
  state: RuntimeActivityState,
  requestId: string,
): RuntimeInvocation | null {
  return state.invocations.get(requestId) ?? null;
}

/** Whether this exact request crossed the provider execution boundary. */
export function selectRuntimeProviderHit(state: RuntimeActivityState, requestId: string): boolean {
  return state.invocations.get(requestId)?.providerHit === true;
}

/** Ordered oldest to newest for a stable execution log. */
export function selectRuntimeInvocations(state: RuntimeActivityState): RuntimeInvocation[] {
  return [...state.invocations.values()].sort((a, b) => a.sequence - b.sequence);
}

/** Latest running request, falling back to the latest settled request. */
export function selectActiveRuntimeInvocation(
  state: RuntimeActivityState,
): RuntimeInvocation | null {
  let latest: RuntimeInvocation | null = null;
  let latestRunning: RuntimeInvocation | null = null;
  for (const invocation of state.invocations.values()) {
    if (!latest || invocation.sequence > latest.sequence) latest = invocation;
    if (
      invocation.status === "running" &&
      (!latestRunning || invocation.sequence > latestRunning.sequence)
    ) {
      latestRunning = invocation;
    }
  }
  return latestRunning ?? latest;
}

/** Latest request for one exact `(origin, name)` identity. */
export function selectRuntimeInvocationForTool(
  state: RuntimeActivityState,
  tool: RuntimeToolRef,
): RuntimeInvocation | null {
  let latest: RuntimeInvocation | null = null;
  for (const invocation of state.invocations.values()) {
    if (!sameRuntimeToolRef(invocation.tool, tool)) continue;
    if (!latest || invocation.sequence > latest.sequence) latest = invocation;
  }
  return latest;
}

export function selectRuntimeVisualCue(state: RuntimeActivityState): RuntimeVisualCue | null {
  return state.cue;
}
