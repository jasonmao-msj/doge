import { describe, expect, it } from "vitest";
import {
  gatewayIntentIdV1,
  type GatewayCallContextV1,
  type SecretInputV1,
  validateAccountSafeArtifactV1,
} from "../contracts";
import { installAccountZeroCallGuardV1 } from "../testing/zeroCallGuard";
import { createMockAccountGatewayV1 } from "./MockAccountGatewayV1";
import { createScenarioRuntimeV1 } from "./ScenarioRuntimeV1";

const SYNTHETIC_FORM_VALUE_V1 =
  "synthetic-form-value" as SecretInputV1;

function requireGateway(scenarioId: string) {
  const result = createScenarioRuntimeV1(scenarioId);
  if (!result.ok) {
    throw new Error(`Expected canonical scenario: ${scenarioId}`);
  }
  return {
    runtime: result.value,
    gateway: createMockAccountGatewayV1(result.value),
  };
}

function callContextV1(sequence: number): GatewayCallContextV1 {
  return {
    intent: gatewayIntentIdV1(
      `intent_synthetic${sequence.toString().padStart(4, "0")}`,
    ),
  };
}

describe("MockAccountGatewayV1", () => {
  it("runs bootstrap and login through the same zero-call adapter boundary", async () => {
    const guard = installAccountZeroCallGuardV1();
    try {
      const bootstrap = requireGateway("bootstrap.signed-out-happy");
      const bootstrapResult = await bootstrap.gateway.bootstrap({});
      expect(bootstrapResult).toMatchObject({
        ok: true,
        value: {
          localMode: { status: "available", blockedByAccount: false },
          session: { status: "signedOut" },
        },
      });

      const login = requireGateway("login.happy");
      const loginResult = await login.gateway.auth.login(
        {
          email: "synthetic account label",
          password: SYNTHETIC_FORM_VALUE_V1,
        },
        callContextV1(1),
      );
      expect(loginResult).toMatchObject({
        ok: true,
        value: {
          next: "authenticated",
          session: { sessionCapability: "persistent" },
        },
      });
      expect(validateAccountSafeArtifactV1(loginResult).ok).toBe(true);
      expect(validateAccountSafeArtifactV1(login.runtime.getSnapshot()).ok).toBe(
        true,
      );
      expect(JSON.stringify(login.runtime.getSnapshot())).not.toContain(
        SYNTHETIC_FORM_VALUE_V1,
      );
      guard.assertNoCalls();
    } finally {
      guard.restore();
    }
  });

  it("keeps Local Mode available when bootstrap fails offline", async () => {
    const { gateway } = requireGateway("bootstrap.offline");

    await expect(gateway.bootstrap({})).resolves.toEqual({
      ok: false,
      error: {
        code: "offline",
        stage: "capabilities",
        recovery: { action: "useLocalMode" },
      },
    });
  });

  it("drives configuration plan, apply, and current-task views with bound handles", async () => {
    const guard = installAccountZeroCallGuardV1();
    try {
      const { gateway } = requireGateway("configuration.no-config-success");
      await gateway.managedKey.readStatus(
        { recipeId: "doge.account.codex-token-service", recipeVersion: 1 },
        {},
      );
      const candidates = await gateway.managedKey.listCandidates(
        { recipeId: "doge.account.codex-token-service", recipeVersion: 1 },
        {},
      );
      if (!candidates.ok || candidates.value.keys.length === 0) {
        throw new Error("Expected a selectable API Key candidate");
      }
      const offer = await gateway.configuration.readOffer({});
      expect(offer).toMatchObject({
        ok: true,
        value: { status: "available", recommendation: "configure" },
      });
      const selected = await gateway.managedKey.selectExisting(
        {
          recipeId: "doge.account.codex-token-service",
          recipeVersion: 1,
          key: candidates.value.keys[0].key,
          consent: "useSelectedApiKey",
        },
        callContextV1(2),
      );
      expect(selected).toMatchObject({ ok: true, value: { status: "ready" } });

      const plan = await gateway.configuration.createPlan(
        {
          recipeId: "doge.account.codex-token-service",
          recipeVersion: 1,
          intent: "configure",
        },
        callContextV1(3),
      );
      if (!plan.ok) {
        throw new Error("Expected a synthetic configuration plan");
      }
      expect(plan.value.plan).toMatch(
        /^handle~config-plan~configuration-plan~e1~g1~x\d+~/,
      );

      const applied = await gateway.configuration.apply(
        { plan: plan.value.plan, consent: "applyExactPlan" },
        callContextV1(4),
      );
      expect(applied).toMatchObject({
        ok: true,
        value: { overall: "applied", verification: "usable" },
      });

      const currentTask = await gateway.configuration.readCurrentTask({});
      expect(currentTask).toMatchObject({
        ok: true,
        value: { overall: "applied" },
      });
      expect(validateAccountSafeArtifactV1(currentTask).ok).toBe(true);
      guard.assertNoCalls();
    } finally {
      guard.restore();
    }
  });

  it("returns a closed cancellation after a pending virtual settlement", async () => {
    const { runtime, gateway } = requireGateway(
      "bootstrap.capabilities-loading-slow",
    );
    const controller = new AbortController();
    const result = gateway.bootstrap({ signal: controller.signal });

    controller.abort();
    runtime.advanceToNext();

    await expect(result).resolves.toEqual({
      ok: false,
      error: {
        code: "cancelled",
        stage: "capabilities",
        recovery: { action: "none" },
      },
    });
  });

  it("emits deterministic generation and event sequence metadata", async () => {
    const { gateway, runtime } = requireGateway("oauth.happy-return");
    const events: Parameters<typeof gateway.subscribe>[0] extends (
      event: infer Event,
    ) => void
      ? Event[]
      : never = [];
    const unsubscribe = gateway.subscribe((event) => events.push(event));

    const start = await gateway.auth.startOAuth(
      { provider: "auth.oauth.github" },
      callContextV1(4),
    );
    if (!start.ok || start.value.next !== "oauthWaiting") {
      throw new Error("Expected a synthetic OAuth attempt");
    }
    await gateway.auth.readOAuthAttempt(
      { attempt: start.value.attempt },
      {},
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "oauthAttemptChanged",
      processGeneration: 1,
      eventSeq: 1,
      accountEpoch: 1,
    });

    runtime.reset();
    const replayStart = await gateway.auth.startOAuth(
      { provider: "auth.oauth.github" },
      callContextV1(5),
    );
    if (!replayStart.ok || replayStart.value.next !== "oauthWaiting") {
      throw new Error("Expected a replayed synthetic OAuth attempt");
    }
    await gateway.auth.readOAuthAttempt(
      { attempt: replayStart.value.attempt },
      {},
    );
    unsubscribe();

    expect(events[1]).toMatchObject({
      kind: "oauthAttemptChanged",
      processGeneration: 1,
      eventSeq: 1,
      accountEpoch: 2,
    });
  });
});
