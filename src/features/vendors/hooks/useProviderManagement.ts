import { useState, useCallback, useEffect, useMemo } from "react";
import type {
  ClaudeCurrentConfig,
  CodexCustomModel,
  ProviderConfig,
} from "../types";
import {
  LOCAL_SETTINGS_PROVIDER_ID,
  STORAGE_KEYS,
  validateShapeOnlyCustomModels,
} from "../types";
import {
  getClaudeProviders,
  addClaudeProvider,
  updateClaudeProvider,
  deleteClaudeProvider,
  reorderClaudeProviders,
  getCurrentClaudeConfig,
  switchClaudeProvider,
} from "../../../services/tauri";
import {
  migrateModelMappingStorage,
  syncModelMappingFromProviderEnv,
} from "../../models/constants";
import { applyOptimisticActiveProvider } from "../applyOptimisticActiveProvider";
import { VENDOR_ACTIVE_PROVIDER_CHANGED_EVENT } from "../vendorActiveProviderEvents";
import { notifyProviderTargetCatalogChanged } from "../../composer/components/ChatInputBox/hooks/useProviderTargetCatalogOwners";
import { normalizeProviderProfileId } from "../customModelProviderBinding";

/** List/config load options. `silent` skips list-level loading UI (switch / external events). */
export type ProviderLoadOptions = {
  silent?: boolean;
};

export interface ProviderDialogState {
  isOpen: boolean;
  provider: ProviderConfig | null;
}

export interface DeleteConfirmState {
  isOpen: boolean;
  provider: ProviderConfig | null;
}

export type ClaudeProviderAction =
  | "load"
  | "save"
  | "reorder"
  | "delete"
  | "switch"
  | "storage";

export type ClaudeProviderActionError = Readonly<{
  action: ClaudeProviderAction;
  message: string;
  cause: unknown;
}>;

export type ClaudeProviderActionResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; error: ClaudeProviderActionError }>;

function providerActionError(
  action: ClaudeProviderAction,
  cause: unknown,
): ClaudeProviderActionError {
  const detail =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : "Unknown error";
  return Object.freeze({
    action,
    message: `Claude provider ${action} failed: ${detail}`,
    cause,
  });
}

function readStoredClaudeCustomModels(): CodexCustomModel[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  const rawValue = window.localStorage.getItem(STORAGE_KEYS.CLAUDE_CUSTOM_MODELS);
  if (!rawValue) {
    return [];
  }
  try {
    return validateShapeOnlyCustomModels(JSON.parse(rawValue));
  } catch {
    return [];
  }
}

function normalizeClaudeProviderCustomModels(
  providers: ProviderConfig[],
): CodexCustomModel[] {
  const mergedModels: CodexCustomModel[] = [];
  const seenIds = new Set<string>();

  for (const provider of providers) {
    if (provider.isLocalProvider || provider.id === LOCAL_SETTINGS_PROVIDER_ID) {
      continue;
    }
    const providerModels = validateShapeOnlyCustomModels(
      provider.customModels ?? [],
    );
    for (const providerModel of providerModels) {
      const id = providerModel.id.trim();
      if (!id || seenIds.has(id)) {
        continue;
      }
      seenIds.add(id);
      const label = providerModel.label?.trim() || id;
      const description = providerModel.description?.trim();
      const providerProfileId = provider.id.trim();
      mergedModels.push({
        id,
        label,
        description:
          description && description.length > 0 ? description : undefined,
        providerProfileId:
          providerProfileId.length > 0 ? providerProfileId : undefined,
      });
    }
  }

  return mergedModels;
}

/**
 * Merge Claude provider-owned custom models into the engine localStorage catalog
 * (symmetric with mergeCodexProviderCustomModelsIntoStore).
 */
