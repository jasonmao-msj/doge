import type {
  AccountScenarioV1,
  GatewayOperationNameV1,
  GatewayResultV1,
  ScenarioExpectedResultV1,
} from "../contracts";
import {
  ACCOUNT_SCENARIO_MANIFEST_V1,
  validateScenarioManifestV1,
} from "../contracts";

export type ScenarioFaultV1 =
  AccountScenarioV1["schedule"]["faults"][number];

export type ScenarioRuntimeHistoryKindV1 =
  | "reset"
  | "advance"
  | "faultChanged"
  | "operationScheduled"
  | "operationSettled"
  | "operationRejected";

export type ScenarioRuntimeHistoryEntryV1 = {
  readonly sequence: number;
  readonly atMs: number;
  readonly kind: ScenarioRuntimeHistoryKindV1;
  readonly operation: GatewayOperationNameV1 | null;
  readonly detail:
    | "initial"
    | "manual"
    | "matched"
    | "operationMismatch"
    | "unknownScenario"
    | ScenarioExpectedResultV1
    | ScenarioFaultV1
    | "faultCleared";
};

export type ScenarioOperationResolutionV1 = {
  readonly scenarioId: string;
  readonly scenarioEpoch: number;
  readonly actionIndex: number;
  readonly operation: GatewayOperationNameV1;
  readonly result: ScenarioExpectedResultV1;
  readonly terminalTruth: AccountScenarioV1["terminalTruth"];
  readonly fault: ScenarioFaultV1 | null;
  readonly settledAtMs: number;
  readonly isFinalAction: boolean;
};

export type ScenarioRuntimeSnapshotV1 = {
  readonly scenarioId: string;
  readonly seed: number;
  readonly scenarioEpoch: number;
  readonly nowMs: number;
  readonly nowIso: string;
  readonly operationCursor: number;
  readonly operationCount: number;
  readonly pendingCount: number;
  readonly status: "idle" | "running" | "complete" | "failedClosed";
  readonly nextOperation: GatewayOperationNameV1 | null;
  readonly injectedFault: ScenarioFaultV1 | null;
  readonly lastResolution: ScenarioOperationResolutionV1 | null;
  readonly history: readonly ScenarioRuntimeHistoryEntryV1[];
};

type PendingOperationV1 = {
  readonly order: number;
  readonly dueAtMs: number;
  readonly actionIndex: number;
  readonly operation: GatewayOperationNameV1;
  readonly fault: ScenarioFaultV1 | null;
  readonly resolve: (resolution: ScenarioOperationResolutionV1) => void;
};

const VIRTUAL_EPOCH_MS_V1 = Date.parse("2032-04-05T10:00:00.000Z");
const MAX_HISTORY_ENTRIES_V1 = 200;

