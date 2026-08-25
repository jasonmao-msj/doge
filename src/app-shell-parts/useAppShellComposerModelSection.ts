import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModelOption } from "../types";
import { useCollaborationModeSelection } from "../features/collaboration/hooks/useCollaborationModeSelection";
import { useComposerMenuActions } from "../features/composer/hooks/useComposerMenuActions";
import { useComposerShortcuts } from "../features/composer/hooks/useComposerShortcuts";
import { usePersistComposerSettings } from "../features/app/hooks/usePersistComposerSettings";
import {
  enrichScopedCodexReasoningMetadata,
  getEffectiveModels,
  getEffectiveReasoningOptions,
  getEffectiveReasoningSupported,
  getEffectiveSelectedEffort,
  getEffectiveSelectedModelId,
  getNextEngineSelectedModelId,
  getReasoningOptionsForModel,
  upsertEngineSelectedModelId,
} from "./modelSelection";
import { resolveClaudeManagedRuntimeModel } from "../features/models/claudeManagedRuntimeModel";
import { MANAGED_PROVIDER_PROFILE_ID_V1 } from "../features/account/runtime/engineEntitlementStore";

export function useAppShellComposerModelSection({
  accessMode,
  activeEngine,
  activeThreadId,
  activeProviderProfileId,
  activeWorkspaceId,
  appSettings,
  appSettingsLoading,
  applySelectedCollaborationMode,
  collaborationModes,
  composerInputRef,
  composerSelectionResolverRef,
  engineModelCatalogsAsOptions,
  engineModelsAsOptions,
  globalSelectionReady,
  handleSelectComposerSelection,
  handleSetAccessMode,
  models,
  modelsReady,
  persistComposerEnginePref,
  persistComposerSelectionForThread,
  queueSaveSettings,
  selectedCollaborationMode,
  selectedCollaborationModeId,
  selectedComposerSelection,
  selectedEffort,
  selectedModelId,
  setAppSettings,
  setSelectedEffort,
  setSelectedModelId,
}: any) {
  const [engineSelectedModelIdByType, setEngineSelectedModelIdByType] =
    useState<Record<string, string | null>>({});
  const activeEngineSelectedModelId = engineSelectedModelIdByType[activeEngine] ?? null;
  const effectiveModels = useMemo<ModelOption[]>(() => {
    if (
      activeEngine === "codex" &&
      activeThreadId !== null &&
      activeProviderProfileId?.trim()
    ) {
      return enrichScopedCodexReasoningMetadata(engineModelsAsOptions, models);
    }
    return getEffectiveModels(activeEngine, models, engineModelsAsOptions);
  }, [
    activeEngine,
    activeProviderProfileId,
    activeThreadId,
    models,
    engineModelsAsOptions,
  ]);
  const providerModelCatalogs = useMemo(
    () => ({
      ...(engineModelCatalogsAsOptions ?? {}),
      codex: activeEngine === "codex" ? effectiveModels : models,
    }),
    [activeEngine, effectiveModels, engineModelCatalogsAsOptions, models],
  );

  useEffect(() => {
    const nextDefault = getNextEngineSelectedModelId({
      activeEngine,
      engineModelsAsOptions,
      currentSelection: activeEngineSelectedModelId,
    });
    if (!nextDefault) {
      return;
    }
    setEngineSelectedModelIdByType((prev) => {
      return upsertEngineSelectedModelId({
        activeEngine,
        nextModelId: nextDefault,
        previousSelectionByEngine: prev,
      });
    });
  }, [activeEngine, engineModelsAsOptions, activeEngineSelectedModelId]);

  const hasActiveComposerThread = activeThreadId !== null;
  const effectiveSelectedModelId = useMemo(() => {
    return getEffectiveSelectedModelId({
      activeEngine,
      selectedModelId,
      activeThreadSelectedModelId: selectedComposerSelection?.modelId ?? null,
      hasActiveThread: hasActiveComposerThread,
      // Codex/Claude：允许会话级自由/自定义模型名（含本地配置、catalog 未登记项），
      // 避免 Atomic picker 选中后被 repair 静默回退。
      allowUnknownActiveThreadModel:
        activeEngine === "codex" ||
        activeEngine === "claude" ||
        (activeEngine === "kimi" &&
          activeProviderProfileId?.trim() === MANAGED_PROVIDER_PROFILE_ID_V1),
      codexModels: effectiveModels,
      engineModelsAsOptions,
      engineSelectedModelIdByType,
    });
  }, [
    activeEngine,
    activeProviderProfileId,
    effectiveModels,
    engineModelsAsOptions,
    engineSelectedModelIdByType,
    hasActiveComposerThread,
    selectedComposerSelection,
    selectedModelId,
  ]);
  const effectiveSelectedModel = useMemo(() => {
    return effectiveModels.find((model) => model.id === effectiveSelectedModelId) ?? null;
  }, [effectiveModels, effectiveSelectedModelId]);
  const persistedGlobalComposerModelId = useMemo(() => {
    return getEffectiveSelectedModelId({
      activeEngine: "codex",
      selectedModelId,
      activeThreadSelectedModelId: null,
      hasActiveThread: false,
      codexModels: models,
      engineModelsAsOptions: [],
      engineSelectedModelIdByType: {},
    });
  }, [models, selectedModelId]);
  const persistedGlobalComposerModel = useMemo(() => {
    return (
      models.find((model: any) => model.id === persistedGlobalComposerModelId) ?? null
    );
  }, [models, persistedGlobalComposerModelId]);
  const persistedGlobalComposerReasoningOptions = useMemo(() => {
    return getReasoningOptionsForModel(persistedGlobalComposerModel);
  }, [persistedGlobalComposerModel]);
  const persistedGlobalComposerEffort = useMemo(() => {
    return getEffectiveSelectedEffort({
      activeEngine: "codex",
      hasActiveThread: false,
      selectedEffort,
      activeThreadSelection: null,
      reasoningOptions: persistedGlobalComposerReasoningOptions,
    });
  }, [persistedGlobalComposerReasoningOptions, selectedEffort]);
  const modelReasoningOptions = useMemo(() => {
    return getReasoningOptionsForModel(effectiveSelectedModel);
  }, [effectiveSelectedModel]);
  const effectiveReasoningOptions = useMemo(() => {
    return getEffectiveReasoningOptions(activeEngine, modelReasoningOptions);
  }, [activeEngine, modelReasoningOptions]);
  const effectiveReasoningSupported = useMemo(() => {
    return getEffectiveReasoningSupported(activeEngine, modelReasoningOptions.length > 0);
  }, [activeEngine, modelReasoningOptions.length]);
  const effectiveSelectedEffort = useMemo(() => {
    return getEffectiveSelectedEffort({
      activeEngine,
      hasActiveThread: hasActiveComposerThread,
      selectedEffort,
      activeThreadSelection: selectedComposerSelection,
      reasoningOptions: effectiveReasoningOptions,
    });
  }, [
    activeEngine,
    effectiveReasoningOptions,
    hasActiveComposerThread,
    selectedEffort,
    selectedComposerSelection,
  ]);
  // Claude managed：按当前 catalog 重解析 runtime，避免 k3 等跨供应商残留上送。
  const claudeRuntimeResolution = useMemo(() => {
    if (activeEngine !== "claude") {
      return null;
    }
    return resolveClaudeManagedRuntimeModel({
      entryId: effectiveSelectedModelId,
      catalog: effectiveModels.map((model: ModelOption) => ({
        id: model.id,
        model: model.model,
        isDefault: Boolean(model.isDefault),
      })),
      fallbackRuntime:
        effectiveSelectedModel?.model ?? effectiveSelectedModelId ?? null,
    });
  }, [
    activeEngine,
    effectiveModels,
    effectiveSelectedModel?.model,
    effectiveSelectedModelId,
  ]);
  const resolvedModel =
    activeEngine === "claude"
      ? claudeRuntimeResolution?.runtime ?? null
      : (effectiveSelectedModel?.model ?? effectiveSelectedModelId ?? null);
  const resolvedModelSource = effectiveSelectedModel?.source ?? "unknown";
  // Codex: custom/catalog models may carry providerProfileId for first-send binding.
  // Claude (and others): MUST stay null here — session open / Shared hydrate /
  // Native create authority is thread or explicit provider pick, not reverse
  // inference from custom-model ownership metadata (custom-model-provider-binding).
  const resolvedProviderProfileId =
    activeEngine === "codex"
      ? (effectiveSelectedModel?.providerProfileId?.trim() || null)
      : null;
  const resolvedEffort = effectiveReasoningSupported ? effectiveSelectedEffort : null;
  const handleSelectModel = useCallback(
    (id: string | null) => {
      if (id === null) {
        return;
      }
      let targetEngine = activeEngine;
      let nextSelectedModel =
        effectiveModels.find((model) => model.id === id) ?? null;
      if (!nextSelectedModel) {
        // Cross-engine pick from the grouped provider dropdown: the engine
        // switch runs async, so resolve the owning engine catalog now and
        // store the selection under the target engine.
        for (const [engine, catalog] of Object.entries(providerModelCatalogs)) {
          if (engine === activeEngine) {
            continue;
          }
          const found =
            ((catalog as any[] | undefined) ?? []).find(
              (model: any) => model.id === id,
            ) ?? null;
          if (found) {
            targetEngine = engine;
            nextSelectedModel = found;
            break;
          }
        }
      }
      if (!nextSelectedModel) {
        // Atomic picker / 自定义模型：不因 effectiveModels 未收录而静默丢弃。
        // 单一会话点选时 catalog 与 picker 可能分叉（尤其 Codex 本地配置）。
        const freeformId = id.trim();
        if (!freeformId) {
          return;
        }
        nextSelectedModel = {
          id: freeformId,
          model: freeformId,
          displayName: freeformId,
          description: "",
          source: "custom",
          supportedReasoningEfforts: [],
          defaultReasoningEffort: null,
          isDefault: false,
        };
      }
      const isCrossEngineSelection = targetEngine !== activeEngine;
      const nextSelectedEffort =
        getEffectiveSelectedEffort({
          activeEngine: targetEngine,
          hasActiveThread: isCrossEngineSelection
            ? false
            : hasActiveComposerThread,
          selectedEffort: effectiveSelectedEffort,
          activeThreadSelection:
            !isCrossEngineSelection &&
            (hasActiveComposerThread ||
              activeEngine === "claude" ||
              activeEngine === "grok")
              ? {
                  modelId: nextSelectedModel.id,
                  effort: effectiveSelectedEffort,
                }
              : null,
          reasoningOptions: getEffectiveReasoningOptions(
            targetEngine,
            getReasoningOptionsForModel(nextSelectedModel),
          ),
        });
      if (import.meta.env.DEV) {
        console.info("[model/select]", {
          activeEngine: targetEngine,
          selectedModelId: nextSelectedModel.id,
        });
      }
      if (targetEngine === "codex") {
        if (isCrossEngineSelection || !hasActiveComposerThread) {
          setSelectedModelId(nextSelectedModel.id);
        }
      } else {
        // 幂等：id 未变不换 map 引用，避免父树无意义 rerender（#185）
        setEngineSelectedModelIdByType((prev) =>
          upsertEngineSelectedModelId({
            activeEngine: targetEngine,
            nextModelId: nextSelectedModel.id,
            previousSelectionByEngine: prev,
          }),
        );
        persistComposerEnginePref?.(targetEngine, {
          modelId: nextSelectedModel.id,
          effort: nextSelectedEffort,
        });
      }
      handleSelectComposerSelection({
        modelId: nextSelectedModel.id,
        effort: nextSelectedEffort,
      });
    },
    [
      activeEngine,
      effectiveModels,
      effectiveSelectedEffort,
      handleSelectComposerSelection,
      hasActiveComposerThread,
      persistComposerEnginePref,
      providerModelCatalogs,
      setSelectedModelId,
    ],
  );
  const handleSelectComposerEffort = useCallback(
    (effort: string | null) => {
      const nextEffort = getEffectiveSelectedEffort({
        activeEngine,
        hasActiveThread: hasActiveComposerThread,
        selectedEffort: effort,
        activeThreadSelection:
          hasActiveComposerThread ||
          activeEngine === "claude" ||
          activeEngine === "grok"
            ? {
                modelId: effectiveSelectedModelId,
                effort,
              }
            : null,
        reasoningOptions: effectiveReasoningOptions,
      });
      if (activeEngine === "codex" && !hasActiveComposerThread) {
        setSelectedEffort(nextEffort);
      } else if (activeEngine !== "codex") {
        persistComposerEnginePref?.(activeEngine, { effort: nextEffort });
      }
      handleSelectComposerSelection({
        modelId: effectiveSelectedModelId,
        effort: nextEffort,
      });
    },
    [
      activeEngine,
      effectiveSelectedModelId,
      effectiveReasoningOptions,
      handleSelectComposerSelection,
      hasActiveComposerThread,
      persistComposerEnginePref,
      setSelectedEffort,
    ],
  );
  const { collaborationModePayload } = useCollaborationModeSelection({
    selectedCollaborationMode,
    selectedCollaborationModeId,
    selectedEffort: resolvedEffort,
    resolvedModel,
  });
  const threadAccessMode = accessMode;
  const resolvedComposerModelId =
    activeEngine === "claude" && claudeRuntimeResolution?.entryId
      ? claudeRuntimeResolution.entryId
      : effectiveSelectedModelId;
  composerSelectionResolverRef.current = {
    id: resolvedComposerModelId,
    model: resolvedModel,
    source: resolvedModelSource,
    providerProfileId: resolvedProviderProfileId,
    effort: resolvedEffort,
    collaborationMode: collaborationModePayload,
  };
  // 注意：禁止在 effect 里对 Claude residual 自动 handleSelectModel。
  // allowUnknown 下 effectiveSelectedModelId 可长期停在 k3，而 resolver 的 entryId
  // 是 catalog 默认 → effect 会无限 setState（React #185 / AP-04）。
  // 发送侧已用 resolvedModel 纠正 runtime；UI 点选/续接取消 activate 再收敛展示。
  // 会话选择修复：仅在 effective 与已存选择语义不一致时写回。
  // freeform（allowUnknown）会保留 catalog 外 modelId——这是业务能力，不是 #185 缺口；
  // 这里只收敛 effort/model 的有效投影，禁止无变化 persist 触发反馈环。
  useEffect(() => {
    if (
      activeEngine !== "codex" ||
      !activeThreadId ||
      !selectedComposerSelection ||
      !modelsReady
    ) {
      return;
    }
    const nextSelection = {
      modelId: effectiveSelectedModelId,
      effort: effectiveSelectedEffort,
    };
    const needsModelRepair =
      selectedComposerSelection.modelId !== nextSelection.modelId;
    const needsEffortRepair =
      selectedComposerSelection.effort !== nextSelection.effort;
    if (!needsModelRepair && !needsEffortRepair) {
      return;
    }
    persistComposerSelectionForThread(activeWorkspaceId, activeThreadId, nextSelection);
  }, [
    activeEngine,
    activeThreadId,
    activeWorkspaceId,
    effectiveSelectedEffort,
    effectiveSelectedModelId,
    modelsReady,
    persistComposerSelectionForThread,
    selectedComposerSelection,
  ]);
  usePersistComposerSettings({
    enabled: !hasActiveComposerThread,
    appSettingsLoading,
    selectionReady: globalSelectionReady,
    selectedModelId: persistedGlobalComposerModelId,
    selectedEffort: persistedGlobalComposerEffort,
    setAppSettings,
    queueSaveSettings,
  });
  useComposerShortcuts({
    textareaRef: composerInputRef,
    modelShortcut: appSettings.composerModelShortcut,
    accessShortcut: appSettings.composerAccessShortcut,
    reasoningShortcut: appSettings.composerReasoningShortcut,
    collaborationShortcut: appSettings.composerCollaborationShortcut,
    models: effectiveModels,
    collaborationModes,
    selectedModelId: effectiveSelectedModelId,
    onSelectModel: handleSelectModel,
    selectedCollaborationModeId,
    onSelectCollaborationMode: applySelectedCollaborationMode,
    accessMode,
    onSelectAccessMode: handleSetAccessMode,
    reasoningOptions: effectiveReasoningOptions,
    selectedEffort: effectiveSelectedEffort,
    onSelectEffort: handleSelectComposerEffort,
    reasoningSupported: effectiveReasoningSupported,
  });
  useComposerMenuActions({
    models: effectiveModels,
    selectedModelId: effectiveSelectedModelId,
    onSelectModel: handleSelectModel,
    collaborationModes,
    selectedCollaborationModeId,
    onSelectCollaborationMode: applySelectedCollaborationMode,
    accessMode,
    onSelectAccessMode: handleSetAccessMode,
    reasoningOptions: effectiveReasoningOptions,
    selectedEffort: effectiveSelectedEffort,
    onSelectEffort: handleSelectComposerEffort,
    reasoningSupported: effectiveReasoningSupported,
    onFocusComposer: () => composerInputRef.current?.focus(),
  });

  return {
    collaborationModePayload,
    effectiveModels,
    effectiveReasoningOptions,
    effectiveReasoningSupported,
    effectiveSelectedEffort,
    effectiveSelectedModel,
    effectiveSelectedModelId,
    engineSelectedModelIdByType,
    handleSelectComposerEffort,
    handleSelectModel,
    providerModelCatalogs,
    resolvedEffort,
    resolvedModel,
    setEngineSelectedModelIdByType,
    threadAccessMode,
  };
}
