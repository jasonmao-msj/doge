import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DebugEntry,
  CodexDoctorResult,
  EngineModelInfo,
  EngineStatus,
  EngineType,
  WorkspaceInfo,
} from "../../../types";
import {
  detectEngines,
  getActiveEngine,
  getEngineModels,
  isWebServiceRuntime,
  runCodexDoctor,
  switchEngine,
} from "../../../services/tauri";
import { startupOrchestrator } from "../../startup-orchestration/utils/startupOrchestrator";
import {
  buildAvailableEngines,
  applyManagedCodexStatus,
  ENABLED_ENGINE_TYPES,
  type EngineDisplayInfo,
} from "./engineControllerAvailability";
import {
  areEngineModelCatalogsEqual,
  engineModelToOption,
  normalizeEngineModelEntry,
  projectActiveEngineModels,
  projectEngineModelCatalogs,
} from "./engineControllerCatalog";
import {
  buildCodexSwitchUnavailablePayload,
  persistEngineSelection,
  readPersistedEngineSelection,
} from "./engineControllerSelection";
import {
  WEB_RUNTIME_DEFAULT_ENGINE,
  WEB_RUNTIME_INITIAL_STATUSES,
} from "./engineControllerWebRuntime";
import { useEngineRuntimeNotices } from "./useEngineRuntimeNotices";
import { useEngineCatalogRevision } from "./useEngineCatalogRevision";
import { isManagedProviderProfileIdV1 } from "../../account/runtime/engineEntitlementStore";
import {
  createManagedEngineToolchainClientV1,
  type ManagedEngineToolchainResultV1,
} from "../../account/runtime/managedEngineToolchain";

export type { EngineDisplayInfo } from "./engineControllerAvailability";

type UseEngineControllerOptions = {
  activeWorkspace: WorkspaceInfo | null;
  onDebug?: (entry: DebugEntry) => void;
};

type RefreshEngineModelsOptions = {
  forceRefresh?: boolean;
  phase?: "idle-prewarm" | "on-demand";
  providerProfileId?: string | null;
};

const managedToolchain = createManagedEngineToolchainClientV1();

