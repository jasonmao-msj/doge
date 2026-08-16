import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import type { ManagedEngineIdV1 } from "./engineOnboardingClient";

const LAST_MANAGED_ENGINE_KEY = "account.lastManagedEngine";

export function readLastManagedEnginePreferenceV1(): ManagedEngineIdV1 | null {
  const value = getClientStoreSync<unknown>("app", LAST_MANAGED_ENGINE_KEY);
  return value === "codex" || value === "claude-code" ? value : null;
}

export function writeLastManagedEnginePreferenceV1(
  engineId: ManagedEngineIdV1,
): void {
  writeClientStoreValue("app", LAST_MANAGED_ENGINE_KEY, engineId);
}