export function mergeClaudeProviderCustomModelsIntoStore(
  providers: ProviderConfig[],
): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  const providerModels = normalizeClaudeProviderCustomModels(providers);
  if (providerModels.length === 0) {
    return;
  }

  const storedModels = readStoredClaudeCustomModels();
  const originById = new Map<string, string>();
  for (const model of providerModels) {
    const id = model.id.trim();
    const profileId = normalizeProviderProfileId(model.providerProfileId);
    if (id && profileId) {
      originById.set(id, profileId);
    }
  }

  const enrichedStoredModels = storedModels.map((model) => {
    if (normalizeProviderProfileId(model.providerProfileId)) {
      return model;
    }
    const providerProfileId = originById.get(model.id.trim());
    return providerProfileId ? { ...model, providerProfileId } : model;
  });
  const storedIds = new Set(storedModels.map((model) => model.id.trim()));
  const missingProviderModels = providerModels.filter(
    (model) => !storedIds.has(model.id.trim()),
  );

  const didEnrich = enrichedStoredModels.some(
    (model, index) =>
      model.providerProfileId !== storedModels[index]?.providerProfileId,
  );
  if (missingProviderModels.length === 0 && !didEnrich) {
    return;
  }

  const nextModels = [...enrichedStoredModels, ...missingProviderModels];
  try {
    window.localStorage.setItem(
      STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
      JSON.stringify(nextModels),
    );
    window.dispatchEvent(
      new CustomEvent("localStorageChange", {
        detail: { key: STORAGE_KEYS.CLAUDE_CUSTOM_MODELS },
      }),
    );
  } catch {
    // localStorage can be unavailable; provider save still succeeds.
  }
}

