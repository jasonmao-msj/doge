import {
  getCliInstallPlan,
  getCliVersionStatus,
  runCliInstaller,
} from "../../../services/cliInstallerCommands";
import {
  createManagedEngineToolchainClientV1,
  type ManagedEngineToolchainResultV1,
} from "./managedEngineToolchain";
import type { ManagedEngineIdV1 } from "./onboardingTypes";
import type {
  CliInstallPlan,
  CliInstallResult,
  CliVersionStatus,
} from "../../../types";

export type ProductProvisioningEngineIdV1 = ManagedEngineIdV1 | "kimi";

export type ProductEngineProvisioningResultV1 =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: string;
        readonly engineId: ProductProvisioningEngineIdV1;
      };
    };

export type ProductEngineProvisioningDependenciesV1 = {
  readonly inspectManaged: (
    engineId: ManagedEngineIdV1,
  ) => Promise<ManagedEngineToolchainResultV1>;
  readonly chooseBundled: (
    engineId: ManagedEngineIdV1,
    inspected: Extract<ManagedEngineToolchainResultV1, { ok: true }>[
      "value"
    ],
  ) => Promise<ManagedEngineToolchainResultV1>;
  readonly kimiVersion: () => Promise<CliVersionStatus>;
  readonly kimiInstallPlan: () => Promise<CliInstallPlan>;
  readonly installKimi: () => Promise<CliInstallResult>;
};

const managedToolchain = createManagedEngineToolchainClientV1();

const defaultDependencies: ProductEngineProvisioningDependenciesV1 = {
  inspectManaged: (engineId) => managedToolchain.inspect(engineId),
  chooseBundled: (engineId, inspected) =>
    managedToolchain.choose(engineId, "bundled", inspected),
  kimiVersion: () => getCliVersionStatus("kimi"),
  kimiInstallPlan: () => getCliInstallPlan("kimi", "installLatest"),
  installKimi: () => runCliInstaller("kimi", "installLatest"),
};

export async function prepareProductEngineProvisioningV1(
  options: {
    readonly onEngine?: (engineId: ProductProvisioningEngineIdV1) => void;
  } = {},
  dependencies: ProductEngineProvisioningDependenciesV1 = defaultDependencies,
): Promise<ProductEngineProvisioningResultV1> {
  let currentEngine: ProductProvisioningEngineIdV1 = "codex";
  try {
    for (const engineId of ["codex", "claude-code"] as const) {
      currentEngine = engineId;
      options.onEngine?.(engineId);
      const inspected = await dependencies.inspectManaged(engineId);
      if (!inspected.ok) return failure(engineId, inspected.error.code);
      const resolved = inspected.value.status === "choiceRequired"
        ? await dependencies.chooseBundled(engineId, inspected.value)
        : inspected;
      if (!resolved.ok) return failure(engineId, resolved.error.code);
      if (resolved.value.status !== "ready") {
        return failure(engineId, "engineBundleUnavailable");
      }
    }

    currentEngine = "kimi";
    options.onEngine?.("kimi");
    const currentKimi = await dependencies.kimiVersion();
    if (currentKimi.installed) return { ok: true };
    const plan = await dependencies.kimiInstallPlan();
    if (!plan.canRun) return failure("kimi", "engineInstallerUnavailable");
    const installed = await dependencies.installKimi();
    if (!installed.ok) return failure("kimi", "engineInstallFailed");
    const verified = await dependencies.kimiVersion();
    return verified.installed
      ? { ok: true }
      : failure("kimi", "engineInstallVerificationFailed");
  } catch {
    return failure(currentEngine, "serviceUnavailable");
  }
}

function failure(
  engineId: ProductProvisioningEngineIdV1,
  code: string,
): ProductEngineProvisioningResultV1 {
  return { ok: false, error: { code, engineId } };
}
