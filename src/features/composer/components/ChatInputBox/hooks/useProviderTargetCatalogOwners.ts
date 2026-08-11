import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  discoverCodexModels,
  getClaudeProviders,
  getCodexProviders,
  getEngineModels,
  getGrokProviders,
  getKimiProviders,
  getOpenCodeProviders,
} from "../../../../../services/tauri";
import type { EngineType } from "../../../../../types";
import {
  CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
  CLAUDE_LOCAL_PROVIDER_PROFILE_NAME,
  CODEX_DISK_PROVIDER_PROFILE_ID,
  CODEX_DISK_PROVIDER_PROFILE_NAME,
  GROK_LOCAL_PROVIDER_PROFILE_ID,
  GROK_LOCAL_PROVIDER_PROFILE_NAME,
  KIMI_LOCAL_PROVIDER_PROFILE_ID,
  KIMI_LOCAL_PROVIDER_PROFILE_NAME,
  OPENCODE_LOCAL_PROVIDER_PROFILE_ID,
  OPENCODE_LOCAL_PROVIDER_PROFILE_NAME,
  type EngineProviderProfileOption,
} from "../../../../threads/constants/codexProviderProfiles";
import type { ModelInfo, ProviderId } from "../types";
import { enrichModelInfoWithAtomicReasoning } from "../../../../models/atomicModelReasoning";
import { useCliEngineVisibility } from "../../../hooks/cliEngineVisibilityStore";

// Native 单栏与 Atomic 双栏共享不可变 cache primitives，但拥有独立 hook state/input contract。
export type ProviderProfileModelGroup = {
  id: string;
  label: string;
  source: "disk" | "managed";
  enabled?: boolean;
  disabledReason?: string;
  models: ModelInfo[];
  loading: boolean;
  reloadingConfig?: boolean;
  discoveringModels?: boolean;
  discoverySupported?: boolean;
  error: string | null;
};

export type ProviderTargetGroup = {
  providerId: ProviderId;
  providerLabel: string;
  enabled: boolean;
  disabledReason?: string;
  profiles: ProviderProfileModelGroup[];
};

type ProfileCatalog = Partial<
  Record<
    "claude" | "codex" | "kimi" | "grok" | "opencode",
    EngineProviderProfileOption[]
  >
>;

type ProviderProfileEngine = Exclude<ProviderId, "gemini">;

const PROVIDER_PROFILE_ENGINES: readonly ProviderProfileEngine[] = [
  "claude",
  "codex",
  "grok",
  "kimi",
  "opencode",
];

export function isProviderProfileEngine(
  provider: string,
): provider is ProviderProfileEngine {
  return PROVIDER_PROFILE_ENGINES.some((engine) => engine === provider);
}

const DEFAULT_PROFILES: ProfileCatalog = {
  claude: [
    {
      id: CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
      name: CLAUDE_LOCAL_PROVIDER_PROFILE_NAME,
      source: "disk",
    },
  ],
  codex: [
    {
      id: CODEX_DISK_PROVIDER_PROFILE_ID,
      name: CODEX_DISK_PROVIDER_PROFILE_NAME,
      source: "disk",
    },
  ],
  kimi: [
    {
      id: KIMI_LOCAL_PROVIDER_PROFILE_ID,
      name: KIMI_LOCAL_PROVIDER_PROFILE_NAME,
      source: "disk",
    },
  ],
  grok: [
    {
      id: GROK_LOCAL_PROVIDER_PROFILE_ID,
      name: GROK_LOCAL_PROVIDER_PROFILE_NAME,
      source: "disk",
    },
  ],
  opencode: [
    {
      id: OPENCODE_LOCAL_PROVIDER_PROFILE_ID,
      name: OPENCODE_LOCAL_PROVIDER_PROFILE_NAME,
      source: "disk",
    },
  ],
};

let profileCatalogCache: ProfileCatalog | null = null;
let profileCatalogRequest: Promise<ProfileCatalog> | null = null;
const modelCatalogCache = new Map<string, ModelInfo[]>();
const modelCatalogRequests = new Map<string, Promise<ModelInfo[]>>();
const discoveredModelCatalogCache = new Map<string, ModelInfo[]>();
const EMPTY_MODELS: ModelInfo[] = [];

type CatalogAction = "reload-config" | "discover-models";
type AtomicProviderTargetCatalogMode = "shared" | "create-session";