function scenarioSeedV1(scenarioId: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < scenarioId.length; index += 1) {
    hash ^= scenarioId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function normalizeSeedV1(seed: number): number {
  if (!Number.isSafeInteger(seed)) {
    return 1;
  }
  return (seed >>> 0) || 1;
}

function mismatchResolutionV1(
  scenario: AccountScenarioV1,
  scenarioEpoch: number,
  actionIndex: number,
  operation: GatewayOperationNameV1,
  nowMs: number,
): ScenarioOperationResolutionV1 {
  return {
    scenarioId: scenario.id,
    scenarioEpoch,
    actionIndex,
    operation,
    result: "safeFailure",
    terminalTruth: "rejected",
    fault: "unknownEnum",
    settledAtMs: nowMs,
    isFinalAction: false,
  };
}

function faultTargetIndexV1(
  scenario: AccountScenarioV1,
  fault: ScenarioFaultV1,
): number {
  const operations = scenario.expectedGateway.operations;
  const find = (operation: GatewayOperationNameV1) => operations.indexOf(operation);

  switch (fault) {
    case "concurrentEdit":
    case "rollbackFailure": {
      const applyIndex = find("configuration.apply");
      return applyIndex >= 0 ? applyIndex : Math.max(operations.length - 1, 0);
    }
    case "unsafeTarget": {
      const planIndex = find("configuration.createPlan");
      return planIndex >= 0 ? planIndex : 0;
    }
    case "lostResponse": {
      const reconcileIndex = find("gateway.reconcileIntent");
      return reconcileIndex > 0 ? reconcileIndex - 1 : 0;
    }
    case "metadataFailure":
    case "vaultUnavailable": {
      const mutationIndex = operations.findIndex(
        (operation) =>
          operation.startsWith("auth.") ||
          operation.startsWith("managedKey.") ||
          operation === "configuration.apply",
      );
      return mutationIndex >= 0 ? mutationIndex : 0;
    }
    case "offline":
    case "serviceUnavailable":
    case "unknownEnum":
    case "unsupportedMajor":
    case "missingGuarantee":
      return 0;
  }
}

function resultForActionV1(
  scenario: AccountScenarioV1,
  actionIndex: number,
  fault: ScenarioFaultV1 | null,
): ScenarioExpectedResultV1 {
  if (fault !== null) {
    return fault === "lostResponse" ? "outcomeUnknown" : "safeFailure";
  }
  const isFinalAction =
    actionIndex === scenario.expectedGateway.operations.length - 1;
  if (!isFinalAction) {
    return "nonterminal";
  }
  return scenario.expectedGateway.results.at(-1) ?? "safeFailure";
}

function terminalTruthForResolutionV1(
  scenario: AccountScenarioV1,
  result: ScenarioExpectedResultV1,
  isFinalAction: boolean,
): AccountScenarioV1["terminalTruth"] {
  if (!isFinalAction) {
    return result === "outcomeUnknown" ? "outcomeUnknown" : "nonterminal";
  }
  return scenario.terminalTruth;
}

export class ScenarioRuntimeV1 {
  readonly scenario: AccountScenarioV1;

  private readonly listeners = new Set<() => void>();
  private pending: PendingOperationV1[] = [];
  private history: ScenarioRuntimeHistoryEntryV1[] = [];
  private seed: number;
  private randomState: number;
  private scenarioEpoch = 1;
  private nowMs = 0;
  private operationCursor = 0;
  private pendingOrder = 0;
  private historySequence = 0;
  private injectedFault: ScenarioFaultV1 | null = null;
  private lastResolution: ScenarioOperationResolutionV1 | null = null;
  private snapshot: ScenarioRuntimeSnapshotV1;

  constructor(scenario: AccountScenarioV1, seed = scenarioSeedV1(scenario.id)) {
    this.scenario = scenario;
    this.seed = normalizeSeedV1(seed);
    this.randomState = this.seed;
    this.appendHistory("reset", null, "initial");
    this.snapshot = this.buildSnapshot();
  }

  getSnapshot = (): ScenarioRuntimeSnapshotV1 => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  run(
    operation: GatewayOperationNameV1,
  ): Promise<ScenarioOperationResolutionV1> {
    const actionIndex = this.operationCursor;
    const expectedOperation =
      this.scenario.expectedGateway.operations[actionIndex] ?? null;
    if (expectedOperation !== operation) {
      const resolution = mismatchResolutionV1(
        this.scenario,
        this.scenarioEpoch,
        actionIndex,
        operation,
        this.nowMs,
      );
      this.lastResolution = resolution;
      this.appendHistory(
        "operationRejected",
        operation,
        "operationMismatch",
      );
      this.publish();
      return Promise.resolve(resolution);
    }

    this.operationCursor += 1;
    const manifestFault = this.faultForAction(actionIndex);
    const fault = this.injectedFault ?? manifestFault;
    const latencyMs = this.latencyForAction(actionIndex);
    const promise = new Promise<ScenarioOperationResolutionV1>((resolve) => {
      this.pending.push({
        order: this.pendingOrder,
        dueAtMs: this.nowMs + latencyMs,
        actionIndex,
        operation,
        fault,
        resolve,
      });
      this.pendingOrder += 1;
    });
    this.appendHistory("operationScheduled", operation, fault ?? "matched");
    this.publish();
    this.drainDueOperations();
    return promise;
  }

  runNext(): Promise<ScenarioOperationResolutionV1> {
    const nextOperation =
      this.scenario.expectedGateway.operations[this.operationCursor];
    if (nextOperation === undefined) {
      const fallback = this.scenario.expectedGateway.operations.at(-1) ??
        "gateway.bootstrap";
      const resolution = mismatchResolutionV1(
        this.scenario,
        this.scenarioEpoch,
        this.operationCursor,
        fallback,
        this.nowMs,
      );
      this.lastResolution = resolution;
      this.appendHistory(
        "operationRejected",
        fallback,
        "operationMismatch",
      );
      this.publish();
      return Promise.resolve(resolution);
    }
    return this.run(nextOperation);
  }

  advanceBy(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error("Scenario virtual clock advance must be non-negative");
    }
    this.nowMs += Math.floor(durationMs);
    this.appendHistory("advance", null, "manual");
    this.publish();
    this.drainDueOperations();
  }

  advanceToNext(): void {
    const nextDueAt = this.pending.reduce<number | null>(
      (current, operation) =>
        current === null || operation.dueAtMs < current
          ? operation.dueAtMs
          : current,
      null,
    );
    if (nextDueAt !== null) {
      this.advanceBy(Math.max(0, nextDueAt - this.nowMs));
    }
  }

  setFault(fault: ScenarioFaultV1 | null): void {
    this.injectedFault = fault;
    this.appendHistory(
      "faultChanged",
      null,
      fault ?? "faultCleared",
    );
    this.publish();
  }

  reset(seed = this.seed): void {
    if (this.pending.length > 0) {
      throw new Error(
        "Scenario reset requires pending operations to settle first",
      );
    }
    this.seed = normalizeSeedV1(seed);
    this.randomState = this.seed;
    this.scenarioEpoch += 1;
    this.nowMs = 0;
    this.operationCursor = 0;
    this.pending = [];
    this.pendingOrder = 0;
    this.injectedFault = null;
    this.lastResolution = null;
    this.history = [];
    this.appendHistory("reset", null, "manual");
    this.publish();
  }

  nextSafeToken(prefix: string): string {
    let state = this.randomState;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.randomState = state >>> 0;
    return `${prefix}_${this.randomState.toString(36).padStart(7, "0")}`;
  }

  nowIso(): string {
    return new Date(VIRTUAL_EPOCH_MS_V1 + this.nowMs).toISOString();
  }

  private latencyForAction(actionIndex: number): number {
    return this.scenario.schedule.latencyMs[actionIndex] ?? 0;
  }

  private faultForAction(actionIndex: number): ScenarioFaultV1 | null {
    for (const fault of this.scenario.schedule.faults) {
      if (faultTargetIndexV1(this.scenario, fault) === actionIndex) {
        return fault;
      }
    }
    return null;
  }

  private drainDueOperations(): void {
    const due = this.pending
      .filter((operation) => operation.dueAtMs <= this.nowMs)
      .sort(
        (left, right) =>
          left.dueAtMs - right.dueAtMs || left.order - right.order,
      );
    if (due.length === 0) {
      return;
    }
    const dueOrders = new Set(due.map((operation) => operation.order));
    this.pending = this.pending.filter(
      (operation) => !dueOrders.has(operation.order),
    );
    for (const operation of due) {
      const isFinalAction =
        operation.actionIndex ===
        this.scenario.expectedGateway.operations.length - 1;
      const result = resultForActionV1(
        this.scenario,
        operation.actionIndex,
        operation.fault,
      );
      const resolution: ScenarioOperationResolutionV1 = {
        scenarioId: this.scenario.id,
        scenarioEpoch: this.scenarioEpoch,
        actionIndex: operation.actionIndex,
        operation: operation.operation,
        result,
        terminalTruth: terminalTruthForResolutionV1(
          this.scenario,
          result,
          isFinalAction,
        ),
        fault: operation.fault,
        settledAtMs: this.nowMs,
        isFinalAction,
      };
      this.lastResolution = resolution;
      this.appendHistory(
        "operationSettled",
        operation.operation,
        operation.fault ?? result,
      );
      operation.resolve(resolution);
    }
    this.publish();
  }

  private appendHistory(
    kind: ScenarioRuntimeHistoryKindV1,
    operation: GatewayOperationNameV1 | null,
    detail: ScenarioRuntimeHistoryEntryV1["detail"],
  ): void {
    this.historySequence += 1;
    this.history.push({
      sequence: this.historySequence,
      atMs: this.nowMs,
      kind,
      operation,
      detail,
    });
    if (this.history.length > MAX_HISTORY_ENTRIES_V1) {
      this.history = this.history.slice(-MAX_HISTORY_ENTRIES_V1);
    }
  }

  private buildSnapshot(): ScenarioRuntimeSnapshotV1 {
    const nextOperation =
      this.scenario.expectedGateway.operations[this.operationCursor] ?? null;
    return {
      scenarioId: this.scenario.id,
      seed: this.seed,
      scenarioEpoch: this.scenarioEpoch,
      nowMs: this.nowMs,
      nowIso: this.nowIso(),
      operationCursor: this.operationCursor,
      operationCount: this.scenario.expectedGateway.operations.length,
      pendingCount: this.pending.length,
      status:
        this.lastResolution?.result === "safeFailure" &&
        this.lastResolution.fault === "unknownEnum"
          ? "failedClosed"
          : this.pending.length > 0
            ? "running"
            : nextOperation === null
              ? "complete"
              : "idle",
      nextOperation,
      injectedFault: this.injectedFault,
      lastResolution: this.lastResolution,
      history: [...this.history],
    };
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function createScenarioRuntimeV1(
  scenarioId: string,
  options: { readonly seed?: number } = {},
): GatewayResultV1<ScenarioRuntimeV1> {
  const manifestValidation = validateScenarioManifestV1(
    ACCOUNT_SCENARIO_MANIFEST_V1,
  );
  if (!manifestValidation.ok) {
    return {
      ok: false,
      error: {
        code: "protocolMismatch",
        stage: "capabilities",
        recovery: { action: "useLocalMode" },
      },
    };
  }
  const scenario = ACCOUNT_SCENARIO_MANIFEST_V1.scenarios.find(
    (candidate) => candidate.id === scenarioId,
  );
  if (scenario === undefined) {
    return {
      ok: false,
      error: {
        code: "capabilityUnavailable",
        stage: "capabilities",
        recovery: { action: "useLocalMode" },
      },
    };
  }
  return {
    ok: true,
    value: new ScenarioRuntimeV1(scenario, options.seed),
  };
}

export const ACCOUNT_FRONTEND_SCENARIOS_V1 =
  ACCOUNT_SCENARIO_MANIFEST_V1.scenarios.filter((scenario) =>
    scenario.requiredLanes.includes("frontend"),
  );
