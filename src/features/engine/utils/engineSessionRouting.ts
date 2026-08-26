import type { SetActiveEngineOptions, EngineType } from "../../../types";
import {
  isManagedProviderProfileIdV1,
  managedEngineIdForRuntimeV1,
} from "../../account/runtime/engineEntitlementStore";
import { engineUsesNativeActiveEngineAuthority } from "../engineRegistry";

export type SessionEngineActivationPlan = {
  options?: SetActiveEngineOptions;
  requireSuccess: boolean;
};

/**
 * Select the activation contract for a native session target. Persistent
 * Codex launches need the native active-engine mutation; managed Codex/Claude
 * also need their verified account toolchain activated. One-shot providers
 * keep their existing explicit per-turn routing.
 */
export function resolveSessionEngineActivation(
  engine: EngineType,
  providerProfileId?: string | null,
): SessionEngineActivationPlan {
  const normalizedProviderProfileId = providerProfileId?.trim() || null;
  const managedActivationRequired =
    isManagedProviderProfileIdV1(normalizedProviderProfileId) &&
    managedEngineIdForRuntimeV1(engine) !== null;
  const requireSuccess =
    engineUsesNativeActiveEngineAuthority(engine) || managedActivationRequired;

  if (!normalizedProviderProfileId && !requireSuccess) {
    return { requireSuccess };
  }

  return {
    requireSuccess,
    options: {
      ...(requireSuccess ? { ensureRuntime: true } : {}),
      ...(normalizedProviderProfileId
        ? { providerProfileId: normalizedProviderProfileId }
        : {}),
    },
  };
}