type ProviderTargetCatalogCommonOptions = {
  enabled: boolean;
  workspaceId?: string | null;
  currentProvider: ProviderId;
  currentProviderProfileId?: string | null;
  resolveProviderLabel: (providerId: ProviderId) => string;
  kimiDisabledReason: string;
};

/** 自定义模型按引擎注入（localStorage plugin models） */
export type PluginCustomModelsByEngine = Partial<
  Record<"claude" | "codex" | "gemini", ModelInfo[]>
>;

type AtomicProviderTargetCatalogOptions =
  ProviderTargetCatalogCommonOptions & {
    mode: AtomicProviderTargetCatalogMode;
    /** 各引擎 localStorage 自定义模型;添加后立即出现在 atomic 选择器 */
    pluginCustomModels?: PluginCustomModelsByEngine;
  };

function normalizeProfiles(
  engine: "claude" | "codex" | "kimi" | "grok" | "opencode",
  providers: Array<{
    id: string;
    name: string;
    isLocalProvider?: boolean;
  }>,
): EngineProviderProfileOption[] {
  const defaults = DEFAULT_PROFILES[engine] ?? [];
  const defaultNameById = new Map(
    defaults.map((profile) => [profile.id, profile.name]),
  );
  const normalized = providers
    .map((provider) => {
      const id = provider.id.trim();
      const isLocal =
        provider.isLocalProvider || isLocalProviderProfile(engine, id);
      // 本地渠道统一展示「本地配置」，避免暴露 settings.json / codex-tui 等内部路径
      const name = isLocal
        ? (defaultNameById.get(id) ??
          defaults[0]?.name ??
          (provider.name.trim() || id))
        : provider.name.trim() || id;
      return {
        id,
        name,
        source: isLocal ? ("disk" as const) : ("managed" as const),
      };
    })
    .filter((provider) => provider.id.length > 0);
  return [
    ...defaults.filter(
      (defaultProfile) =>
        !normalized.some((provider) => provider.id === defaultProfile.id),
    ),
    ...normalized,
  ];
}

async function loadProfileCatalog(): Promise<ProfileCatalog> {
  if (profileCatalogCache) {
    return profileCatalogCache;
  }
  if (!profileCatalogRequest) {
    profileCatalogRequest = Promise.allSettled([
      getClaudeProviders(),
      getCodexProviders(),
      getKimiProviders(),
      getGrokProviders(),
      getOpenCodeProviders(),
    ])
      .then(([claude, codex, kimi, grok, opencode]) => {
        if (
          claude.status === "rejected" &&
          codex.status === "rejected" &&
          kimi.status === "rejected" &&
          grok.status === "rejected" &&
          opencode.status === "rejected"
        ) {
          throw claude.reason;
        }
        profileCatalogCache = {
          claude:
            claude.status === "fulfilled"
              ? normalizeProfiles("claude", claude.value)
              : DEFAULT_PROFILES.claude,
          codex:
            codex.status === "fulfilled"
              ? normalizeProfiles("codex", codex.value)
              : DEFAULT_PROFILES.codex,
          kimi:
            kimi.status === "fulfilled"
              ? normalizeProfiles("kimi", kimi.value)
              : DEFAULT_PROFILES.kimi,
          grok:
            grok.status === "fulfilled"
              ? normalizeProfiles("grok", grok.value)
              : DEFAULT_PROFILES.grok,
          opencode:
            opencode.status === "fulfilled"
              ? normalizeProfiles("opencode", opencode.value)
              : DEFAULT_PROFILES.opencode,
        };
        return profileCatalogCache;
      })
      .finally(() => {
        profileCatalogRequest = null;
      });
  }
  return profileCatalogRequest;
}

function modelCatalogKey(engine: EngineType, providerProfileId: string): string {
  return `${engine}:${providerProfileId}`;
}

function isLocalProviderProfile(
  engine: EngineType,
  providerProfileId: string,
): boolean {
  switch (engine) {
    case "claude":
      return providerProfileId === CLAUDE_LOCAL_PROVIDER_PROFILE_ID;
    case "codex":
      return providerProfileId === CODEX_DISK_PROVIDER_PROFILE_ID;
    case "kimi":
      return providerProfileId === KIMI_LOCAL_PROVIDER_PROFILE_ID;
    case "grok":
      return providerProfileId === GROK_LOCAL_PROVIDER_PROFILE_ID;
    case "opencode":
      return providerProfileId === OPENCODE_LOCAL_PROVIDER_PROFILE_ID;
    default:
      return false;
  }
}

