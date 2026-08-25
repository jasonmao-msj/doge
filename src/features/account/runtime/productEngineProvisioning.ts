import {
  createManagedEngineToolchainClientV1,
  type ManagedEngineToolchainResultV1,
  type ManagedToolchainEngineIdV1,
} from "./managedEngineToolchain";
import type { ManagedEngineIdV1 } from "./onboardingTypes";

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
    engineId: ManagedToolchainEngineIdV1,
  ) => Promise<ManagedEngineToolchainResultV1>;
  readonly chooseBundled: (
    engineId: ManagedToolchainEngineIdV1,
    inspected: Extract<ManagedEngineToolchainResultV1, { ok: true }>[
      "value"
    ],
  ) => Promise<ManagedEngineToolchainResultV1>;
};

const managedToolchain = createManagedEngineToolchainClientV1();

const defaultDependencies: ProductEngineProvisioningDependenciesV1 = {
  inspectManaged: (engineId) => managedToolchain.inspect(engineId),
  chooseBundled: (engineId, inspected) =>
    managedToolchain.choose(engineId, "bundled", inspected),
};

/** Kimi no longer auto-installs over npm; it resolves from the bundled manifest. */
const PROVISIONED_ENGINE_IDS: readonly ManagedToolchainEngineIdV1[] = [
  "codex",
  "claude-code",
  "kimi",
];

export async function prepareProductEngineProvisioningV1(
  options: {
    readonly onEngine?: (engineId: ProductProvisioningEngineIdV1) => void;
  } = {},
  dependencies: ProductEngineProvisioningDependenciesV1 = defaultDependencies,
): Promise<ProductEngineProvisioningResultV1> {
  let currentEngine: ProductProvisioningEngineIdV1 = PROVISIONED_ENGINE_IDS[0];
  try {
    for (const engineId of PROVISIONED_ENGINE_IDS) {
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
    return { ok: true };
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
