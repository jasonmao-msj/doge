import { useCallback, useEffect, useRef, useState } from "react";
import { shouldHideHomeOnThreadActivation } from "../features/home/utils/homeVisibility";

export function useAppShellViewStateSection({
  activePlan,
  activeTab,
  activeThreadId,
  activeWorkspace,
  activeWorkspaceId,
  appMode,
  expandRightPanel,
  homeOpen,
  homeWorkspaceDefaultId,
  isCompact,
  isTablet,
  selectedCollaborationMode,
  setActiveThreadId,
  setActiveWorkspaceId,
  setHomeOpen,
  tabletTab,
}: any) {
  const isPlanMode = selectedCollaborationMode?.mode === "plan";
  const hasPlanData = Boolean(
    activePlan && (activePlan.steps.length > 0 || activePlan.explanation)
  );
  const [isPlanPanelDismissed, setIsPlanPanelDismissed] = useState(true);
  const hasActivePlan = hasPlanData && !isPlanPanelDismissed;
  useEffect(() => {
    setIsPlanPanelDismissed(true);
  }, [activeThreadId]);
  const openPlanPanel = useCallback(() => {
    setIsPlanPanelDismissed(false);
    expandRightPanel();
  }, [expandRightPanel]);
  const closePlanPanel = useCallback(() => {
    setIsPlanPanelDismissed(true);
  }, []);
  const showKanban = appMode === "kanban";
  const showGitHistory = appMode === "gitHistory";
  const showPlugins = appMode === "plugins";
  const [selectedKanbanTaskId, setSelectedKanbanTaskId] = useState<string | null>(null);
  const [workspaceHomeWorkspaceId, setWorkspaceHomeWorkspaceId] = useState<string | null>(null);
  const showHome = (!activeWorkspace || homeOpen) && !showKanban && !showPlugins;
  const showWorkspaceHome = Boolean(
    activeWorkspace &&
      !showHome &&
      workspaceHomeWorkspaceId === activeWorkspace.id &&
      !activeThreadId &&
      appMode === "chat" &&
      (isCompact ? (isTablet ? tabletTab : activeTab) === "codex" : activeTab !== "spec"),
  );
  const pendingDefaultWorkspaceActivationRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeWorkspaceId) {
      pendingDefaultWorkspaceActivationRef.current = null;
      return;
    }
    if (!showHome || !homeWorkspaceDefaultId) {
      pendingDefaultWorkspaceActivationRef.current = null;
      return;
    }
    if (pendingDefaultWorkspaceActivationRef.current === homeWorkspaceDefaultId) {
      return;
    }
    pendingDefaultWorkspaceActivationRef.current = homeWorkspaceDefaultId;
    setActiveWorkspaceId(homeWorkspaceDefaultId);
    setActiveThreadId(null, homeWorkspaceDefaultId);
  }, [
    activeWorkspaceId,
    homeWorkspaceDefaultId,
    setActiveThreadId,
    setActiveWorkspaceId,
    showHome,
  ]);
  useEffect(() => {
    if (
      !shouldHideHomeOnThreadActivation({
        homeOpen,
        activeThreadId,
      })
    ) {
      return;
    }
    setHomeOpen(false);
  }, [
    activeThreadId,
    homeOpen,
    setHomeOpen,
  ]);

  return {
    closePlanPanel,
    hasActivePlan,
    hasPlanData,
    isPlanMode,
    isPlanPanelDismissed,
    openPlanPanel,
    selectedKanbanTaskId,
    setIsPlanPanelDismissed,
    setSelectedKanbanTaskId,
    setWorkspaceHomeWorkspaceId,
    showGitHistory,
    showHome,
    showKanban,
    showPlugins,
    showWorkspaceHome,
    workspaceHomeWorkspaceId,
  };
}