function initialLoadedModels(
  mode: AtomicProviderTargetCatalogMode,
): Record<string, ModelInfo[]> {
  if (mode !== "shared") {
    return Object.fromEntries(modelCatalogCache);
  }
  return Object.fromEntries(
    [...modelCatalogCache].filter(([key]) => {
      const separatorIndex = key.indexOf(":");
      if (separatorIndex < 0) {
        return true;
      }
      return !isLocalProviderProfile(
        key.slice(0, separatorIndex) as EngineType,
        key.slice(separatorIndex + 1),
      );
    }),
  );
}

function toModelInfo(
  model: Awaited<ReturnType<typeof getEngineModels>>[number],
  engine?: EngineType,
): ModelInfo {
  const base: ModelInfo = {
    id: model.id,
    model: model.model,
    label: model.displayName || model.id,
    description: model.description,
    source: model.source,
    providerProfileId: model.providerProfileId ?? undefined,
  };
  return enrichModelInfoWithAtomicReasoning(engine ?? null, base);
}

function modelRuntimeIdentity(model: ModelInfo): string {
  return (model.model?.trim() || model.id.trim()).toLowerCase();
}

/**
 * Prefer stable catalog entry id so Claude family tiers that share the same
 * mapped runtime model (e.g. all → kimi-k3) stay as separate picker rows.
 */
function modelCatalogIdentity(model: ModelInfo): string {
  const id = model.id.trim().toLowerCase();
  if (id) {
    return `id:${id}`;
  }
  const runtime = modelRuntimeIdentity(model);
  return runtime ? `runtime:${runtime}` : "";
}

function isPublicFallbackModel(model: ModelInfo): boolean {
  if (model.providerProfileId?.trim()) {
    return false;
  }
  return model.source === "fallback" || model.source === "builtin";
}

export function mergeProviderCatalogModels(
  customModels: ModelInfo[],
  configuredModels: ModelInfo[],
  discoveredModels: ModelInfo[],
): ModelInfo[] {
  const merged: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const model of [
    ...customModels,
    ...configuredModels,
    ...discoveredModels,
  ]) {
    const identity = modelCatalogIdentity(model);
    if (!identity || seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    merged.push(model);
  }
  return merged;
}

export function filterAtomicProviderProfileModels(
  engine: EngineType,
  providerProfileId: string,
  models: ModelInfo[],
): ModelInfo[] {
  const localProfile = isLocalProviderProfile(engine, providerProfileId);
  return models.filter((model) => {
    const modelProviderProfileId = model.providerProfileId?.trim() || null;
    return localProfile
      ? modelProviderProfileId === null ||
          modelProviderProfileId === providerProfileId
      : modelProviderProfileId === providerProfileId ||
          isPublicFallbackModel(model);
  });
}

function extractCodexDiscoveredModels(response: Record<string, unknown>): ModelInfo[] {
  const result =
    response.result && typeof response.result === "object"
      ? response.result as Record<string, unknown>
      : null;
  const rawModels = result?.data ?? response.data;
  if (!Array.isArray(rawModels)) {
    return [];
  }
  return rawModels.flatMap((rawModel) => {
    if (!rawModel || typeof rawModel !== "object") {
      return [];
    }
    const model = rawModel as Record<string, unknown>;
    const idValue = model.id ?? model.model;
    if (typeof idValue !== "string" || !idValue.trim()) {
      return [];
    }
    const runtimeModel =
      typeof model.model === "string" && model.model.trim()
        ? model.model.trim()
        : idValue.trim();
    const labelValue =
      model.displayName ?? model.display_name ?? model.name ?? runtimeModel;
    return [{
      id: idValue.trim(),
      model: runtimeModel,
      label:
        typeof labelValue === "string" && labelValue.trim()
          ? labelValue.trim()
          : runtimeModel,
      description:
        typeof model.description === "string" ? model.description : undefined,
      source: "runtime",
    }];
  });
}

