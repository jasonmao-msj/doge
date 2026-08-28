import { afterEach, describe, expect, it, vi } from "vitest";

import { MANAGED_PROVIDER_PROFILE_ID_V1 } from "./engineEntitlementStore";
import type {
  ManagedEngineToolchainResultV1,
  ManagedToolchainEngineIdV1,
} from "./managedEngineToolchain";
import {
  clearProductEngineProvisioningV1,
  ensureProductEngineReadyV1,
  readProductEngineProvisioningSnapshotV1,
  retryProductEngineProvisioningV1,
  type ProductEngineProvisioningDependenciesV1,
} from "./productEngineProvisioning";
import type {
  ProductEngineIdV1,
  ProductReadyViewV1,
} from "./productOnboardingClient";

afterEach(() => {
  clearProductEngineProvisioningV1();
});

describe("ensureProductEngineReadyV1", () => {
  it("does nothing for providers that are not managed by Doge", async () => {
    const deps = createDependencies();

    await expect(
      ensureProductEngineReadyV1(
        { engine: "codex", providerProfileId: "custom-provider" },
        deps,
      ),
    ).resolves.toBeUndefined();

    expect(deps.prepareProduct).not.toHaveBeenCalled();
    expect(deps.inspectToolchain).not.toHaveBeenCalled();
  });

  it("does nothing for an engine outside the Product runtime set", async () => {
    const deps = createDependencies();

    await expect(ensureProductEngineReadyV1(
      { engine: "opencode", providerProfileId: MANAGED_PROVIDER_PROFILE_ID_V1 },
      deps,
    )).resolves.toBeUndefined();

    expect(deps.prepareProduct).not.toHaveBeenCalled();
    expect(deps.inspectToolchain).not.toHaveBeenCalled();
  });

  it("silently prepares an already-usable Codex engine", async () => {
    const deps = createDependencies();

    await expect(ensureManagedEngine("codex", deps)).resolves.toBeUndefined();

    expect(deps.prepareProduct).toHaveBeenCalledTimes(1);
    expect(deps.prepareProduct).toHaveBeenCalledWith("codex");
    expect(deps.inspectToolchain).toHaveBeenCalledTimes(1);
    expect(deps.inspectToolchain).toHaveBeenCalledWith("codex");
    expect(deps.activate).toHaveBeenCalledWith("codex");
    expect(deps.getInstallPlan).not.toHaveBeenCalled();
    expect(readProductEngineProvisioningSnapshotV1()).toMatchObject({
      engine: null,
      phase: "idle",
    });
  });

  it("uses Kimi as a one-shot engine without changing the global active engine", async () => {
    const deps = createDependencies();

    await expect(ensureManagedEngine("kimi", deps)).resolves.toBeUndefined();

    expect(deps.prepareProduct).toHaveBeenCalledWith("kimi");
    expect(deps.inspectToolchain).toHaveBeenCalledWith("kimi");
    expect(deps.activate).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent checks for the same engine", async () => {
    let resolvePrepare: (
      value: ReturnType<typeof successfulPrepare>,
    ) => void = () => {
      throw new Error("prepare resolver was not initialized");
    };
    const pendingPrepare = new Promise<ReturnType<typeof successfulPrepare>>(
      (resolve) => {
        resolvePrepare = resolve;
      },
    );
    const deps = createDependencies({
      prepareProduct: vi.fn(() => pendingPrepare),
    });

    const first = ensureManagedEngine("claude", deps);
    const second = ensureManagedEngine("claude", deps);

    expect(second).toBe(first);
    await Promise.resolve();
    resolvePrepare(successfulPrepare());
    await expect(first).resolves.toBeUndefined();
    expect(deps.prepareProduct).toHaveBeenCalledTimes(1);
    expect(deps.prepareProduct).toHaveBeenCalledWith("claude-code");
  });

  it("selects the verified bundled toolchain when native resolution requires a choice", async () => {
    const deps = createDependencies({
      inspectToolchain: vi.fn(async (engineId) => ({
        ok: true as const,
        value: {
          engineId,
          status: "choiceRequired" as const,
          bundledVersion: "1.0.0",
          externalVersion: "0.9.0",
          selectedSource: null,
        },
      })),
    });

    await expect(ensureManagedEngine("codex", deps)).resolves.toBeUndefined();

    expect(deps.chooseToolchain).toHaveBeenCalledWith(
      "codex",
      "bundled",
      expect.objectContaining({ bundledVersion: "1.0.0" }),
    );
    expect(deps.getInstallPlan).not.toHaveBeenCalled();
  });

  it("shows progress only while installing the selected missing engine", async () => {
    const inspectToolchain = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        error: { code: "engineBundleUnavailable" },
      })
      .mockResolvedValueOnce(readyToolchain("codex", "external", null));
    let resolveInstaller: (
      value: Awaited<
        ReturnType<ProductEngineProvisioningDependenciesV1["runInstaller"]>
      >,
    ) => void = () => {
      throw new Error("installer resolver was not initialized");
    };
    const installerResult = new Promise<
      Awaited<
        ReturnType<ProductEngineProvisioningDependenciesV1["runInstaller"]>
      >
    >((resolve) => {
      resolveInstaller = resolve;
    });
    const runInstaller = vi.fn(() => installerResult);
    const deps = createDependencies({ inspectToolchain, runInstaller });

    const provisioning = ensureManagedEngine("codex", deps);
    await vi.waitFor(() => expect(runInstaller).toHaveBeenCalledTimes(1));

    expect(readProductEngineProvisioningSnapshotV1()).toMatchObject({
      engine: "codex",
      phase: "installing",
    });
    resolveInstaller(successfulInstallerResult(
      "codex",
      "installLatest",
      "npmGlobal",
    ));
    await expect(provisioning).resolves.toBeUndefined();

    expect(deps.getInstallPlan).toHaveBeenCalledWith(
      "codex",
      "installLatest",
      "npmGlobal",
    );
    expect(deps.runInstaller).toHaveBeenCalledWith(
      "codex",
      "installLatest",
      "npmGlobal",
      expect.stringMatching(/^product-codex-/),
    );
    expect(inspectToolchain).toHaveBeenCalledTimes(2);
    expect(readProductEngineProvisioningSnapshotV1()).toMatchObject({
      engine: "codex",
      phase: "ready",
    });
  });

  it("keeps a typed error visible and retries the same engine", async () => {
    const prepareProduct = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        error: { code: "protocolMismatch", stage: "productPrepare" },
      })
      .mockResolvedValueOnce(successfulPrepare());
    const deps = createDependencies({ prepareProduct });

    await expect(ensureManagedEngine("codex", deps)).rejects.toMatchObject({
      name: "ProductEngineProvisioningErrorV1",
      code: "protocolMismatch",
      engine: "codex",
    });
    expect(readProductEngineProvisioningSnapshotV1()).toMatchObject({
      engine: "codex",
      phase: "error",
      errorCode: "protocolMismatch",
      retryable: true,
    });

    await expect(retryProductEngineProvisioningV1()).resolves.toBeUndefined();
    expect(prepareProduct).toHaveBeenCalledTimes(2);
    expect(readProductEngineProvisioningSnapshotV1().phase).toBe("idle");
  });
});

