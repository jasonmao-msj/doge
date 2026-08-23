import type { CommitMessageEngine } from "../../../services/tauri";

const ENGINE_NAME_OVERRIDES: Partial<Record<CommitMessageEngine, string>> = {
  claude: "Claude Code",
  opencode: "OpenCode",
};

export function formatCommitMessageEngineName(
  engine: CommitMessageEngine,
): string {
  return (
    ENGINE_NAME_OVERRIDES[engine] ??
    engine
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}
