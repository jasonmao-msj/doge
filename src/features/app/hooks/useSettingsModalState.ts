import { useCallback, useState } from "react";

export type SettingsSection =
  | "basic"
  | "account"
  | "providers"
  | "shortcuts"
  | "project-management"
  | "mcp"
  | "permissions"
  | "commit"
  | "agent-prompt-management"
  | "composer"
  | "dictation"
  | "git"
  | "other"
  | "community"
  | "vendors"
  | "runtime-environment"
  | "experimental"
  | "about";

export type SettingsHighlightTarget =
  | "experimental-collaboration-modes"
  | "basic-open-apps"
  | "basic-web-service"
  | "basic-email"
  | "project-groups"
  | "project-sessions"
  | "agent-management"
  | "prompt-library"
  | "mcp-servers"
  | "mcp-skills"
  | "runtime-pool"
  | "cli-validation";

export function useSettingsModalState() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(
    null,
  );
  const [settingsHighlightTarget, setSettingsHighlightTarget] =
    useState<SettingsHighlightTarget | null>(null);

  const openSettings = useCallback(
    (section?: SettingsSection, highlightTarget?: SettingsHighlightTarget) => {
      setSettingsSection(section ?? null);
      setSettingsHighlightTarget(highlightTarget ?? null);
      setSettingsOpen(true);
    },
    [],
  );

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsSection(null);
    setSettingsHighlightTarget(null);
  }, []);

  return {
    settingsOpen,
    settingsSection,
    settingsHighlightTarget,
    openSettings,
    closeSettings,
    setSettingsOpen,
    setSettingsSection,
    setSettingsHighlightTarget,
  };
}