function ensureManagedEngine(
  engine: string,
  dependencies: ProductEngineProvisioningDependenciesV1,
) {
  return ensureProductEngineReadyV1(
    { engine, providerProfileId: MANAGED_PROVIDER_PROFILE_ID_V1 },
    dependencies,
  );
}

function createDependencies(
  overrides: Partial<ProductEngineProvisioningDependenciesV1> = {},
): ProductEngineProvisioningDependenciesV1 {
  const dependencies: ProductEngineProvisioningDependenciesV1 = {
    prepareProduct: vi.fn(async () => successfulPrepare()),
    inspectToolchain: vi.fn(async (engineId) =>
      readyToolchain(engineId, "bundled", "1.0.0"),
    ),
    chooseToolchain: vi.fn(async (engineId) =>
      readyToolchain(engineId, "bundled", "1.0.0"),
    ),
    activate: vi.fn(async () => undefined),
    getInstallPlan: vi.fn(async (engine, action, strategy) => ({
      engine,
      action,
      strategy,
      backend: "local" as const,
      platform: "macos" as const,
      commandPreview: [],
      canRun: true,
      blockers: [],
      warnings: [],
      manualFallback: null,
    })),
    runInstaller: vi.fn(async (engine, action, strategy) =>
      successfulInstallerResult(engine, action, strategy)),
    subscribeInstallerEvents: vi.fn(() => () => undefined),
  };
  return { ...dependencies, ...overrides };
}

function successfulInstallerResult(
  engine: Parameters<ProductEngineProvisioningDependenciesV1["runInstaller"]>[0],
  action: Parameters<ProductEngineProvisioningDependenciesV1["runInstaller"]>[1],
  strategy: Parameters<ProductEngineProvisioningDependenciesV1["runInstaller"]>[2],
): Awaited<ReturnType<ProductEngineProvisioningDependenciesV1["runInstaller"]>> {
  return {
    ok: true,
    engine,
    action,
    strategy,
    backend: "local",
    exitCode: 0,
    stdoutSummary: null,
    stderrSummary: null,
    details: null,
    durationMs: 10,
    doctorResult: { ok: true },
  } as Awaited<
    ReturnType<ProductEngineProvisioningDependenciesV1["runInstaller"]>
  >;
}

function readyToolchain(
  engineId: ManagedToolchainEngineIdV1,
  source: "bundled" | "external",
  bundledVersion: string | null,
): ManagedEngineToolchainResultV1 {
  return {
    ok: true,
    value: {
      engineId,
      status: "ready",
      bundledVersion,
      externalVersion: source === "external" ? "2.0.0" : null,
      selectedSource: source,
    },
  };
}

function successfulPrepare() {
  return { ok: true as const, value: readyProductView() };
}

function readyProductView(): ProductReadyViewV1 {
  return {
    status: "ready",
    entitlement: {
      status: "active",
      subscriptionId: 9,
      groupId: 5,
      groupName: "Doge",
      planName: "Doge",
      expiresAt: "2030-01-01T00:00:00Z",
      usage: null,
    },
    models: [
      {
        id: "gpt-5.6-sol",
        displayName: "gpt-5.6-sol",
        model: "gpt-5.6-sol",
        apiProtocols: ["openai-responses"],
        capabilities: ["chat"],
      },
    ],
    engines: (["codex", "claude-code", "kimi"] as ProductEngineIdV1[]).map(
      (id) => ({ id, displayName: id }),
    ),
  };
}
