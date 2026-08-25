import { invoke } from "@tauri-apps/api/core";

export function resolveAccountEngineToolchainV1(
  engineId: string,
  choice: "bundled" | "external" | null,
): Promise<unknown> {
  return invoke("account_engine_v1_toolchain", { engineId, choice });
}

export function activateAccountEngineV1(engineId: string): Promise<void> {
  return invoke("account_engine_v1_activate", { engineId });
}