export function useProviderManagement() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  // Start true so the first paint shows a loading placeholder instead of an empty list.
  const [loading, setLoading] = useState(true);
  const [currentConfig, setCurrentConfig] = useState<ClaudeCurrentConfig | null>(
    null,
  );
  const [currentConfigLoading, setCurrentConfigLoading] = useState(false);
  const [providerError, setProviderError] =
    useState<ClaudeProviderActionError | null>(null);

  const [providerDialog, setProviderDialog] = useState<ProviderDialogState>({
    isOpen: false,
    provider: null,
  });
  const [claudeSettingsJsonDialogOpen, setClaudeSettingsJsonDialogOpen] =
    useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>({
    isOpen: false,
    provider: null,
  });

  /**
   * Mirror reference desktop client: when the active Claude provider changes, push its
   * ANTHROPIC_DEFAULT_* env slots into localStorage so the model picker can
   * show mapped names (e.g. kimi-k3) and brand icons.
   */
  const syncActiveProviderModelMapping = useCallback(
    (providerList: ProviderConfig[]) => {
      const active =
        providerList.find((provider) => provider.isActive) ??
        providerList.find(
          (provider) =>
            provider.id === LOCAL_SETTINGS_PROVIDER_ID ||
            provider.isLocalProvider,
        ) ??
        null;
      const env = active?.settingsConfig?.env as
        | Record<string, unknown>
        | undefined;
      const result = syncModelMappingFromProviderEnv(env);
      if (!result.ok) {
        setProviderError(providerActionError("storage", result.error));
      } else if (result.warnings.length > 0) {
        setProviderError(
          providerActionError("storage", result.warnings.join("; ")),
        );
      }
    },
    [],
  );

  const loadProviders = useCallback(
    async (options?: ProviderLoadOptions) => {
      const silent = Boolean(options?.silent);
      if (!silent) {
        setLoading(true);
      }
      try {
        const list = await getClaudeProviders();
        setProviders(list);
        mergeClaudeProviderCustomModelsIntoStore(list);
        syncActiveProviderModelMapping(list);
        return { ok: true } as const;
      } catch (error) {
        const actionError =
          typeof error === "object" && error !== null && "action" in error
            ? (error as ClaudeProviderActionError)
            : providerActionError("load", error);
        setProviderError(actionError);
        return { ok: false, error: actionError } as const;
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [syncActiveProviderModelMapping],
  );

  const loadCurrentConfig = useCallback(async (options?: ProviderLoadOptions) => {
    const silent = Boolean(options?.silent);
    if (!silent) {
      setCurrentConfigLoading(true);
    }
    try {
      const config = await getCurrentClaudeConfig();
      setCurrentConfig(config as ClaudeCurrentConfig);
      return { ok: true } as const;
    } catch (error) {
      setCurrentConfig(null);
      const actionError = providerActionError("load", error);
      setProviderError(actionError);
      return { ok: false, error: actionError } as const;
    } finally {
      if (!silent) {
        setCurrentConfigLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const migration = migrateModelMappingStorage();
    if (migration.warnings.length > 0) {
      setProviderError(
        providerActionError("storage", migration.warnings.join("; ")),
      );
    }
    void Promise.all([loadProviders(), loadCurrentConfig()]);
  }, [loadProviders, loadCurrentConfig]);

  // 新建菜单选供应商并 switch 后，静默刷新「使用中」标记（避免设置页 loading 闪烁）
  useEffect(() => {
    const onActiveProviderChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ engine?: string }>).detail;
      if (detail?.engine && detail.engine !== "claude") {
        return;
      }
      void Promise.all([
        loadProviders({ silent: true }),
        loadCurrentConfig({ silent: true }),
      ]);
    };
    window.addEventListener(
      VENDOR_ACTIVE_PROVIDER_CHANGED_EVENT,
      onActiveProviderChanged,
    );
    return () => {
      window.removeEventListener(
        VENDOR_ACTIVE_PROVIDER_CHANGED_EVENT,
        onActiveProviderChanged,
      );
    };
  }, [loadProviders, loadCurrentConfig]);

  const handleEditProvider = useCallback((provider: ProviderConfig) => {
    setProviderDialog({ isOpen: true, provider });
  }, []);

  const handleAddProvider = useCallback(() => {
    setProviderDialog({ isOpen: true, provider: null });
  }, []);

  const handleCloseProviderDialog = useCallback(() => {
    setProviderDialog({ isOpen: false, provider: null });
  }, []);

  const handleOpenClaudeSettingsJsonDialog = useCallback(() => {
    setClaudeSettingsJsonDialogOpen(true);
  }, []);

  const handleCloseClaudeSettingsJsonDialog = useCallback(() => {
    setClaudeSettingsJsonDialogOpen(false);
  }, []);

  const handleClaudeSettingsJsonSaved = useCallback(() => {
    void Promise.all([loadProviders(), loadCurrentConfig()]).then(() => {
      notifyProviderTargetCatalogChanged();
    });
  }, [loadProviders, loadCurrentConfig]);

  const handleSaveProvider = useCallback(
    async (data: {
      providerName: string;
      remark: string;
      apiKey: string;
      apiUrl: string;
      jsonConfig: string;
    }) => {
      if (!data.providerName) {
        const error = providerActionError("save", "Provider name is required");
        setProviderError(error);
        return { ok: false, error } as const;
      }

      let parsedConfig;
      try {
        parsedConfig = JSON.parse(data.jsonConfig || "{}");
      } catch (cause) {
        const error = providerActionError("save", cause);
        setProviderError(error);
        return { ok: false, error } as const;
      }

      const updates = {
        name: data.providerName,
        remark: data.remark,
        websiteUrl: null,
        settingsConfig: parsedConfig,
      };

      const isAdding = !providerDialog.provider;

      try {
        if (isAdding) {
          const newProvider = {
            id: crypto.randomUUID
              ? crypto.randomUUID()
              : Date.now().toString(),
            ...updates,
          };
          await addClaudeProvider(newProvider);
        } else {
          const providerId = providerDialog.provider!.id;
          const currentProvider =
            providers.find((p) => p.id === providerId) ||
            providerDialog.provider!;

          await updateClaudeProvider(providerId, {
            ...currentProvider,
            ...updates,
          });
        }

        setProviderDialog({ isOpen: false, provider: null });
        await Promise.all([loadProviders(), loadCurrentConfig()]);
        setProviderError(null);
        notifyProviderTargetCatalogChanged();
        return { ok: true } as const;
      } catch (cause) {
        const error =
          typeof cause === "object" && cause !== null && "action" in cause
            ? (cause as ClaudeProviderActionError)
            : providerActionError("save", cause);
        setProviderError(error);
        return { ok: false, error } as const;
      }
    },
    [
      providerDialog.provider,
      providers,
      loadProviders,
      loadCurrentConfig,
    ],
  );

  const handleReorderProviders = useCallback(
    async (orderedIds: string[]) => {
      const localProviders = providers.filter(
        (provider) =>
          provider.id === LOCAL_SETTINGS_PROVIDER_ID || provider.isLocalProvider,
      );
      const regularById = new Map(
        providers
          .filter(
            (provider) =>
              provider.id !== LOCAL_SETTINGS_PROVIDER_ID &&
              !provider.isLocalProvider,
          )
          .map((provider) => [provider.id, provider]),
      );
      const orderedRegularProviders = orderedIds
        .map((id) => regularById.get(id))
        .filter((provider): provider is ProviderConfig => Boolean(provider));

      setProviders([...localProviders, ...orderedRegularProviders]);

      try {
        await reorderClaudeProviders(orderedIds);
        // Success: the optimistic order already matches what the backend
        // persisted (reorder only writes sortOrder, never changes the active
        // provider), so keep it as-is. Refetching here would toggle the loading
        // flag and replace every provider object reference right after the drop
        // settles, causing a visible flicker on each reorder.
        setProviderError(null);
        return { ok: true } as const;
      } catch (cause) {
        // Persistence failed: reload from backend to roll back the optimistic order.
        await loadProviders();
        const error = providerActionError("reorder", cause);
        setProviderError(error);
        return { ok: false, error } as const;
      }
    },
    [providers, loadProviders],
  );

  const handleDeleteProvider = useCallback((provider: ProviderConfig) => {
    setDeleteConfirm({ isOpen: true, provider });
  }, []);

  /**
   * L1「启用 / 使用中」：只更新 app 内 claude.current（backend 不再盖写 ~/.claude/settings.json）。
   * managed 会话 env 靠 thread.providerProfileId + launch/--settings；本地 settings 保持用户磁盘原样。
   * 设置页与新建菜单共用此路径；已绑定会话的 L2 binding 不会被改写。
   *
   * Optimistic isActive + no list loading flag: avoids the full-list "加载中" flash on switch.
   * On failure, roll back to the pre-switch snapshot.
   */
  const handleSwitchProvider = useCallback(
    async (id: string) => {
      const previous = providers;
      const optimistic = applyOptimisticActiveProvider(previous, id);
      setProviders(optimistic);
      syncActiveProviderModelMapping(optimistic);

      try {
        await switchClaudeProvider(id);
        // Soft-reconcile current config only; list already reflects exclusive active.
        // Avoid loadProviders() here — it would toggle loading and replace every row ref.
        await loadCurrentConfig({ silent: true });
        setProviderError(null);
        notifyProviderTargetCatalogChanged();
        return { ok: true } as const;
      } catch (cause) {
        setProviders(previous);
        syncActiveProviderModelMapping(previous);
        const error = providerActionError("switch", cause);
        setProviderError(error);
        return { ok: false, error } as const;
      }
    },
    [providers, loadCurrentConfig, syncActiveProviderModelMapping],
  );

  const confirmDeleteProvider = useCallback(async () => {
    const provider = deleteConfirm.provider;
    if (!provider) return;

    try {
      await deleteClaudeProvider(provider.id);
      await Promise.all([loadProviders(), loadCurrentConfig()]);
      setProviderError(null);
      notifyProviderTargetCatalogChanged();
      setDeleteConfirm({ isOpen: false, provider: null });
      return { ok: true } as const;
    } catch (cause) {
      const error = providerActionError("delete", cause);
      setProviderError(error);
      setDeleteConfirm({ isOpen: false, provider: null });
      return { ok: false, error } as const;
    }
  }, [deleteConfirm.provider, loadProviders, loadCurrentConfig]);

  const cancelDeleteProvider = useCallback(() => {
    setDeleteConfirm({ isOpen: false, provider: null });
  }, []);

  const localProvider = useMemo(
    () =>
      providers.find(
        (provider) =>
          provider.id === LOCAL_SETTINGS_PROVIDER_ID ||
          provider.isLocalProvider,
      ) ?? null,
    [providers],
  );

  return {
    providers,
    localProvider,
    loading,
    currentConfig,
    currentConfigLoading,
    providerError,
    providerDialog,
    claudeSettingsJsonDialogOpen,
    deleteConfirm,
    loadProviders,
    loadCurrentConfig,
    handleEditProvider,
    handleAddProvider,
    handleCloseProviderDialog,
    handleOpenClaudeSettingsJsonDialog,
    handleCloseClaudeSettingsJsonDialog,
    handleClaudeSettingsJsonSaved,
    handleSaveProvider,
    handleReorderProviders,
    handleSwitchProvider,
    handleDeleteProvider,
    confirmDeleteProvider,
    cancelDeleteProvider,
  };
}

export type UseProviderManagementReturn = ReturnType<
  typeof useProviderManagement
>;
