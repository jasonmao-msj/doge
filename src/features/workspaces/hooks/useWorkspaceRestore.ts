import { useEffect, useRef } from "react";
import type { WorkspaceInfo } from "../../../types";

type WorkspaceRestoreOptions = {
  workspaces: WorkspaceInfo[];
  hasLoaded: boolean;
  activeWorkspaceId: string | null;
  restoreThreadsOnlyOnLaunch: boolean;
  listThreadsForWorkspace: (
    workspace: WorkspaceInfo,
    options?: {
      preserveState?: boolean;
      includeOpenCodeSessions?: boolean;
      recoverySource?: "workspace-restore";
      allowRuntimeReconnect?: boolean;
    },
  ) => Promise<unknown>;
};

export function useWorkspaceRestore({
  workspaces,
  hasLoaded,
  activeWorkspaceId,
  restoreThreadsOnlyOnLaunch,
  listThreadsForWorkspace,
}: WorkspaceRestoreOptions) {
  const restoredWorkspaces = useRef(new Set<string>());
  const restoringWorkspaces = useRef(new Set<string>());

  useEffect(() => {
    if (!hasLoaded) {
      return;
    }
    // Cold-start: only restore the active workspace thread list.
    // Expanding every non-collapsed workspace here dual-scanned first-paint
    // (doge + 内容分析) and blocked the active path for multi-seconds.
    // Non-active workspaces hydrate after startup-gate via idle prewarm / focus.
    const pending = workspaces.filter((workspace) => {
      if (restoredWorkspaces.current.has(workspace.id)) {
        return false;
      }
      if (restoringWorkspaces.current.has(workspace.id)) {
        return false;
      }
      if (!activeWorkspaceId) {
        return false;
      }
      return workspace.id === activeWorkspaceId;
    });
    if (pending.length === 0) {
      return;
    }
    pending.forEach((workspace) => {
      restoringWorkspaces.current.add(workspace.id);
    });
    const active = pending.find((w) => w.id === activeWorkspaceId);
    const rest = pending.filter((w) => w.id !== activeWorkspaceId);
    let cancelled = false;
    const restoreOne = async (workspace: WorkspaceInfo) => {
      if (cancelled) {
        return;
      }
      try {
        await listThreadsForWorkspace(workspace, {
          recoverySource: "workspace-restore",
          allowRuntimeReconnect: !restoreThreadsOnlyOnLaunch,
        });
        // A rerender may cancel the current effect while the in-flight restore
        // still succeeds. Keep the success marker so we do not restart the same
        // workspace restore loop on every workspace refresh.
        restoredWorkspaces.current.add(workspace.id);
      } finally {
        restoringWorkspaces.current.delete(workspace.id);
      }
    };
    void (async () => {
      if (active) {
        await restoreOne(active).catch(() => {
          // Silent: connection errors show in debug panel.
        });
      }
      await Promise.allSettled(
        rest.map((workspace) =>
          restoreOne(workspace).catch(() => {
            // Silent: connection errors show in debug panel.
          }),
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeWorkspaceId,
    hasLoaded,
    listThreadsForWorkspace,
    restoreThreadsOnlyOnLaunch,
    workspaces,
  ]);
}
