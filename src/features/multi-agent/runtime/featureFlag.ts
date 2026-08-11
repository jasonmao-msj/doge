const STORAGE_KEY = "doge.agentOrchestrationV1";

function parseFlag(value: string | null | undefined): boolean | null {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(normalized)) return true;
  if (["0", "false", "off", "no"].includes(normalized)) return false;
  return null;
}

export function isMultiAgentEnabled(): boolean {
  if (typeof window !== "undefined") {
    try {
      const stored = parseFlag(window.localStorage.getItem(STORAGE_KEY));
      if (stored !== null) return stored;
      // 兼容旧 key
      const legacy = parseFlag(
        window.localStorage.getItem("doge.squadOrchestrationV1"),
      );
      if (legacy !== null) return legacy;
    } catch {
      // ignore storage failures
    }
  }
  // 默认开启（与 Rust kill switch 一致：opt-out）。
  // 关闭：env VITE_DOGE_AGENT_ORCHESTRATION_V1=0 或 localStorage `doge.agentOrchestrationV1`="0"。
  // Shared 协作入口可见性/发送不再依赖此 flag；仅保留给遗留调用方与紧急关闭。
  return (
    parseFlag(import.meta.env.VITE_DOGE_AGENT_ORCHESTRATION_V1) ??
    parseFlag(import.meta.env.VITE_DOGE_SQUAD_ORCHESTRATION_V1) ??
    parseFlag(import.meta.env.VITE_CCGUI_AGENT_ORCHESTRATION_V1) ??
    parseFlag(import.meta.env.VITE_CCGUI_SQUAD_ORCHESTRATION_V1) ??
    true
  );
}
