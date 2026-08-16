import { describe, expect, it } from "vitest";
import { ACCOUNT_SCENARIO_MANIFEST_V1 } from "../contracts";
import { createScenarioRuntimeV1 } from "./ScenarioRuntimeV1";

function requireRuntime(scenarioId: string) {
  const result = createScenarioRuntimeV1(scenarioId);
  if (!result.ok) {
    throw new Error(`Expected canonical scenario: ${scenarioId}`);
  }
  return result.value;
}

async function replayRaceScenario() {
  const runtime = requireRuntime("race.older-login-response-after-newer");
  const older = runtime.runNext();
  const newer = runtime.runNext();

  runtime.advanceBy(100);
  const newerResolution = await newer;
  runtime.advanceBy(900);
  const olderResolution = await older;

  return {
    newerResolution,
    olderResolution,
    snapshot: runtime.getSnapshot(),
  };
}

describe("ScenarioRuntimeV1", () => {
  it("closes an unknown scenario without constructing a fallback manifest", () => {
    const result = createScenarioRuntimeV1("unknown.account.scenario");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.recovery.action).toBe("useLocalMode");
    }
  });

  it("uses the canonical manifest entry by reference", () => {
    const runtime = requireRuntime("bootstrap.signed-out-happy");
    const canonicalScenario = ACCOUNT_SCENARIO_MANIFEST_V1.scenarios.find(
      (scenario) => scenario.id === "bootstrap.signed-out-happy",
    );

    expect(runtime.scenario).toBe(canonicalScenario);
  });

  it("advances latency only through the virtual clock", async () => {
    const runtime = requireRuntime("bootstrap.capabilities-loading-slow");
    const pending = runtime.runNext();

    expect(runtime.getSnapshot().pendingCount).toBe(1);
    expect(runtime.getSnapshot().nowMs).toBe(0);

    runtime.advanceBy(1_499);
    expect(runtime.getSnapshot().pendingCount).toBe(1);

    runtime.advanceBy(1);
    await expect(pending).resolves.toMatchObject({
      operation: "gateway.bootstrap",
      settledAtMs: 1_500,
    });
    expect(runtime.getSnapshot().pendingCount).toBe(0);
  });

  it("replays race settlement order deterministically", async () => {
    const firstReplay = await replayRaceScenario();
    const secondReplay = await replayRaceScenario();

    expect(secondReplay).toEqual(firstReplay);
    expect(firstReplay.newerResolution.settledAtMs).toBe(100);
    expect(firstReplay.olderResolution.settledAtMs).toBe(1_000);
  });

  it("fails a mismatched operation closed without consuming the cursor", async () => {
    const runtime = requireRuntime("bootstrap.signed-out-happy");

    await expect(runtime.run("auth.login")).resolves.toMatchObject({
      result: "safeFailure",
      terminalTruth: "rejected",
      fault: "unknownEnum",
    });
    expect(runtime.getSnapshot()).toMatchObject({
      operationCursor: 0,
      status: "failedClosed",
    });
  });

  it("resets seed, virtual time, fault, and debug-safe history", () => {
    const runtime = requireRuntime("bootstrap.signed-out-happy");
    const firstToken = runtime.nextSafeToken("attempt");
    runtime.setFault("offline");
    runtime.advanceBy(900);
    const previousEpoch = runtime.getSnapshot().scenarioEpoch;

    runtime.reset();

    expect(runtime.nextSafeToken("attempt")).toBe(firstToken);
    expect(runtime.getSnapshot()).toMatchObject({
      scenarioEpoch: previousEpoch + 1,
      nowMs: 0,
      operationCursor: 0,
      pendingCount: 0,
      injectedFault: null,
      lastResolution: null,
    });
    expect(runtime.getSnapshot().history).toHaveLength(1);
    expect(runtime.getSnapshot().history[0]?.kind).toBe("reset");
  });

  it("rejects reset while a virtual settlement is pending", () => {
    const runtime = requireRuntime("bootstrap.capabilities-loading-slow");
    void runtime.runNext();

    expect(() => runtime.reset()).toThrow(
      "Scenario reset requires pending operations to settle first",
    );
  });

  it("keeps published snapshots immutable across later transitions", () => {
    const runtime = requireRuntime("bootstrap.capabilities-loading-slow");
    const initialSnapshot = runtime.getSnapshot();

    void runtime.runNext();

    expect(initialSnapshot.history).toHaveLength(1);
    expect(runtime.getSnapshot().history).toHaveLength(2);
  });
});
