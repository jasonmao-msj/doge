import { describe, expect, it, vi } from "vitest";

import {
  prepareProductEngineProvisioningV1,
  type ProductEngineProvisioningDependenciesV1,
} from "./productEngineProvisioning";
import type { ManagedToolchainEngineIdV1 } from "./managedEngineToolchain";

describe("prepareProductEngineProvisioningV1", () => {
  it("resolves every engine including Kimi from the bundled toolchain without npm install", async () => {
    const inspectManaged = vi.fn(async (engineId: ManagedToolchainEngineIdV1) => ({
      ok: true as const,
      value: {
        engineId,
        status: "choiceRequired" as const,
        bundledVersion: "1.0.0",
        externalVersion: "0.9.0",
        selectedSource: null,
      },
    }));
    const chooseBundled = vi.fn(async (engineId: ManagedToolchainEngineIdV1) => ({
      ok: true as const,
      value: {
        engineId,
        status: "ready" as const,
        bundledVersion: "1.0.0",
        externalVersion: "0.9.0",
        selectedSource: "bundled" as const,
      },
    }));
    const stages: string[] = [];

    await expect(prepareProductEngineProvisioningV1(
      { onEngine: (engineId) => stages.push(engineId) },
      { inspectManaged, chooseBundled },
    )).resolves.toEqual({ ok: true });
    expect(stages).toEqual(["codex", "claude-code", "kimi"]);
    expect(inspectManaged).toHaveBeenCalledTimes(3);
    expect(chooseBundled).toHaveBeenCalledTimes(3);
  });

  it("overrides an externally selected engine with the bundled toolchain", async () => {
    const inspectManaged = vi.fn(async (engineId: ManagedToolchainEngineIdV1) => ({
      ok: true as const,
      value: {
        engineId,
        status: "ready" as const,
        bundledVersion: "1.0.0",
        externalVersion: "2.0.0",
        selectedSource: "external" as const,
      },
    }));
    const chooseBundled = vi.fn(async (engineId: ManagedToolchainEngineIdV1) => ({
      ok: true as const,
      value: {
        engineId,
        status: "ready" as const,
        bundledVersion: "1.0.0",
        externalVersion: "2.0.0",
        selectedSource: "bundled" as const,
      },
    }));

    await expect(prepareProductEngineProvisioningV1(
      {},
      { inspectManaged, chooseBundled },
    )).resolves.toEqual({ ok: true });
    expect(chooseBundled).toHaveBeenCalledTimes(3);
    expect(chooseBundled).toHaveBeenNthCalledWith(1, "codex", expect.anything());
  });

  it("keeps an already-ready Kimi toolchain inspection without re-choosing", async () => {
    const chooseBundled = vi.fn();
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
      chooseBundled,
    };
    await expect(prepareProductEngineProvisioningV1({}, dependencies))
      .resolves.toEqual({ ok: true });
    expect(chooseBundled).not.toHaveBeenCalled();
  });

  it("returns a typed engine-specific failure and stops before configuration", async () => {
    const dependencies: ProductEngineProvisioningDependenciesV1 = {
      inspectManaged: vi.fn(async () => ({
        ok: false as const,
        error: { code: "engineBundleVerificationFailed" },
      })),
      chooseBundled: vi.fn(),
    };
    await expect(prepareProductEngineProvisioningV1({}, dependencies)).resolves.toEqual({
      ok: false,
      error: {
        code: "engineBundleVerificationFailed",
        engineId: "codex",
      },
    });
  });

  it("attributes a Kimi bundle failure to Kimi instead of falling back to install", async () => {
    const dependencies: ProductEngineProvisioningDependenciesV1 = {
      inspectManaged: vi.fn(async (engineId) =>
        engineId === "kimi"
          ? ({
              ok: false as const,
              error: { code: "engineBundleUnavailable" },
            } satisfies Awaited<
              ReturnType<ProductEngineProvisioningDependenciesV1["inspectManaged"]>
            >)
          : ({
              ok: true as const,
              value: {
                engineId,
                status: "ready" as const,
                bundledVersion: "1.0.0",
                externalVersion: null,
                selectedSource: "bundled" as const,
              },
            } satisfies Awaited<
              ReturnType<ProductEngineProvisioningDependenciesV1["inspectManaged"]>
            >),
      ),
      chooseBundled: vi.fn(),
    };

    await expect(prepareProductEngineProvisioningV1({}, dependencies)).resolves.toEqual({
      ok: false,
      error: {
        code: "engineBundleUnavailable",
        engineId: "kimi",
      },
    });
  });

  it("attributes an unexpected toolchain bridge error to the engine being prepared", async () => {
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
