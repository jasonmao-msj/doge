import { describe, expect, it, vi } from "vitest";

import {
  prepareProductEngineProvisioningV1,
  type ProductEngineProvisioningDependenciesV1,
} from "./productEngineProvisioning";
import type {
  CliInstallPlan,
  CliInstallResult,
  CliVersionStatus,
} from "../../../types";

describe("prepareProductEngineProvisioningV1", () => {
  it("selects bundled managed tools and installs Kimi only when missing", async () => {
    const inspectManaged = vi.fn(async (engineId: "codex" | "claude-code") => ({
      ok: true as const,
      value: {
        engineId,
        status: "choiceRequired" as const,
        bundledVersion: "1.0.0",
        externalVersion: "0.9.0",
        selectedSource: null,
      },
    }));
    const chooseBundled = vi.fn(async (engineId: "codex" | "claude-code") => ({
      ok: true as const,
      value: {
        engineId,
        status: "ready" as const,
        bundledVersion: "1.0.0",
        externalVersion: "0.9.0",
        selectedSource: "bundled" as const,
      },
    }));
    const kimiVersion = vi
      .fn()
      .mockResolvedValueOnce(kimiVersionStatus(false))
      .mockResolvedValueOnce(kimiVersionStatus(true));
    const installKimi = vi.fn(async () => kimiInstallResult(true));
    const stages: string[] = [];

    await expect(prepareProductEngineProvisioningV1(
      { onEngine: (engineId) => stages.push(engineId) },
      {
        inspectManaged,
        chooseBundled,
        kimiVersion,
        kimiInstallPlan: vi.fn(async () => kimiPlan(true)),
        installKimi,
      },
    )).resolves.toEqual({ ok: true });
    expect(stages).toEqual(["codex", "claude-code", "kimi"]);
    expect(chooseBundled).toHaveBeenCalledTimes(2);
    expect(installKimi).toHaveBeenCalledTimes(1);
  });

  it("does not reinstall an already available Kimi CLI", async () => {
    const installKimi = vi.fn();
    const dependencies: ProductEngineProvisioningDependenciesV1 = {
      inspectManaged: vi.fn(async (engineId) => ({
        ok: true as const,
        value: {
          engineId,
          status: "ready" as const,
          bundledVersion: "1.0.0",
          externalVersion: null,
          selectedSource: "bundled" as const,
        },
      })),
      chooseBundled: vi.fn(),
      kimiVersion: vi.fn(async () => kimiVersionStatus(true)),
      kimiInstallPlan: vi.fn(),
      installKimi,
    };
    await expect(prepareProductEngineProvisioningV1({}, dependencies))
      .resolves.toEqual({ ok: true });
    expect(installKimi).not.toHaveBeenCalled();
  });

  it("returns a typed engine-specific failure and stops before configuration", async () => {
    const dependencies: ProductEngineProvisioningDependenciesV1 = {
      inspectManaged: vi.fn(async () => ({
        ok: false as const,
        error: { code: "engineBundleVerificationFailed" },
      })),
      chooseBundled: vi.fn(),
      kimiVersion: vi.fn(),
      kimiInstallPlan: vi.fn(),
      installKimi: vi.fn(),
    };
    await expect(prepareProductEngineProvisioningV1({}, dependencies)).resolves.toEqual({
      ok: false,
      error: {
        code: "engineBundleVerificationFailed",
        engineId: "codex",
      },
    });
  });

  it("attributes an unexpected installer error to the engine being prepared", async () => {
    const dependencies: ProductEngineProvisioningDependenciesV1 = {
      inspectManaged: vi.fn(async (engineId) => {
        if (engineId === "claude-code") {
          throw new Error("toolchain bridge unavailable");
        }
        return {
          ok: true as const,
          value: {
            engineId,
            status: "ready" as const,
            bundledVersion: "1.0.0",
            externalVersion: null,
            selectedSource: "bundled" as const,
          },
        };
      }),
      chooseBundled: vi.fn(),
      kimiVersion: vi.fn(),
      kimiInstallPlan: vi.fn(),
      installKimi: vi.fn(),
    };

    await expect(prepareProductEngineProvisioningV1({}, dependencies)).resolves.toEqual({
      ok: false,
      error: {
        code: "serviceUnavailable",
        engineId: "claude-code",
      },
    });
  });
});

function kimiVersionStatus(installed: boolean): CliVersionStatus {
  return {
    engine: "kimi",
    installed,
    localVersion: installed ? "0.38.0" : null,
    latestVersion: "0.38.0",
    updateAvailable: false,
    nodeOk: true,
    details: null,
  };
}

function kimiPlan(canRun: boolean): CliInstallPlan {
  return {
    engine: "kimi",
    action: "installLatest",
    strategy: "npmGlobal",
    backend: "local",
    platform: "macos",
    commandPreview: ["npm", "install"],
    canRun,
    blockers: canRun ? [] : ["npm unavailable"],
    warnings: [],
    manualFallback: null,
  };
}

function kimiInstallResult(ok: boolean): CliInstallResult {
  return {
    ok,
    engine: "kimi",
    action: "installLatest",
    strategy: "npmGlobal",
    backend: "local",
    exitCode: ok ? 0 : 1,
    stdoutSummary: null,
    stderrSummary: null,
    details: null,
    durationMs: 1,
    doctorResult: null,
  };
}
