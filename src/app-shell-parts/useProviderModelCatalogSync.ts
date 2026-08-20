import { useEffect, useRef, useSyncExternalStore } from "react";
import type { useEngineController } from "../features/engine/hooks/useEngineController";
import type { DebugEntry, EngineType } from "../types";
import {
  activateEngineProviderProfileAndNotify,
  isActivatableProviderEngine,
} from "../features/vendors/activateEngineProviderProfile";
import {
  managedEngineIdForRuntimeV1,
  MANAGED_PROVIDER_PROFILE_ID_V1,
  readManagedEnginePreparationV1,
  subscribeManagedEnginePreparationV1,
} from "../features/account/runtime/engineEntitlementStore";

type EngineControllerSection = ReturnType<typeof useEngineController>;

type ProviderModelCatalogSyncParams = {
  activeEngine: EngineType;
  activeThreadEngineSource: EngineType | null | undefined;
  activeThreadId: string | null | undefined;
  activeWorkspaceId: string | null | undefined;
  providerProfileId: string | null | undefined;
  addDebugEntry: (entry: DebugEntry) => void;
  refreshEngineModels: EngineControllerSection["refreshEngineModels"];
};

const PROVIDER_SCOPED_ENGINES = new Set<EngineType>([
  "claude",
  "codex",
  "grok",
  "kimi",
  "opencode",
]);

/**
 * 切到会话时：
 * 1) 按该会话创建时的 providerProfileId 刷新 provider-scoped model catalog
 * 2) 同步 L1「使用中」+ Claude 模型映射（不盖盘）——老会话 m3/k3 切换自动适配 UI
 * 发送仍以 thread.providerProfileId 为准，不因 L1 切换改写 binding。
 */
export function useProviderModelCatalogSync({
  activeEngine,
  activeThreadEngineSource,
  activeThreadId,
  activeWorkspaceId,
  providerProfileId,
  addDebugEntry,
  refreshEngineModels,
}: ProviderModelCatalogSyncParams) {
  const activeCatalogKeyRef = useRef<string | null>(null);
  const managedPreparation = useSyncExternalStore(
    subscribeManagedEnginePreparationV1,
    readManagedEnginePreparationV1,
    readManagedEnginePreparationV1,
  );

  useEffect(() => {
    const normalizedThreadId = activeThreadId?.trim();
    const hasActiveThread = Boolean(normalizedThreadId);
    const requestedProviderProfileId = providerProfileId?.trim() || null;
    const managedEngineId = managedEngineIdForRuntimeV1(activeEngine);
    const preparedManagedEngine =
      !hasActiveThread &&
      managedEngineId !== null &&
      managedPreparation[managedEngineId] === "prepared" &&
      (requestedProviderProfileId === null ||
        requestedProviderProfileId === MANAGED_PROVIDER_PROFILE_ID_V1);
    const normalizedProviderProfileId =
      requestedProviderProfileId ??
      (preparedManagedEngine ? MANAGED_PROVIDER_PROFILE_ID_V1 : null);
    const catalogEngine =
      activeThreadEngineSource ??
      (hasActiveThread
        ? (normalizedProviderProfileId ? null : activeEngine)
        : (preparedManagedEngine ? activeEngine : null));
    if (!hasActiveThread && !preparedManagedEngine) {
      // A signed-out/account-replaced preparation snapshot must release the
      // old key so the next account can refresh the same managed scope.
      activeCatalogKeyRef.current = null;
      return;
    }
    if (
      !catalogEngine ||
      !PROVIDER_SCOPED_ENGINES.has(catalogEngine)
    ) {
      return;
    }
    const catalogKey = `${activeWorkspaceId ?? "unknown"}:${catalogEngine}:${
      normalizedProviderProfileId ?? "__global__"
    }`;
    if (activeCatalogKeyRef.current === catalogKey) {
      return;
    }
    activeCatalogKeyRef.current = catalogKey;
    addDebugEntry({
      id: `${Date.now()}-provider-model-catalog-sync`,
      timestamp: Date.now(),
      source: "client",
      label: "engine/models sync active provider",
      payload: {
        workspaceId: activeWorkspaceId,
        threadId: normalizedThreadId,
        engine: catalogEngine,
        providerProfileId: normalizedProviderProfileId,
      },
    });

    // 有会话绑定 profile 时：对齐 L1 启动配置 + 模型映射（老会话切换适配）
    // 无 profile 的遗留会话：不强制 switch，仅刷全局 catalog
    if (
      hasActiveThread &&
      normalizedProviderProfileId &&
      isActivatableProviderEngine(catalogEngine)
    ) {
      void activateEngineProviderProfileAndNotify(
        catalogEngine,
        normalizedProviderProfileId,
      ).catch((error: unknown) => {
        addDebugEntry({
          id: `${Date.now()}-provider-activate-on-thread-switch-error`,
          timestamp: Date.now(),
          source: "error",
          label: "engine/provider activate on thread switch failed",
          payload: {
            engine: catalogEngine,
            providerProfileId: normalizedProviderProfileId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      });
    }

    void refreshEngineModels(catalogEngine, {
      providerProfileId: normalizedProviderProfileId,
      forceRefresh: true,
      phase: "on-demand",
    });
  }, [
    activeEngine,
    activeThreadEngineSource,
    activeThreadId,
    activeWorkspaceId,
    addDebugEntry,
    providerProfileId,
    refreshEngineModels,
    managedPreparation,
  ]);
}
