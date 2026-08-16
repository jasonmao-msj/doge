import { switchEngine } from "./tauri";

export async function activateAccountManagedEngine(
  engineId: "codex" | "claude-code",
): Promise<void> {
  await switchEngine(engineId === "claude-code" ? "claude" : "codex");
}