async function inspectManagedCodex(
  onDebug?: (entry: DebugEntry) => void,
): Promise<ManagedEngineToolchainResultV1 | null> {
  if (isWebServiceRuntime()) {
    return null;
  }
  try {
    return await managedToolchain.inspect("codex");
  } catch (error) {
    // Older/native runtimes may not expose the managed toolchain command yet.
    onDebug?.({
      id: `${Date.now()}-managed-codex-inspect-error`,
      timestamp: Date.now(),
      source: "error",
      label: "engine/managed codex inspect error",
      payload: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export type EngineRefreshResult = {
  availableEngines: EngineDisplayInfo[];
  activeEngine: EngineType;
};

/**
 * Hook for managing multi-engine state and selection
 */
export function useEngineController({
  activeWorkspace,
  onDebug,
}: UseEngineControllerOptions) {
  // Engine detection state
  const [engineStatuses, setEngineStatuses] = useState<EngineStatus[]>(() =>
    isWebServiceRuntime() ? WEB_RUNTIME_INITIAL_STATUSES : [],
  );
  // 首屏直接读 client store，避免默认 claude 抢先渲染后再异步 restore 造成首页闪回。
  const [activeEngine, setActiveEngineState] = useState<EngineType>(() =>
    isWebServiceRuntime()
      ? WEB_RUNTIME_DEFAULT_ENGINE
      : (readPersistedEngineSelection() ?? "claude"),
  );
  const [engineModels, setEngineModels] = useState<EngineModelInfo[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const customModelsVersion = useEngineCatalogRevision();

  // Track initialization
  const initRef = useRef(false);
  const detectPromiseRef = useRef<Promise<EngineRefreshResult | void> | null>(null);
  const visibleCatalogRequestKeyRef = useRef<string | null>(null);
  const lastGoodModelsByScopeRef = useRef(new Map<string, EngineModelInfo[]>());
  const lastWorkspaceId = useRef<string | null>(null);
  const workspaceId = activeWorkspace?.id ?? null;
  const isConnected = Boolean(activeWorkspace?.connected);
  const enabledEngineTypes = ENABLED_ENGINE_TYPES;

  const loadModelsForEngine = useCallback(
    async (
      engineType: EngineType,
      fallbackModels: EngineModelInfo[] = [],
      options: RefreshEngineModelsOptions = {},
    ) => {
      if (!enabledEngineTypes.includes(engineType)) {
        return [];
      }
      const providerProfileId = options.providerProfileId?.trim() || null;
      const managedProviderScope = isManagedProviderProfileIdV1(providerProfileId);
      const catalogScope = providerProfileId ?? "__global__";
      const catalogRequestKey = `${engineType}:${catalogScope}`;
      const previousCatalogRequestKey = visibleCatalogRequestKeyRef.current;
      visibleCatalogRequestKeyRef.current = catalogRequestKey;
      const scopedFallbackModels = providerProfileId && !managedProviderScope
        ? (lastGoodModelsByScopeRef.current.get(catalogRequestKey) ?? [])
        : fallbackModels;
      const effectiveScopedFallbackModels = managedProviderScope ? [] : scopedFallbackModels;
      if (previousCatalogRequestKey !== catalogRequestKey) {
        setEngineModels(effectiveScopedFallbackModels.map((model) => normalizeEngineModelEntry(model)));
      }
      try {
        const phase = options.phase ?? (options.forceRefresh ? "on-demand" : "idle-prewarm");
        const models = await startupOrchestrator.run({
          id: `engine-models:${engineType}:${catalogScope}`,
          phase,
          priority: phase === "on-demand" ? 85 : 30,
          dedupeKey: `engine-models:${engineType}:${catalogScope}:${options.forceRefresh ? "force" : "cached"}`,
          concurrencyKey: "engine-model-catalog",
          timeoutMs: 8_000,
          workspaceScope: "global",
          cancelPolicy: "yield-only",
          traceLabel: "engine/models",
          commandLabel: "get_engine_models",
          run: () => {
            if (providerProfileId) {
              return getEngineModels(engineType, {
                ...(options.forceRefresh ? { forceRefresh: true } : {}),
                providerProfileId,
              });
            }
            return options.forceRefresh
              ? getEngineModels(engineType, { forceRefresh: true })
              : getEngineModels(engineType);
          },
          fallback: () => effectiveScopedFallbackModels,
        });
        const sourceModels =
          models.length > 0 || options.forceRefresh || providerProfileId
            ? models
            : fallbackModels;
        const nextModels = sourceModels.map((model) =>
          normalizeEngineModelEntry(
            managedProviderScope && !model.providerProfileId?.trim()
              ? { ...model, providerProfileId }
              : model,
          ),
        );
        lastGoodModelsByScopeRef.current.set(catalogRequestKey, nextModels);
        if (visibleCatalogRequestKeyRef.current === catalogRequestKey) {
          setEngineModels((currentModels) =>
            areEngineModelCatalogsEqual(currentModels, nextModels)
              ? currentModels
              : nextModels,
          );
        }
        return nextModels;
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-engine-models-load-error`,
          timestamp: Date.now(),
          source: "error",
          label: "engine/models load error",
          payload: {
            engine: engineType,
            providerProfileId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        if (managedProviderScope) {
          lastGoodModelsByScopeRef.current.delete(catalogRequestKey);
        }
        const normalizedFallback = effectiveScopedFallbackModels.map((model) => normalizeEngineModelEntry(model));
        if (visibleCatalogRequestKeyRef.current === catalogRequestKey) {
          setEngineModels((currentModels) =>
            areEngineModelCatalogsEqual(currentModels, normalizedFallback)
              ? currentModels
              : normalizedFallback,
          );
        }
        return normalizedFallback;
      }
    },
    [enabledEngineTypes, onDebug],
  );

  const refreshEngineModels = useCallback(
    async (
      engineType: EngineType,
      options: RefreshEngineModelsOptions = {},
    ) => {
      if (!enabledEngineTypes.includes(engineType)) {
        return;
      }
      const status = engineStatuses.find((entry) => entry.engineType === engineType);
      if (!status?.installed) {
        return;
      }
      const nextModels = await loadModelsForEngine(
        engineType,
        status.models,
        options,
      );
      if (
        options.forceRefresh &&
        !options.providerProfileId?.trim() &&
        nextModels.length > 0
      ) {
        setEngineStatuses((currentStatuses) =>
          currentStatuses.map((entry) =>
            entry.engineType === engineType
              ? { ...entry, models: nextModels }
              : entry,
          ),
        );
      }
    },
    [enabledEngineTypes, engineStatuses, loadModelsForEngine],
  );

  /**
   * Detect all installed engines
   */
  const refreshEngines = useCallback(async () => {
    if (detectPromiseRef.current) {
      return await detectPromiseRef.current;
    }

    const detectPromise = (async () => {
      setIsDetecting(true);

      onDebug?.({
        id: `${Date.now()}-engine-detect`,
        timestamp: Date.now(),
        source: "client",
        label: "engine/detect",
        payload: {},
      });

      try {
        const [rawStatuses, detectedEngine, managedCodexStatus] = await Promise.all([
          detectEngines(),
          getActiveEngine(),
          inspectManagedCodex(onDebug),
        ]);
        const statuses = applyManagedCodexStatus(
          rawStatuses.filter((status) =>
            enabledEngineTypes.includes(status.engineType),
          ),
          managedCodexStatus,
        );

        let nextActiveEngine = detectedEngine;
        const detectedEngineInstalled = Boolean(
          statuses.find((status) => status.engineType === detectedEngine)?.installed,
        );
        if (!enabledEngineTypes.includes(detectedEngine) || !detectedEngineInstalled) {
          nextActiveEngine =
            statuses.find((status) => status.installed)?.engineType ??
            enabledEngineTypes[0] ??
            "claude";
        }
        const persistedEngine = readPersistedEngineSelection();
        const persistedEngineInstalled = persistedEngine
          ? Boolean(
              statuses.find((status) => status.engineType === persistedEngine)
                ?.installed,
            )
          : false;
        if (
          persistedEngine &&
          enabledEngineTypes.includes(persistedEngine) &&
          persistedEngineInstalled &&
          persistedEngine !== detectedEngine
        ) {
          try {
            await switchEngine(persistedEngine);
            nextActiveEngine = persistedEngine;
          } catch (error) {
            onDebug?.({
              id: `${Date.now()}-engine-restore-selection-error`,
              timestamp: Date.now(),
              source: "error",
              label: "engine/restore persisted selection error",
              payload: {
                engine: persistedEngine,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          }
        }
        const nextActiveEngineInstalled = Boolean(
          statuses.find((status) => status.engineType === nextActiveEngine)?.installed,
        );
        if (
          nextActiveEngine !== detectedEngine &&
          nextActiveEngineInstalled &&
          persistedEngine !== nextActiveEngine
        ) {
          try {
            await switchEngine(nextActiveEngine);
          } catch (error) {
            onDebug?.({
              id: `${Date.now()}-engine-normalize-active-error`,
              timestamp: Date.now(),
              source: "error",
              label: "engine/normalize active engine error",
              payload: {
                from: detectedEngine,
                to: nextActiveEngine,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          }
        }

        onDebug?.({
          id: `${Date.now()}-engine-detect-result`,
          timestamp: Date.now(),
          source: "server",
          label: "engine/detect response",
          payload: { statuses, currentEngine: nextActiveEngine },
        });

        const nextAvailableEngines = buildAvailableEngines(statuses, true);

        setEngineStatuses(statuses);
        setActiveEngineState(nextActiveEngine);
        setIsInitialized(true);

        // Get models from the detected status first.
        const currentStatus = statuses.find((s) => s.engineType === nextActiveEngine);
        if (currentStatus?.installed && currentStatus.models.length > 0) {
          setEngineModels(
            currentStatus.models.map((model) => normalizeEngineModelEntry(model)),
          );
        } else {
          setEngineModels([]);
        }

        // For OpenCode, always refresh from CLI model list to ensure "all models"
        // are shown independent of provider login status.
        if (currentStatus?.installed && nextActiveEngine !== "opencode") {
          await loadModelsForEngine(nextActiveEngine, currentStatus.models);
        }

        return {
          availableEngines: nextAvailableEngines,
          activeEngine: nextActiveEngine,
        };
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-engine-detect-error`,
          timestamp: Date.now(),
          source: "error",
          label: "engine/detect error",
          payload: error instanceof Error ? error.message : String(error),
        });
      } finally {
        detectPromiseRef.current = null;
        setIsDetecting(false);
      }
    })();

    detectPromiseRef.current = detectPromise;
    return await detectPromise;
  }, [enabledEngineTypes, loadModelsForEngine, onDebug]);

  /**
   * Switch to a different engine
   */
  const setActiveEngine = useCallback(
    async (engineType: EngineType) => {
      const enabled = enabledEngineTypes.includes(engineType);
      if (!enabled) {
        onDebug?.({
          id: `${Date.now()}-engine-switch-error`,
          timestamp: Date.now(),
          source: "error",
          label: "engine/switch error",
          payload: `Engine ${engineType} is disabled`,
        });
        return;
      }
      if (engineType === activeEngine) {
        return;
      }

      let targetStatus =
        engineStatuses.find((status) => status.engineType === engineType) ??
        null;
      if (!targetStatus?.installed) {
        try {
          const refreshedStatuses = applyManagedCodexStatus(
            (await detectEngines()).filter((status) =>
              enabledEngineTypes.includes(status.engineType),
            ),
            await inspectManagedCodex(onDebug),
          );
          setEngineStatuses(refreshedStatuses);
          targetStatus =
            refreshedStatuses.find(
              (status) => status.engineType === engineType,
            ) ?? null;
        } catch (error) {
          onDebug?.({
            id: `${Date.now()}-engine-detect-error-before-switch`,
            timestamp: Date.now(),
            source: "error",
            label: "engine/detect error",
            payload: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (!targetStatus?.installed && engineType === "codex") {
        let doctorResult: CodexDoctorResult | null = null;
        let doctorError: unknown = null;
        try {
          doctorResult = await runCodexDoctor(null, null);
        } catch (error) {
          doctorError = error;
        }
        onDebug?.({
          id: `${Date.now()}-engine-switch-error`,
          timestamp: Date.now(),
          source: "error",
          label: "engine/switch error",
          payload: buildCodexSwitchUnavailablePayload(doctorResult, doctorError),
        });
        return;
      }

      if (!targetStatus?.installed) {
        onDebug?.({
          id: `${Date.now()}-engine-switch-error`,
          timestamp: Date.now(),
          source: "error",
          label: "engine/switch error",
          payload: `Engine ${engineType} is not installed`,
        });
        return;
      }

      onDebug?.({
        id: `${Date.now()}-engine-switch`,
        timestamp: Date.now(),
        source: "client",
        label: "engine/switch",
        payload: { from: activeEngine, to: engineType },
      });

      try {
        await switchEngine(engineType);
        setActiveEngineState(engineType);
        persistEngineSelection(engineType);
        // Immediately switch visible model list to target engine snapshot to avoid
        // showing stale models from previous engine while CLI refresh is in flight.
        setEngineModels(
          targetStatus.models.length > 0
            ? targetStatus.models.map((model) => normalizeEngineModelEntry(model))
            : [],
        );

        // Always refresh models from CLI and keep status models as fallback.
        await refreshEngineModels(engineType);

        onDebug?.({
          id: `${Date.now()}-engine-switch-success`,
          timestamp: Date.now(),
          source: "server",
          label: "engine/switch success",
          payload: { engine: engineType, models: targetStatus.models },
        });
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-engine-switch-error`,
          timestamp: Date.now(),
          source: "error",
          label: "engine/switch error",
          payload: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeEngine, enabledEngineTypes, engineStatuses, onDebug, refreshEngineModels],
  );

  /**
   * Get display information for all engines
   */
  const availableEngines = useMemo(
    () => buildAvailableEngines(engineStatuses, isInitialized),
    [engineStatuses, isInitialized],
  );

  /**
   * Get display information for installed engines only
   */
  const installedEngines = useMemo((): EngineDisplayInfo[] => {
    return availableEngines.filter((e) => e.installed);
  }, [availableEngines]);

  /**
   * Get current engine status
   */
  const currentEngineStatus = useMemo((): EngineStatus | null => {
    return engineStatuses.find((s) => s.engineType === activeEngine) ?? null;
  }, [engineStatuses, activeEngine]);

  /**
   * Get current engine display info
   */
  const currentEngineDisplay = useMemo((): EngineDisplayInfo | null => {
    return availableEngines.find((e) => e.type === activeEngine) ?? null;
  }, [availableEngines, activeEngine]);

  /**
   * Check if multiple engines are available
   */
  const hasMultipleEngines = useMemo(() => {
    return installedEngines.length > 1;
  }, [installedEngines]);

  const mappedEngineModels = useMemo(
    () => projectActiveEngineModels(activeEngine, engineModels),
    [activeEngine, engineModels, customModelsVersion],
  );

  /**
   * Convert engine models to ModelOption format for UI compatibility
   */
  const engineModelsAsOptions = useMemo(
    () => mappedEngineModels.map(engineModelToOption),
    [mappedEngineModels],
  );

  const engineModelCatalogsAsOptions = useMemo(
    () =>
      projectEngineModelCatalogs(
        engineStatuses,
        activeEngine,
        mappedEngineModels,
      ),
    [activeEngine, customModelsVersion, engineStatuses, mappedEngineModels],
  );

  // Initialize on mount
  useEffect(() => {
    if (initRef.current) {
      return;
    }
    initRef.current = true;
    refreshEngines();
  }, [refreshEngines]);

  // Reset models when workspace changes
  useEffect(() => {
    if (workspaceId === lastWorkspaceId.current) {
      return;
    }
    lastWorkspaceId.current = workspaceId;
    // Optionally refresh models when workspace changes
    if (workspaceId && isConnected && currentEngineStatus?.installed) {
      void refreshEngineModels(activeEngine);
    }
  }, [
    workspaceId,
    isConnected,
    activeEngine,
    currentEngineStatus?.installed,
    refreshEngineModels,
  ]);

  useEngineRuntimeNotices(availableEngines, isInitialized);

  return useMemo(
    () => ({
      activeEngine,
      engineStatuses,
      engineModels,
      engineModelsAsOptions,
      engineModelCatalogsAsOptions,
      isDetecting,
      isInitialized,
      availableEngines,
      installedEngines,
      currentEngineStatus,
      currentEngineDisplay,
      hasMultipleEngines,
      setActiveEngine,
      refreshEngines,
      refreshEngineModels,
    }),
    [
      activeEngine,
      availableEngines,
      currentEngineDisplay,
      currentEngineStatus,
      engineModelCatalogsAsOptions,
      engineModels,
      engineModelsAsOptions,
      engineStatuses,
      hasMultipleEngines,
      installedEngines,
      isDetecting,
      isInitialized,
      refreshEngineModels,
      refreshEngines,
      setActiveEngine,
    ],
  );
}
