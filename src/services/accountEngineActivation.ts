import { activateAccountEngineV1 } from "./tauri/accountEngine";

export async function activateAccountManagedEngine(
  engineId: "codex" | "claude-code",
): Promise<void> {
  await activateAccountEngineV1(engineId);
}
