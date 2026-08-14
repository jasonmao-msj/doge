import type { AccountScenarioV1, ScenarioManifestV1 } from "./scenario";
import type { AccountIpcValidationContextV1 } from "./ipcValidator";
import {
  validateAccountIpcEventEnvelopeV1,
  validateAccountIpcRequestV1,
  validateAccountIpcResponseEnvelopeV1,
} from "./ipcValidator";
import {
  readScenarioPrivateTransientFixtureV1,
  scenarioResponseValidationContextV1,
} from "./scenarioPayloadFixtures";
import type { SchemaIssueV1, SchemaValidationV1 } from "./schema";
import { issueV1, validationV1 } from "./schema";

export type ScenarioParityCaseTraceV1 = {
  readonly fixtureClass: "Good" | "Base" | "Bad";
  readonly fixtureRef: string;
  readonly requestAccepted: boolean;
  readonly resultAccepted: boolean;
  readonly eventAccepted: boolean;
  readonly terminalTruthMatches: boolean;
  readonly expectedEventsMatch: boolean;
  readonly faultScheduleMatches: boolean;
};

export type ScenarioParityTraceV1 = {
  readonly scenarioId: string;
  readonly semanticRevision: 1;
  readonly terminalTruth: string;
  readonly expectedEvents: readonly string[];
  readonly faultSchedule: unknown;
  readonly steps: readonly {
    readonly stepId: string;
    readonly operation: string;
    readonly cases: readonly ScenarioParityCaseTraceV1[];
  }[];
};

export type ScenarioLaneAdapterV1 = {
  readonly lane: "mock" | "ipc-adapter";
  execute(scenario: AccountScenarioV1, context: AccountIpcValidationContextV1): ScenarioParityTraceV1;
};

/** Mock projection intentionally uses array projection over private fixture refs. */
export const ACCOUNT_SCENARIO_MOCK_ADAPTER_V1: ScenarioLaneAdapterV1 = {
  lane: "mock",
  execute(scenario, context) {
    return {
      scenarioId: scenario.id,
      semanticRevision: scenario.semanticRevision,
      terminalTruth: scenario.terminalTruth,
      expectedEvents: [...scenario.expectedGateway.events],
      faultSchedule: structuredClone(scenario.schedule),
      steps: scenario.steps.map((step) => ({
        stepId: step.stepId,
        operation: step.operation,
        cases: (["Good", "Base", "Bad"] as const).map((fixtureClass) => {
          const ref = step.privateFixtureRefs[fixtureClass];
          const fixture = readScenarioPrivateTransientFixtureV1(ref);
          const responseContext = scenarioResponseValidationContextV1(fixture);
          return {
            fixtureClass,
            fixtureRef: ref,
            requestAccepted: validateAccountIpcRequestV1(fixture.request, context).ok,
            resultAccepted: validateAccountIpcResponseEnvelopeV1(fixture.result, responseContext).ok,
            eventAccepted: validateAccountIpcEventEnvelopeV1(fixture.event, null).ok,
            terminalTruthMatches: fixture.terminalTruth === scenario.terminalTruth,
            expectedEventsMatch: equalJsonV1(fixture.expectedEvents, scenario.expectedGateway.events),
            faultScheduleMatches: equalJsonV1(fixture.faultSchedule, scenario.schedule),
          };
        }),
      })),
    };
  },
};

/** IPC projection intentionally walks and rebuilds a separate trace path. */
export const ACCOUNT_SCENARIO_IPC_ADAPTER_V1: ScenarioLaneAdapterV1 = {
  lane: "ipc-adapter",
  execute(scenario, context) {
    const steps: Array<ScenarioParityTraceV1["steps"][number]> = [];
    for (const step of scenario.steps) {
      const cases: ScenarioParityCaseTraceV1[] = [];
      for (const fixtureClass of ["Good", "Base", "Bad"] as const) {
        const ref = step.privateFixtureRefs[fixtureClass];
        const fixture = readScenarioPrivateTransientFixtureV1(ref);
        cases.push({
          fixtureClass,
          fixtureRef: ref,
          requestAccepted: validateAccountIpcRequestV1(fixture.request, context).ok,
          resultAccepted: validateAccountIpcResponseEnvelopeV1(
            fixture.result,
            scenarioResponseValidationContextV1(fixture),
          ).ok,
          eventAccepted: validateAccountIpcEventEnvelopeV1(fixture.event, null).ok,
          terminalTruthMatches: fixture.terminalTruth === scenario.terminalTruth,
          expectedEventsMatch: equalJsonV1(fixture.expectedEvents, scenario.expectedGateway.events),
          faultScheduleMatches: equalJsonV1(fixture.faultSchedule, scenario.schedule),
        });
      }
      steps.push({ stepId: step.stepId, operation: step.operation, cases });
    }
    return {
      scenarioId: scenario.id,
      semanticRevision: scenario.semanticRevision,
      terminalTruth: scenario.terminalTruth,
      expectedEvents: Array.from(scenario.expectedGateway.events),
      faultSchedule: {
        latencyMs: Array.from(scenario.schedule.latencyMs),
        faults: Array.from(scenario.schedule.faults),
        cancellationsAtAction: Array.from(scenario.schedule.cancellationsAtAction),
      },
      steps,
    };
  },
};

export function validateScenarioManifestParityV1(
  manifest: ScenarioManifestV1,
  context: AccountIpcValidationContextV1,
  mockAdapter: ScenarioLaneAdapterV1 = ACCOUNT_SCENARIO_MOCK_ADAPTER_V1,
  ipcAdapter: ScenarioLaneAdapterV1 = ACCOUNT_SCENARIO_IPC_ADAPTER_V1,
): SchemaValidationV1<readonly ScenarioParityTraceV1[]> {
  const issues: SchemaIssueV1[] = [];
  const traces: ScenarioParityTraceV1[] = [];
  for (const scenario of manifest.scenarios) {
    const mock = mockAdapter.execute(scenario, context);
    const ipc = ipcAdapter.execute(scenario, context);
    traces.push(mock);
    if (!equalJsonV1(mock, ipc)) {
      issues.push(issueV1(`$.${scenario.id}`, "invariant", "mock and IPC adapter scenario traces diverged"));
    }
    mock.steps.forEach((step, stepIndex) => {
      step.cases.forEach((fixture, fixtureIndex) => {
        const expectedValue = fixture.fixtureClass !== "Bad";
        if (
          fixture.requestAccepted !== expectedValue ||
          fixture.resultAccepted !== expectedValue ||
          fixture.eventAccepted !== expectedValue ||
          !fixture.terminalTruthMatches ||
          !fixture.expectedEventsMatch ||
          !fixture.faultScheduleMatches
        ) {
          issues.push(issueV1(
            `$.${scenario.id}.steps[${stepIndex}].cases[${fixtureIndex}]`,
            "invariant",
            "private fixture validation or scenario semantic truth drifted",
          ));
        }
      });
    });
  }
  return validationV1(traces, issues);
}

function equalJsonV1(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