function useProviderTargetCatalogOwner({
  enabled,
  workspaceId,
  mode = "shared",
  currentProvider,
  pluginCustomModels,
  resolveProviderLabel,
}: {
  enabled: boolean;
  workspaceId?: string | null;
  mode?: AtomicProviderTargetCatalogMode;
  currentProvider: ProviderId;
  /** 调用方仍可传入；Atomic groups 不再按 session binding 过滤。 */
  currentProviderProfileId?: string | null;
  pluginCustomModels?: PluginCustomModelsByEngine;
  resolveProviderLabel: (providerId: ProviderId) => string;
  /** 历史 API；Atomic 路径不再按 native 禁用 Kimi 行。 */
  kimiDisabledReason?: string;
}) {
  const [profiles, setProfiles] = useState<ProfileCatalog>(
    () => profileCatalogCache ?? DEFAULT_PROFILES,
  );
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [loadingBindings, setLoadingBindings] = useState<Set<string>>(
    () => new Set(),
  );
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({});
  const [catalogActions, setCatalogActions] = useState<Set<string>>(
    () => new Set(),
  );
  const catalogActionsInFlight = useRef(new Set<string>());
  const authoritativeRefreshCompletedBindingsRef = useRef(new Set<string>());
  const [loadedModels, setLoadedModels] = useState<Record<string, ModelInfo[]>>(
    () => initialLoadedModels(mode),
  );
  // 用户在「CLI配置管理」停用的引擎不进 target picker;当前选中引擎兜底保留,
  // 与 ProviderSelect 的可见性规则保持一致(进行中的会话不受开关影响)。
  const disabledCliEngineIds = useCliEngineVisibility();

  const ensureProfiles = useCallback(async () => {
    if (!enabled) {
      return;
    }
    setProfileLoadError(null);
    try {
      setProfiles(await loadProfileCatalog());
    } catch (error) {
      setProfileLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [enabled]);

  // 供应商 CRUD 后：重置本地投影并重新拉取 provider list（模块缓存已被清空）。
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const handleCatalogInvalidated = () => {
      setProfiles(DEFAULT_PROFILES);
      setLoadedModels(initialLoadedModels(mode));
      setLoadingBindings(new Set());
      setModelErrors({});
      setCatalogActions(new Set());
      authoritativeRefreshCompletedBindingsRef.current.clear();
      void ensureProfiles();
    };
    window.addEventListener(
      PROVIDER_TARGET_CATALOG_INVALIDATED_EVENT,
      handleCatalogInvalidated,
    );
    return () => {
      window.removeEventListener(
        PROVIDER_TARGET_CATALOG_INVALIDATED_EVENT,
        handleCatalogInvalidated,
      );
    };
  }, [enabled, ensureProfiles, mode]);

  const ensureModels = useCallback(
    async (
      engine: EngineType,
      providerProfileId: string,
    ): Promise<ModelInfo[]> => {
      if (
        !enabled ||
        !["claude", "codex", "kimi", "grok", "opencode"].includes(engine)
      ) {
        return [];
      }
      const key = modelCatalogKey(engine, providerProfileId);
      const requiresAuthoritativeRefresh =
        mode === "shared" &&
        isLocalProviderProfile(engine, providerProfileId) &&
        !authoritativeRefreshCompletedBindingsRef.current.has(key);
      const cachedModels = modelCatalogCache.get(key);
      if (!requiresAuthoritativeRefresh && cachedModels) {
        setLoadedModels((current) =>
          current[key] ? current : { ...current, [key]: cachedModels },
        );
        return cachedModels;
      }
      if (requiresAuthoritativeRefresh) {
        setLoadedModels((current) => {
          if (!(key in current)) {
            return current;
          }
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
      setLoadingBindings((current) => new Set(current).add(key));
      setModelErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      try {
        const requestKey = requiresAuthoritativeRefresh
          ? `force-refresh:${key}`
          : key;
        let request = modelCatalogRequests.get(requestKey);
        if (!request) {
          request = getEngineModels(engine, {
            providerProfileId,
            ...(requiresAuthoritativeRefresh
              ? { forceRefresh: true }
              : {}),
          })
            .then((models) => models.map((entry) => toModelInfo(entry, engine)))
            .finally(() => {
              modelCatalogRequests.delete(requestKey);
            });
          modelCatalogRequests.set(requestKey, request);
        }
        let models = await request;
        // managed profile 空 catalog：回退读取供应商配置默认模型作为兜底 row。
        // 只写本地 loadedModels，不写模块级 cache，避免污染后续真实 catalog 重试。
        const isFallbackDefault =
          models.length === 0 &&
          !isLocalProviderProfile(engine, providerProfileId);
        if (isFallbackDefault) {
          const configuredDefault = await resolveProviderConfiguredDefaultModel(
            engine,
            providerProfileId,
          );
          if (configuredDefault) {
            models = [configuredDefault];
          }
        }
        if (!isFallbackDefault) {
          modelCatalogCache.set(key, models);
        }
        if (requiresAuthoritativeRefresh) {
          authoritativeRefreshCompletedBindingsRef.current.add(key);
        }
        setLoadedModels((current) => ({ ...current, [key]: models }));
        return models;
      } catch (error) {
        setModelErrors((current) => ({
          ...current,
          [key]: error instanceof Error ? error.message : String(error),
        }));
        return [];
      } finally {
        setLoadingBindings((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [enabled, mode],
  );

  const runCatalogAction = useCallback(
    async (
      action: CatalogAction,
      engine: EngineType,
      providerProfileId: string,
    ) => {
      if (!enabled) {
        return;
      }
      const key = modelCatalogKey(engine, providerProfileId);
      const actionKey = `${action}:${key}`;
      if (catalogActionsInFlight.current.has(actionKey)) {
        return;
      }
      if (action === "discover-models" && engine !== "codex") {
        throw new Error(`${engine} CLI does not expose a supported model-list protocol`);
      }
      if (action === "discover-models" && !workspaceId?.trim()) {
        throw new Error("Codex model discovery requires an active workspace");
      }

      catalogActionsInFlight.current.add(actionKey);
      setCatalogActions((current) => new Set(current).add(actionKey));
      setModelErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      try {
        if (action === "reload-config") {
          const models = (await getEngineModels(engine, {
            providerProfileId,
            forceRefresh: true,
          })).map((entry) => toModelInfo(entry, engine));
          modelCatalogCache.set(key, models);
          if (
            mode === "shared" &&
            isLocalProviderProfile(engine, providerProfileId)
          ) {
            authoritativeRefreshCompletedBindingsRef.current.add(key);
          }
          setLoadedModels((current) => ({ ...current, [key]: models }));
          return;
        }

        const models = extractCodexDiscoveredModels(
          await discoverCodexModels(workspaceId!.trim(), providerProfileId),
        ).map((model) =>
          enrichModelInfoWithAtomicReasoning("codex", {
            ...model,
            providerProfileId,
          }),
        );
        discoveredModelCatalogCache.set(key, models);
        setLoadedModels((current) => ({ ...current }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setModelErrors((current) => ({ ...current, [key]: message }));
      } finally {
        catalogActionsInFlight.current.delete(actionKey);
        setCatalogActions((current) => {
          const next = new Set(current);
          next.delete(actionKey);
          return next;
        });
      }
    },
    [enabled, mode, workspaceId],
  );
  const reloadConfig = useCallback(
    (engine: EngineType, providerProfileId: string) =>
      runCatalogAction("reload-config", engine, providerProfileId),
    [runCatalogAction],
  );
  const discoverModels = useCallback(
    (engine: EngineType, providerProfileId: string) =>
      runCatalogAction("discover-models", engine, providerProfileId),
    [runCatalogAction],
  );

  const groups = useMemo<ProviderTargetGroup[]>(() => {
    if (!enabled) {
      return [];
    }
    const engines = PROVIDER_PROFILE_ENGINES.filter(
      (engine) =>
        engine === currentProvider || !disabledCliEngineIds.has(engine),
    );
    return engines.map((engine) => ({
      providerId: engine,
      providerLabel: resolveProviderLabel(engine),
      enabled: true,
      disabledReason: undefined,
      profiles: (profiles[engine] ?? []).map((profile) => {
        const key = modelCatalogKey(engine, profile.id);
        const pluginModelsForEngine =
          engine === "claude" || engine === "codex"
            ? (pluginCustomModels?.[engine] ?? EMPTY_MODELS)
            : EMPTY_MODELS;
        // Atomic：自定义模型来自 localStorage plugin models，scoped catalog 按 binding 加载。
        const configuredModels =
          loadedModels[key] ??
          (mode === "shared" &&
          isLocalProviderProfile(engine, profile.id)
            ? undefined
            : modelCatalogCache.get(key)) ??
          [];
        const mergedModels = mergeProviderCatalogModels(
          pluginModelsForEngine,
          configuredModels,
          discoveredModelCatalogCache.get(key) ?? [],
        );
        return {
          id: profile.id,
          label: profile.name,
          source: profile.source,
          enabled: true,
          disabledReason: undefined,
          models: filterAtomicProviderProfileModels(
            engine,
            profile.id,
            mergedModels,
          ),
          loading: loadingBindings.has(key),
          reloadingConfig: catalogActions.has(`reload-config:${key}`),
          discoveringModels: catalogActions.has(`discover-models:${key}`),
          discoverySupported: engine === "codex" && Boolean(workspaceId?.trim()),
          error: modelErrors[key] ?? null,
        };
      }),
    }));
  }, [
    currentProvider,
    catalogActions,
    disabledCliEngineIds,
    enabled,
    loadedModels,
    loadingBindings,
    modelErrors,
    mode,
    pluginCustomModels,
    profiles,
    resolveProviderLabel,
    workspaceId,
  ]);

  return {
    groups,
    ensureProfiles,
    ensureModels,
    reloadConfig,
    discoverModels,
    profileLoadError,
  };
}

/**
 * Atomic 双栏 catalog owner。
 *
 * 引擎/渠道 catalog 按 `engine + providerProfileId` 拉取。自定义模型单独经
 * `pluginCustomModels` 注入，保证「添加模型」后当前页选择器立刻可见。
 */
export function useAtomicProviderTargetCatalog({
  mode,
  pluginCustomModels,
  ...options
}: AtomicProviderTargetCatalogOptions) {
  return useProviderTargetCatalogOwner({
    ...options,
    mode,
    pluginCustomModels,
  });
}

export function resetProviderTargetCatalogForTests(): void {
  profileCatalogCache = null;
  profileCatalogRequest = null;
  modelCatalogCache.clear();
  modelCatalogRequests.clear();
  discoveredModelCatalogCache.clear();
}

/**
 * 供应商 CRUD 后失效生产路径的模块级 catalog 缓存。
 * 与 test-only reset 等价，但命名/语义面向运行时调用。
 */
export function invalidateProviderTargetCatalogForRuntime(): void {
  profileCatalogCache = null;
  profileCatalogRequest = null;
  modelCatalogCache.clear();
  modelCatalogRequests.clear();
  discoveredModelCatalogCache.clear();
}

export const PROVIDER_TARGET_CATALOG_INVALIDATED_EVENT =
  "doge:provider-target-catalog-invalidated";

/**
 * 供应商增删改/切换/导入成功后调用：失效模块级缓存并通知挂载中的
 * Atomic picker 重置本地投影、重新拉取 provider list。
 */
export function notifyProviderTargetCatalogChanged(): void {
  invalidateProviderTargetCatalogForRuntime();
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(PROVIDER_TARGET_CATALOG_INVALIDATED_EVENT),
  );
}

/**
 * 读取 managed provider 配置中的默认模型，作为空 catalog 的兜底 row。
 * Codex 由 backend `configToml.model` 已覆盖，不做前端 TOML 解析。
 */
async function resolveProviderConfiguredDefaultModel(
  engine: EngineType,
  providerProfileId: string,
): Promise<ModelInfo | null> {
  if (engine === "gemini" || engine === "codex") {
    // codex 由 backend `configToml.model` 已覆盖；gemini 无 provider-scoped catalog。
    return null;
  }
  const buildRow = (model: string): ModelInfo => ({
    id: model,
    model,
    label: model,
    source: "provider-config",
    providerProfileId,
  });
  try {
    if (engine === "claude") {
      const providers = await getClaudeProviders();
      const provider = providers.find((entry) => entry.id === providerProfileId);
      const env = provider?.settingsConfig?.env ?? {};
      const model =
        env.ANTHROPIC_MODEL?.trim() ||
        env.ANTHROPIC_DEFAULT_FABLE_MODEL?.trim() ||
        env.ANTHROPIC_DEFAULT_SONNET_MODEL?.trim() ||
        env.ANTHROPIC_DEFAULT_OPUS_MODEL?.trim() ||
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL?.trim();
      return model ? buildRow(model) : null;
    }
    if (engine === "kimi") {
      const providers = await getKimiProviders();
      const model = providers
        .find((entry) => entry.id === providerProfileId)
        ?.model?.trim();
      return model ? buildRow(model) : null;
    }
    if (engine === "grok") {
      const providers = await getGrokProviders();
      const model = providers
        .find((entry) => entry.id === providerProfileId)
        ?.model?.trim();
      return model ? buildRow(model) : null;
    }
    if (engine === "opencode") {
      const providers = await getOpenCodeProviders();
      const model = providers
        .find((entry) => entry.id === providerProfileId)
        ?.models.find((item) => item.trim().length > 0)
        ?.trim();
      return model ? buildRow(model) : null;
    }
  } catch {
    // 配置读取失败不阻断：仍走空态引导。
  }
  return null;
}
