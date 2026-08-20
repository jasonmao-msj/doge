import { Fragment, memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import CheckIcon from 'lucide-react/dist/esm/icons/check';
import ChevronDownIcon from 'lucide-react/dist/esm/icons/chevron-down';
import Settings2Icon from 'lucide-react/dist/esm/icons/settings-2';
import type { ModelInfo, ProviderId } from '../types';
import {
  resolveAtomicReasoningEffort,
} from '../../../../models/atomicModelReasoning';
import type { ProviderModelGroup } from '../modelOptions';
import type { ProviderTargetGroup } from '../hooks/useProviderTargetCatalogOwners';
import type { ExecutionTarget } from '../../../../shared-session/target/types';
import { PROVIDER_CONTINUATION_UI_ROLLBACK_EVENT } from "../../../../threads/services/providerContinuationRequests";
import {
  CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
  CODEX_DISK_PROVIDER_PROFILE_ID,
  GROK_LOCAL_PROVIDER_PROFILE_ID,
  KIMI_LOCAL_PROVIDER_PROFILE_ID,
  OPENCODE_LOCAL_PROVIDER_PROFILE_ID,
} from '../../../../threads/constants/codexProviderProfiles';
import { EngineIcon } from '../../../../engine/components/EngineIcon';
import {
  MANAGED_PROVIDER_PROFILE_ID_V1,
  managedEngineIdForRuntimeV1,
  readManagedEngineEntitlementsV1,
  subscribeManagedEngineEntitlementsV1,
} from '../../../../account/runtime/engineEntitlementStore';
import { ProviderBrandIconImg } from '../../../../vendors/components/ProviderBrandIconImg';
import {
  PROVIDER_BRAND_ICON_SRC,
  resolveProviderBrandIcon,
} from '../../../../vendors/providerBrandIcon';
import {
  STORAGE_KEYS as MODEL_MAPPING_STORAGE_KEYS,
  getModelMapping,
  resolveModelMappingValue,
  type ModelMapping,
} from '../../../../models/constants';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

const SUBMENU_FOOTER_BUTTON_CLASS =
  'flex min-h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-border/70 bg-muted/45 px-2 py-1.5 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50';

interface ModelSelectProps {
  value: string;
  onChange: (modelId: string) => void;
  models?: ModelInfo[];  // Optional dynamic model list
  currentProvider?: string;  // Current provider type
  providerLabel?: string;
  triggerVariant?: 'default' | 'readiness';
  modelGroups?: ProviderModelGroup[];
  onProviderModelChange?: (providerId: ProviderId, modelId: string) => void;
  /** Navigate to model management; optional providerId = the engine submenu opened */
  onAddModel?: (providerId?: string) => void;
  onRefreshConfig?: () => Promise<void> | void; // Refresh current provider config
  isRefreshingConfig?: boolean;
  /** Jump to CLI / provider settings management page */
  onOpenCliSettings?: () => void;
  // 共享会话(atomic)目标选择:与 legacy 相同的「引擎子菜单 → 平铺模型」
  // 交互,数据来自 target catalog,选中产出完整 ExecutionTarget。
  targetGroups?: ProviderTargetGroup[];
  /** Home only: each actively subscribed engine starts from Doge Token Matrix. */
  preferManagedProviderDefaults?: boolean;
  executionTarget?: ExecutionTarget | null;
  onExecutionTargetChange?: (target: ExecutionTarget) => void;
  onOpenTargetCatalog?: () => Promise<void> | void;
  onOpenProviderProfile?: (
    providerId: ProviderId,
    providerProfileId: string,
  ) => Promise<ModelInfo[] | void> | ModelInfo[] | void;
  targetCatalogError?: string | null;
  onReloadProviderConfig?: (
    providerId: ProviderId,
    providerProfileId: string,
  ) => Promise<void> | void;
}

const MODEL_LABEL_KEYS: Record<string, string> = {
  'claude-fable-5': 'models.claude.fable5.label',
  'claude-opus-5': 'models.claude.opus5.label',
  'claude-opus-4-8': 'models.claude.opus48.label',
  'claude-sonnet-5': 'models.claude.sonnet5.label',
  'claude-sonnet-4-7': 'models.claude.sonnet47.label',
  'claude-sonnet-4-6': 'models.claude.sonnet46.label',
  'claude-haiku-4-5': 'models.claude.haiku45.label',
  'claude-haiku-4-5-20251001': 'models.claude.haiku45.label',
  'gpt-5.6-sol': 'models.codex.gpt56sol.label',
  'gpt-5.6-terra': 'models.codex.gpt56terra.label',
  'gpt-5.6-luna': 'models.codex.gpt56luna.label',
  'gpt-5.5': 'models.codex.gpt55.label',
};

const MODEL_DESCRIPTION_KEYS: Record<string, string> = {
  'claude-fable-5': 'models.claude.fable5.description',
  'claude-opus-5': 'models.claude.opus5.description',
  'claude-opus-4-8': 'models.claude.opus48.description',
  'claude-sonnet-5': 'models.claude.sonnet5.description',
  'claude-sonnet-4-7': 'models.claude.sonnet47.description',
  'claude-sonnet-4-6': 'models.claude.sonnet46.description',
  'claude-haiku-4-5': 'models.claude.haiku45.description',
  'claude-haiku-4-5-20251001': 'models.claude.haiku45.description',
  'gpt-5.6-sol': 'models.codex.gpt56sol.description',
  'gpt-5.6-terra': 'models.codex.gpt56terra.description',
  'gpt-5.6-luna': 'models.codex.gpt56luna.description',
  'gpt-5.5': 'models.codex.gpt55.description',
};

const LOCAL_PROVIDER_PROFILE_IDS: Partial<Record<ProviderId, string>> = {
  claude: CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
  codex: CODEX_DISK_PROVIDER_PROFILE_ID,
  kimi: KIMI_LOCAL_PROVIDER_PROFILE_ID,
  grok: GROK_LOCAL_PROVIDER_PROFILE_ID,
  opencode: OPENCODE_LOCAL_PROVIDER_PROFILE_ID,
};

export function normalizeExecutionProviderProfileId(
  providerId: ProviderId,
  providerProfileId: string | null | undefined,
): string | null {
  const normalizedProviderProfileId = providerProfileId?.trim();
  return !normalizedProviderProfileId ||
    LOCAL_PROVIDER_PROFILE_IDS[providerId] === normalizedProviderProfileId
    ? null
    : normalizedProviderProfileId;
}

/**
 * 每个 CLI 只投影一个活跃渠道:当前 CLI 取 executionTarget 所选渠道
 * (空 = 本地默认),其余 CLI 一律取本地默认渠道。
 */
export function resolveActiveProviderProfileId(
  providerId: ProviderId,
  executionTarget: Pick<
    ExecutionTarget,
    'engine' | 'providerProfileId'
  > | null | undefined,
  fallbackProviderProfileId?: string | null,
): string | null {
  const targetProfileId =
    executionTarget?.engine === providerId
      ? normalizeExecutionProviderProfileId(
          providerId,
          executionTarget.providerProfileId,
        )
      : null;
  const fallbackProfileId = normalizeExecutionProviderProfileId(
    providerId,
    fallbackProviderProfileId,
  );
  return (
    targetProfileId ??
    fallbackProfileId ??
    LOCAL_PROVIDER_PROFILE_IDS[providerId] ??
    null
  );
}

/**
 * Claude 列表行展示名：catalog runtime 优先于全局 localStorage mapping。
 * Shared 打开历史会话时 mapping 常滞后于 selectedNextTarget 渠道。
 */
export function resolveClaudeCatalogModelLabel(
  model: Pick<ModelInfo, "id" | "model" | "label" | "providerProfileId">,
  modelMapping: ModelMapping,
): string {
  const runtime = model.model?.trim() || "";
  const catalogId = model.id.trim();
  if (runtime) {
    if (model.providerProfileId?.trim() || runtime !== catalogId) {
      return runtime;
    }
  } else if (
    model.providerProfileId?.trim() &&
    model.label &&
    model.label.trim() !== catalogId
  ) {
    return model.label.trim();
  }

  const mappedName = resolveModelMappingValue(model.id, modelMapping);
  if (mappedName) {
    return mappedName;
  }

  const parentLabel = model.label?.trim() || "";
  if (parentLabel) {
    return parentLabel;
  }
  return catalogId || model.id;
}

export function isSameProviderExecutionProfile(
  currentProvider: ProviderId,
  currentProviderProfileId: string | null | undefined,
  target: Pick<ExecutionTarget, 'engine' | 'providerProfileId'>,
): boolean {
  return (
    target.engine === currentProvider &&
    normalizeExecutionProviderProfileId(
      currentProvider,
      target.providerProfileId,
    ) ===
      normalizeExecutionProviderProfileId(
        currentProvider,
        currentProviderProfileId,
      )
  );
}

export type BuildProviderExecutionTargetModelMeta = {
  source?: string | null;
  supportedReasoningEfforts?: ModelInfo['supportedReasoningEfforts'];
  defaultReasoningEffort?: string | null;
};

export function buildProviderExecutionTarget(
  current: ExecutionTarget | null | undefined,
  providerId: ProviderId,
  providerProfileId: string,
  modelCatalogEntryId: string,
  providerProfileNameSnapshot?: string,
  providerProfileSource?: 'disk' | 'managed',
  normalizeProviderProfile = true,
  runtimeModel?: string,
  /**
   * @deprecated 兼容旧调用：仅当 modelMeta 未提供 default 时作为 fallback。
   * 新代码请走 modelMeta（含 supported + default + source）。
   */
  defaultReasoningEffort?: string | null,
  /** 目标模型 capability；Shared/Atomic 据此 seed/校验 reasoning effort。 */
  modelMeta?: BuildProviderExecutionTargetModelMeta | null,
): ExecutionTarget {
  const normalizedProviderProfileId = normalizeProviderProfile
    ? normalizeExecutionProviderProfileId(providerId, providerProfileId)
    : providerProfileId;
  const normalizedRuntimeModel = runtimeModel?.trim() || null;
  const sameProfile =
    current?.engine === providerId &&
    current.providerProfileId === normalizedProviderProfileId;
  const modelRef: ModelInfo = {
    id: modelCatalogEntryId,
    model: normalizedRuntimeModel ?? modelCatalogEntryId,
    label: modelCatalogEntryId,
    source: modelMeta?.source ?? undefined,
    supportedReasoningEfforts: modelMeta?.supportedReasoningEfforts,
    defaultReasoningEffort:
      modelMeta?.defaultReasoningEffort ??
      (defaultReasoningEffort?.trim() || null),
  };
  const nextEffort = resolveAtomicReasoningEffort({
    engine: providerId,
    model: modelRef,
    previousEffort: current?.reasoning?.effort ?? null,
    inherit: sameProfile,
  });
  return {
    engine: providerId,
    providerProfileId: normalizedProviderProfileId,
    modelCatalogEntryId,
    model: normalizedRuntimeModel,
    providerProfileNameSnapshot:
      providerProfileNameSnapshot?.trim() || null,
    providerProfileSource: providerProfileSource ?? null,
    reasoning: nextEffort ? { effort: nextEffort } : null,
  };
}

function resolveRuntimeModel(model: ModelInfo): string | undefined {
  return model.model?.trim() || model.id.trim() || undefined;
}

/**
 * Atomic 闭合态选中展示解析（Shared / create-session Atomic 共用）。
 *
 * catalog 命中时用 catalog 行做友好标签；未命中时用 executionTarget 快照合成展示行。
 * Atomic 路径 MUST NOT 依赖父层 activeEngine `models` 判定“是否已选”。
 */
export function resolveAtomicSelectedModelDisplay(
  executionTarget: ExecutionTarget | null | undefined,
  selectedModelValue: string,
  catalogModels: readonly ModelInfo[] | null | undefined,
): ModelInfo | null {
  if (!executionTarget) {
    return null;
  }
  const catalogEntryId =
    executionTarget.modelCatalogEntryId?.trim() || selectedModelValue.trim();
  const runtimeModel = executionTarget.model?.trim() || "";
  if (!catalogEntryId && !runtimeModel) {
    return null;
  }

  const matchedCatalog =
    catalogModels?.find((model) => {
      if (catalogEntryId && model.id === catalogEntryId) {
        return true;
      }
      if (selectedModelValue && model.id === selectedModelValue) {
        return true;
      }
      const catalogRuntime = resolveRuntimeModel(model);
      return Boolean(
        runtimeModel &&
          catalogRuntime &&
          catalogRuntime === runtimeModel,
      );
    }) ?? null;
  if (matchedCatalog) {
    return matchedCatalog;
  }

  const snapshotId = catalogEntryId || runtimeModel;
  return {
    id: snapshotId,
    model: runtimeModel || snapshotId,
    label: runtimeModel || snapshotId,
    providerProfileId:
      executionTarget.providerProfileId?.trim() || undefined,
    source: "provider-config",
  };
}

/**
 * Resolve the model id used for brand-icon matching.
 * Claude：与列表文案同源（{@link resolveClaudeCatalogModelLabel}）——
 * catalog runtime 优先，禁止陈旧 localStorage mapping 把「k3」行画成 DeepSeek 鲸。
 * 其它 CLI：runtime / id。
 */
export function resolveModelIdForIcon(
  model: ModelInfo | null | undefined,
  mapping: ModelMapping,
  providerId?: string | null,
): string | null {
  if (!model) {
    return null;
  }
  if (!providerId || providerId === "claude") {
    // 与 getModelLabel 一致：catalog 改写后的 runtime 优先于全局 mapping
    const runtime = model.model?.trim() || "";
    const catalogId = model.id.trim();
    if (runtime && (model.providerProfileId?.trim() || runtime !== catalogId)) {
      return runtime;
    }
    const mapped = resolveModelMappingValue(model.id, mapping);
    if (mapped) {
      return mapped;
    }
  }
  return resolveRuntimeModel(model) ?? model.id;
}

function isSelectedExecutionModel(
  executionTarget: ExecutionTarget | null | undefined,
  model: ModelInfo,
): boolean {
  const selectedCatalogEntryId = executionTarget?.modelCatalogEntryId?.trim();
  if (selectedCatalogEntryId) {
    return selectedCatalogEntryId === model.id;
  }
  const selectedRuntimeModel = executionTarget?.model?.trim();
  return Boolean(
    selectedRuntimeModel &&
      selectedRuntimeModel === resolveRuntimeModel(model),
  );
}

/**
 * 分组子菜单的统一投影:legacy(modelGroups)与 atomic(targetGroups)
 * 共用同一套「引擎子菜单 → 平铺模型」渲染,差异只在选择/刷新行为。
 */
type PickerProfileOption = {
  id: string;
  label: string;
  source: 'disk' | 'managed';
  models: ModelInfo[];
  loading: boolean;
  reloading: boolean;
  error: string | null;
};

type PickerModelGroup = {
  providerId: ProviderId;
  providerLabel: string;
  models: ModelInfo[];
  enabled: boolean;
  disabledReason?: string;
  loading: boolean;
  reloading: boolean;
  error: string | null;
  targetProfileId: string | null;
  targetProfileLabel?: string;
  targetProfileSource?: 'disk' | 'managed';
  /** Atomic 目标组的全部渠道,用于子菜单底栏渠道选择弹窗 */
  profiles: PickerProfileOption[];
};

/**
 * Each CLI's native brand mark (when it has a lobehub SVG). Used to detect
 * true cross-vendor remaps (e.g. Claude tier → kimi-k3) vs native models that
 * should keep the engine-canonical icon for visual consistency.
 */
const ENGINE_NATIVE_BRAND_SRC: Partial<Record<string, string>> = {
  claude: PROVIDER_BRAND_ICON_SRC.claude,
  codex: PROVIDER_BRAND_ICON_SRC.openai,
  kimi: PROVIDER_BRAND_ICON_SRC.kimi,
  opencode: PROVIDER_BRAND_ICON_SRC.opencode,
};

function renderBrandIcon(src: string, size: number) {
  const imgStyle = { width: size, height: size, flexShrink: 0 } as const;
  return (
    <span style={imgStyle} className="selector-model-brand-icon" aria-hidden>
      <ProviderBrandIconImg src={src} />
    </span>
  );
}

/**
 * Model icon: keep provider row / model rows / composer trigger consistent per CLI.
 *
 * - Kimi → lobehub brand tile (dark pad + white K + blue dot)
 * - Codex / Grok / Claude / … → EngineIcon monochrome / asset
 * - Only show a foreign brand when a mapped runtime model points at another
 *   vendor (e.g. Claude slot remapped to kimi-k3)
 */
const ModelIcon = ({
  provider,
  model,
  modelIdForIcon,
  size = 16,
}: {
  provider?: string;
  model?: ModelInfo | null;
  /** Pre-resolved id for brand matching (mapped runtime name preferred). */
  modelIdForIcon?: string | null;
  size?: number;
}) => {
  const imgStyle = { width: size, height: size, flexShrink: 0 } as const;
  const resolvedModelId =
    modelIdForIcon?.trim() ||
    (model ? resolveRuntimeModel(model) ?? model.id : null);

  // Cross-vendor remap only — do not pass presetId, otherwise every Kimi model
  // without "kimi" in its id would short-circuit through brand while the
  // provider row still used EngineIcon (or vice versa).
  if (resolvedModelId) {
    const brandIconSrc = resolveProviderBrandIcon({
      modelId: resolvedModelId,
    });
    const nativeBrandSrc = provider
      ? ENGINE_NATIVE_BRAND_SRC[provider]
      : undefined;
    if (brandIconSrc && brandIconSrc !== nativeBrandSrc) {
      return renderBrandIcon(brandIconSrc, size);
    }
  }

  // Kimi's product mark is the brand tile; monochrome EngineIcon is the wrong
  // glyph for this CLI (provider row + model list + trigger must match).
  if (provider === 'kimi') {
    return renderBrandIcon(PROVIDER_BRAND_ICON_SRC.kimi, size);
  }

  switch (provider) {
    case 'codex':
      return <EngineIcon engine="codex" size={size} style={imgStyle} />;
    case 'gemini':
      return <EngineIcon engine="gemini" size={size} style={imgStyle} />;
    case 'grok':
      return <EngineIcon engine="grok" size={size} style={imgStyle} />;
    case 'opencode':
      return <EngineIcon engine="opencode" size={size} style={imgStyle} />;
    case 'claude':
    default:
      return <EngineIcon engine="claude" size={size} style={imgStyle} />;
  }
};

/**
 * ModelSelect - Model selector component
 * Supports switching between Sonnet 4.5, Opus 4.5, and other models, including Codex models
 */
export const ModelSelect = memo(({
  value,
  onChange,
  models = [],
  currentProvider = 'claude',
  triggerVariant = 'default',
  modelGroups,
  onProviderModelChange,
  onAddModel,
  onRefreshConfig,
  isRefreshingConfig = false,
  onOpenCliSettings,
  targetGroups,
  preferManagedProviderDefaults = false,
  executionTarget,
  onExecutionTargetChange,
  onOpenTargetCatalog,
  onOpenProviderProfile,
  targetCatalogError,
  onReloadProviderConfig,
}: ModelSelectProps) => {
  const { t } = useTranslation();
  const managedEntitlements = useSyncExternalStore(
    subscribeManagedEngineEntitlementsV1,
    readManagedEngineEntitlementsV1,
    readManagedEngineEntitlementsV1,
  );
  const [isOpen, setIsOpen] = useState(false);
  const [refreshConfigError, setRefreshConfigError] = useState<string | null>(null);
  const [modelMappingVersion, setModelMappingVersion] = useState(0);
  /** 底栏渠道按钮打开的全屏选择弹窗所绑定的引擎 */
  const [channelPickerProviderId, setChannelPickerProviderId] =
    useState<ProviderId | null>(null);
  /**
   * 各 CLI 渠道预览覆盖：切渠道时投影目标 catalog；
   * Shared/Native 都会写 executionTarget（Native 走续接 dialog）。
   * 取消续接时必须清掉 override，否则底栏仍停在 destination 供应商。
   */
  const [profileOverrides, setProfileOverrides] = useState<
    Partial<Record<ProviderId, string>>
  >({});

  // 切会话 / 目标渠道变化时丢弃底栏预览覆盖，避免仍显示上一会话的 DeepSeek 等旧渠道名
  useEffect(() => {
    // 幂等：已空则保留同一引用，避免无意义 setState 叠环（#185）
    setProfileOverrides((prev) =>
      Object.keys(prev).length === 0 ? prev : {},
    );
  }, [executionTarget?.engine, executionTarget?.providerProfileId]);

  // Native 续接点「取消」：executionTarget 未变，需事件驱动清掉 destination override
  useEffect(() => {
    const onRollback = (event: Event) => {
      const detail = (
        event as CustomEvent<{ engine?: string; providerProfileId?: string | null }>
      ).detail;
      const engine = detail?.engine?.trim();
      if (!engine) {
        setProfileOverrides((prev) =>
          Object.keys(prev).length === 0 ? prev : {},
        );
        return;
      }
      setProfileOverrides((current) => {
        if (!(engine in current)) {
          return current;
        }
        const next = { ...current };
        delete next[engine as ProviderId];
        return next;
      });
    };
    window.addEventListener(PROVIDER_CONTINUATION_UI_ROLLBACK_EVENT, onRollback);
    return () => {
      window.removeEventListener(
        PROVIDER_CONTINUATION_UI_ROLLBACK_EVENT,
        onRollback,
      );
    };
  }, []);

  // Keep label/icon mapping in sync when the active provider rewrites
  // claude-model-mapping (same-tab custom event + cross-tab storage).
  useEffect(() => {
    const isRelevant = (key: string | null | undefined) =>
      key === MODEL_MAPPING_STORAGE_KEYS.CLAUDE_MODEL_MAPPING;
    const onStorage = (event: StorageEvent) => {
      if (isRelevant(event.key)) {
        setModelMappingVersion((version) => version + 1);
      }
    };
    const onCustom = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (isRelevant(detail?.key)) {
        setModelMappingVersion((version) => version + 1);
      }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('localStorageChange', onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('localStorageChange', onCustom);
    };
  }, []);

  const modelMapping = useMemo(() => {
    void modelMappingVersion;
    return getModelMapping();
  }, [modelMappingVersion]);

  const hasTargetGroups = Boolean(targetGroups && targetGroups.length > 0);

  const pickerGroups = useMemo<PickerModelGroup[]>(() => {
    if (targetGroups && targetGroups.length > 0) {
      return targetGroups.map((group) => {
        const managedEngineId = managedEngineIdForRuntimeV1(group.providerId);
        const managedDefaultProfileId =
          preferManagedProviderDefaults &&
          managedEngineId !== null &&
          managedEntitlements[managedEngineId] === 'active'
            ? MANAGED_PROVIDER_PROFILE_ID_V1
            : null;
        const defaultProfileId = resolveActiveProviderProfileId(
          group.providerId,
          executionTarget,
          managedDefaultProfileId,
        );
        const overrideProfileId = profileOverrides[group.providerId];
        const activeProfileId = overrideProfileId ?? defaultProfileId;
        const profiles: PickerProfileOption[] = group.profiles
          .filter((profile) => profile.enabled !== false)
          .map((profile) => ({
            id: profile.id,
            label: profile.label,
            source: profile.source,
            models: profile.models,
            loading: profile.loading,
            reloading: profile.reloadingConfig ?? profile.loading,
            error: profile.error,
          }));
        const matchedProfile = profiles.find(
          (profile) => profile.id === activeProfileId,
        );
        // 切到老会话时 catalog 可能尚未含该 id：用 executionTarget 快照补 label，
        // 禁止静默回退 profiles[0]（常见为 DeepSeek 等列表第一项）。
        const snapshotLabel =
          group.providerId === executionTarget?.engine
            ? executionTarget?.providerProfileNameSnapshot?.trim() || null
            : null;
        const activeProfile =
          matchedProfile ??
          (activeProfileId
            ? {
                id: activeProfileId,
                label: snapshotLabel || activeProfileId,
                source: "managed" as const,
                models: [],
                loading: true,
                reloading: true,
                error: null,
              }
            : profiles.find((profile) => profile.source === "disk") ??
              profiles[0]);
        return {
          providerId: group.providerId,
          providerLabel: group.providerLabel,
          models:
            matchedProfile?.models ??
            (activeProfile?.models?.length ? activeProfile.models : []),
          enabled: group.enabled && Boolean(activeProfile),
          disabledReason: group.disabledReason,
          loading: activeProfile?.loading ?? false,
          reloading: activeProfile?.reloading ?? false,
          error: activeProfile?.error ?? null,
          targetProfileId: activeProfile?.id ?? null,
          targetProfileLabel: activeProfile?.label,
          targetProfileSource: activeProfile?.source,
          profiles,
        };
      });
    }
    return (modelGroups ?? []).map((group) => ({
      providerId: group.providerId,
      providerLabel: group.providerLabel,
      models: group.models,
      enabled: true,
      loading: false,
      reloading: false,
      error: null,
      targetProfileId: null,
      profiles: [],
    }));
  }, [
    executionTarget,
    managedEntitlements,
    modelGroups,
    preferManagedProviderDefaults,
    profileOverrides,
    targetGroups,
  ]);

  const hasPickerGroups = pickerGroups.length > 0;

  const effectiveModels = useMemo(() => {
    if (models.length > 0) {
      return models;
    }
    if (currentProvider !== 'claude' && value && value.trim().length > 0) {
      return [{ id: value, label: value }];
    }
    return [] as ModelInfo[];
  }, [currentProvider, models, value]);

  const selectedModelValue = value.trim();
  // Atomic：闭合态权威 = executionTarget 快照；catalog 仅 enrich，父层 models 不参与“已选”判定。
  // Legacy 单栏：仍用 value + effectiveModels。
  const currentModel = hasTargetGroups
    ? resolveAtomicSelectedModelDisplay(
        executionTarget,
        selectedModelValue,
        pickerGroups.find(
          (group) => group.providerId === executionTarget?.engine,
        )?.models,
      )
    : selectedModelValue.length > 0
      ? effectiveModels.find((model) => model.id === selectedModelValue) ?? null
      : null;

  const getModelLabel = (
    model: ModelInfo,
    providerId?: string | null,
  ): string => {
    if (!providerId || providerId === "claude") {
      const claudeLabel = resolveClaudeCatalogModelLabel(model, modelMapping);
      if (claudeLabel) {
        // 无 mapping / runtime 时可能只剩 catalog id；再尝试 i18n 档位名。
        if (claudeLabel === model.id.trim()) {
          const labelKey = MODEL_LABEL_KEYS[model.id];
          if (labelKey) {
            return t(labelKey);
          }
        }
        return claudeLabel;
      }
    }

    const parentLabel = model.label?.trim() || "";
    if (parentLabel) {
      return parentLabel;
    }

    const labelKey = MODEL_LABEL_KEYS[model.id];
    if (labelKey) {
      return t(labelKey);
    }

    return model.id;
  };

  const getModelDescription = (model: ModelInfo): string | undefined => {
    // Always prefer the localized tier subtitle when available, so mapped
    // labels (kimi-k3) still explain which Claude family slot they occupy.
    const descriptionKey = MODEL_DESCRIPTION_KEYS[model.id];
    if (descriptionKey) {
      return t(descriptionKey);
    }
    return model.description;
  };

  const getModelIconId = (
    model?: ModelInfo | null,
    providerId?: string | null,
  ): string | null => resolveModelIdForIcon(model, modelMapping, providerId);
  // Atomic path: selected model belongs to executionTarget.engine, not necessarily
  // the legacy currentProvider prop.
  const selectedModelProvider =
    hasTargetGroups && executionTarget?.engine
      ? executionTarget.engine
      : currentProvider;
  const currentModelLabel = currentModel
    ? getModelLabel(currentModel, selectedModelProvider)
    : t('models.selectModel');
  const hasConfigActions = Boolean(onAddModel || onRefreshConfig);

  const isGroupCurrent = (group: PickerModelGroup): boolean =>
    hasTargetGroups
      ? group.providerId === executionTarget?.engine
      : group.providerId === currentProvider;

  const isGroupModelSelected = (
    group: PickerModelGroup,
    model: ModelInfo,
  ): boolean =>
    hasTargetGroups
      ? group.providerId === executionTarget?.engine &&
        isSelectedExecutionModel(executionTarget, model)
      : group.providerId === currentProvider && model.id === value;

  /**
   * Select model
   */
  const handleSelect = useCallback((modelId: string) => {
    onChange(modelId);
    setIsOpen(false);
  }, [onChange]);

  const handleGroupedSelect = useCallback((providerId: ProviderId, modelId: string) => {
    if (onProviderModelChange) {
      onProviderModelChange(providerId, modelId);
    } else {
      onChange(modelId);
    }
    setIsOpen(false);
  }, [onChange, onProviderModelChange]);

  const handleTargetModelSelect = useCallback(
    (group: PickerModelGroup, model: ModelInfo) => {
      if (!group.targetProfileId) {
        return;
      }
      const runtimeModel = resolveRuntimeModel(model);
      if (!runtimeModel) {
        return;
      }
      onExecutionTargetChange?.(
        buildProviderExecutionTarget(
          executionTarget,
          group.providerId,
          group.targetProfileId,
          model.id,
          group.targetProfileLabel,
          group.targetProfileSource,
          true,
          runtimeModel,
          null,
          {
            source: model.source,
            supportedReasoningEfforts: model.supportedReasoningEfforts,
            defaultReasoningEffort: model.defaultReasoningEffort,
          },
        ),
      );
      setIsOpen(false);
    },
    [executionTarget, onExecutionTargetChange],
  );

  const handlePickerSelect = useCallback(
    (group: PickerModelGroup, model: ModelInfo) => {
      if (hasTargetGroups) {
        handleTargetModelSelect(group, model);
        return;
      }
      handleGroupedSelect(group.providerId, model.id);
    },
    [handleGroupedSelect, handleTargetModelSelect, hasTargetGroups],
  );

  const handleAddModel = useCallback(
    (providerId?: string) => {
      onAddModel?.(providerId);
      setIsOpen(false);
    },
    [onAddModel],
  );

  const handleOpenCliSettings = useCallback(() => {
    onOpenCliSettings?.();
    setIsOpen(false);
  }, [onOpenCliSettings]);

  // Refresh keeps the menu open so the spinner / error stay visible.
  const handleRefreshConfig = useCallback(() => {
    if (!onRefreshConfig || isRefreshingConfig) {
      return;
    }
    setRefreshConfigError(null);
    void Promise.resolve(onRefreshConfig()).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setRefreshConfigError(message);
    });
  }, [isRefreshingConfig, onRefreshConfig]);

  /**
   * 切换 CLI 渠道（Shared / create-session Atomic 共用）。
   *
   * Shared 与 Native 不同：只改 selectedNextTarget，不新建会话、不走续接。
   * 必须先 await 目标 provider 的 model catalog，再用新 catalog 选模型写回
   * ExecutionTarget；禁止在 models 未加载时沿用上一供应商的 model id。
   */
  const handleChannelSwitch = useCallback(
    (group: PickerModelGroup, profileId: string) => {
      const profile = group.profiles.find((item) => item.id === profileId);
      if (!profile || profile.id === group.targetProfileId) {
        return;
      }
      setProfileOverrides((current) => ({
        ...current,
        [group.providerId]: profileId,
      }));

      void (async () => {
        let profileModels = profile.models;
        try {
          const loaded = await onOpenProviderProfile?.(
            group.providerId,
            profileId,
          );
          if (Array.isArray(loaded) && loaded.length > 0) {
            profileModels = loaded;
          }
        } catch {
          // ensureModels 失败时仍尽量用已有 projection
        }

        // Claude：按目标渠道 env 刷新映射，避免 Shared 选供应商后仍显示上一渠道名
        if (group.providerId === "claude") {
          try {
            const { syncClaudeModelMappingForProfile } = await import(
              "../../../../vendors/activateEngineProviderProfile"
            );
            await syncClaudeModelMappingForProfile(profileId);
          } catch {
            // mapping 同步失败不阻断渠道切换
          }
        }

        if (!hasTargetGroups || !onExecutionTargetChange) {
          return;
        }
        // Shared / create-session：渠道切换必须立刻写完整 ExecutionTarget。
        // 禁止「当前 engine 仍是 Codex 时改 Claude 渠道只预览不落盘」——
        // 否则底栏/映射像 DeepSeek，selectedNextTarget 仍是旧引擎或 Claude 本地，
        // 发送会变成「Claude Code · 本地配置 · k3」。
        const sameEngine = group.providerId === executionTarget?.engine;
        const keptModel = sameEngine
          ? (profileModels.find((model) =>
              isSelectedExecutionModel(executionTarget, model),
            ) ??
            profileModels.find(
              (model) =>
                resolveRuntimeModel(model) ===
                (executionTarget.model?.trim() || undefined),
            ) ??
            profileModels[0])
          : profileModels[0];
        // 无新 catalog 时不得沿用上一引擎/渠道的 model id
        if (!keptModel) {
          return;
        }
        const runtimeModel = resolveRuntimeModel(keptModel);
        const catalogEntryId = keptModel.id || runtimeModel || "";
        if (!catalogEntryId && !runtimeModel) {
          return;
        }
        onExecutionTargetChange(
          buildProviderExecutionTarget(
            // 跨引擎时不要继承旧引擎的 reasoning / profile 语义
            sameEngine ? executionTarget : null,
            group.providerId,
            profileId,
            catalogEntryId || runtimeModel || "",
            profile.label,
            profile.source,
            true,
            runtimeModel,
            null,
            {
              source: keptModel.source,
              supportedReasoningEfforts: keptModel.supportedReasoningEfforts,
              defaultReasoningEffort: keptModel.defaultReasoningEffort,
            },
          ),
        );
      })();
    },
    [
      executionTarget,
      hasTargetGroups,
      onExecutionTargetChange,
      onOpenProviderProfile,
    ],
  );

  const openChannelPicker = useCallback((group: PickerModelGroup) => {
    if (group.profiles.length <= 1) {
      return;
    }
    // 关闭下拉，避免与 Dialog 焦点层打架；渠道写入后仍可通过底栏再次进入。
    setIsOpen(false);
    setChannelPickerProviderId(group.providerId);
  }, []);

  const closeChannelPicker = useCallback(() => {
    setChannelPickerProviderId(null);
  }, []);

  const handleChannelPickerSelect = useCallback(
    (profileId: string) => {
      if (!channelPickerProviderId) {
        return;
      }
      const group = pickerGroups.find(
        (item) => item.providerId === channelPickerProviderId,
      );
      if (!group) {
        setChannelPickerProviderId(null);
        return;
      }
      handleChannelSwitch(group, profileId);
      setChannelPickerProviderId(null);
    },
    [channelPickerProviderId, handleChannelSwitch, pickerGroups],
  );

  const channelPickerGroup = useMemo(
    () =>
      channelPickerProviderId
        ? pickerGroups.find(
            (group) => group.providerId === channelPickerProviderId,
          ) ?? null
        : null,
    [channelPickerProviderId, pickerGroups],
  );

  const resolveGroupRefresh = (
    group: PickerModelGroup,
  ): { run: () => void; spinning: boolean } | null => {
    if (hasTargetGroups) {
      // Atomic:每个 CLI 都可刷新其当前活跃渠道配置
      if (!onReloadProviderConfig || !group.targetProfileId) {
        return null;
      }
      const profileId = group.targetProfileId;
      return {
        run: () => {
          void onReloadProviderConfig(group.providerId, profileId);
        },
        spinning: group.reloading,
      };
    }
    // Legacy:仅当前 provider 暴露刷新
    if (group.providerId !== currentProvider || !onRefreshConfig) {
      return null;
    }
    return { run: handleRefreshConfig, spinning: isRefreshingConfig };
  };

  // 菜单打开时预取各引擎活跃渠道的模型,保证未展开子菜单前数据已在路上。
  const handleMenuOpenChange = useCallback(
    (nextOpen: boolean) => {
      setIsOpen(nextOpen);
      if (!nextOpen || !hasTargetGroups) {
        return;
      }
      void onOpenTargetCatalog?.();
      pickerGroups.forEach((group) => {
        if (group.enabled && group.targetProfileId) {
          void onOpenProviderProfile?.(group.providerId, group.targetProfileId);
        }
      });
    },
    [
      hasTargetGroups,
      onOpenTargetCatalog,
      onOpenProviderProfile,
      pickerGroups,
    ],
  );

  const trigger = (
    <button
      className={triggerVariant === 'readiness' ? 'composer-readiness-target composer-readiness-target-button' : 'selector-button'}
      title={t('chat.currentModel', { model: currentModelLabel })}
      aria-label={t('chat.currentModel', { model: currentModelLabel })}
    >
      {triggerVariant === 'readiness' ? (
        <>
          <span className="composer-readiness-icon" aria-hidden="true">
            <ModelIcon
              provider={selectedModelProvider}
              model={currentModel}
              modelIdForIcon={getModelIconId(
                currentModel,
                selectedModelProvider,
              )}
              size={16}
            />
          </span>
          <span className="composer-readiness-model">
            {currentModelLabel}
          </span>
        </>
      ) : (
        <>
          <ModelIcon
            provider={selectedModelProvider}
            model={currentModel}
            modelIdForIcon={getModelIconId(
              currentModel,
              selectedModelProvider,
            )}
            size={12}
          />
          <span className="selector-button-text">{currentModelLabel}</span>
          <span className={`codicon codicon-chevron-${isOpen ? 'up' : 'down'}`} style={{ fontSize: '10px', marginLeft: '2px' }} />
        </>
      )}
    </button>
  );

  const menu = (
    <DropdownMenu open={isOpen} onOpenChange={handleMenuOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={4}
        className="max-h-[380px] w-64 overflow-y-auto"
      >
        {hasPickerGroups ? (
          <>
            {hasTargetGroups && targetCatalogError && (
              <div className="px-2 py-1 text-xs text-destructive" role="status">
                {targetCatalogError}
              </div>
            )}
            {pickerGroups.map((group, groupIndex) => {
              const groupRefresh = resolveGroupRefresh(group);
              const hasChannelSwitcher =
                hasTargetGroups && group.profiles.length > 0;
              const managedEngineId = managedEngineIdForRuntimeV1(group.providerId);
              const entitlementStatus = managedEngineId
                ? managedEntitlements[managedEngineId]
                : 'unknown';
              return (
                <Fragment key={group.providerId}>
                  {groupIndex > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      data-provider-id={group.providerId}
                      data-selected={isGroupCurrent(group) ? 'true' : undefined}
                      disabled={!group.enabled}
                      title={group.disabledReason}
                      className="gap-2"
                    >
                      <ModelIcon provider={group.providerId} size={18} />
                      <span className="min-w-0 flex-1 truncate">{group.providerLabel}</span>
                      {entitlementStatus === 'none' ? (
                        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
                          {t('models.subscribeToUse')}
                        </span>
                      ) : null}
                      {isGroupCurrent(group) && (
                        <span
                          className="size-1.5 shrink-0 rounded-full bg-emerald-500"
                          aria-hidden
                        />
                      )}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent
                      sideOffset={8}
                      alignOffset={-4}
                      className="max-h-[380px] w-72 overflow-y-auto"
                    >
                      <DropdownMenuLabel className="flex items-center gap-1.5 text-muted-foreground">
                        <span className="min-w-0 flex-1 truncate">
                          {t('models.engineHeader', {
                            name: group.providerLabel,
                            defaultValue: `${group.providerLabel} 引擎`,
                          })}
                        </span>
                        {groupRefresh && (
                          <button
                            type="button"
                            disabled={groupRefresh.spinning}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              groupRefresh.run();
                            }}
                            aria-label={t(groupRefresh.spinning ? 'models.refreshingConfig' : 'models.refreshConfig')}
                            title={t(groupRefresh.spinning ? 'models.refreshingConfig' : 'models.refreshConfig')}
                            className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-foreground hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                          >
                            <span
                              className={`codicon codicon-refresh${groupRefresh.spinning ? ' selector-refresh-icon-spinning' : ''}`}
                              aria-hidden
                            />
                          </button>
                        )}
                      </DropdownMenuLabel>
                      {group.loading && (
                        <DropdownMenuItem disabled>
                          <span
                            className="codicon codicon-loading selector-refresh-icon-spinning"
                            aria-hidden
                          />
                          {t('models.refreshingConfig')}
                        </DropdownMenuItem>
                      )}
                      {!group.loading && group.error && (
                        <DropdownMenuItem disabled className="items-start">
                          <span className="min-w-0 whitespace-normal text-xs text-destructive">
                            {group.error}
                          </span>
                        </DropdownMenuItem>
                      )}
                      {!group.loading &&
                        !group.error &&
                        group.models.length === 0 && (
                          <DropdownMenuItem
                            disabled
                            className="items-start gap-2"
                            data-empty-channel-models={group.providerId}
                          >
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="text-sm">
                                {t('models.emptyChannelModelsTitle', {
                                  defaultValue: '该供应商暂无可用模型',
                                })}
                              </span>
                              <span className="text-xs text-muted-foreground whitespace-normal">
                                {t('models.emptyChannelModelsHint', {
                                  defaultValue:
                                    '可点击下方「添加模型」，在自定义模型中添加后使用',
                                })}
                              </span>
                            </div>
                          </DropdownMenuItem>
                        )}
                      {group.models.map((model) => {
                        const isSelected = isGroupModelSelected(group, model);
                        const description = getModelDescription(model);
                        return (
                          <DropdownMenuItem
                            key={`${group.providerId}:${model.id}`}
                            data-model-id={model.id}
                            data-selected={isSelected ? 'true' : undefined}
                            onSelect={(event) => {
                              event.preventDefault();
                              handlePickerSelect(group, model);
                            }}
                            className="items-start gap-2"
                          >
                            <ModelIcon
                              provider={group.providerId}
                              model={model}
                              modelIdForIcon={getModelIconId(
                                model,
                                group.providerId,
                              )}
                              size={18}
                            />
                            <div className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate text-sm">
                                {getModelLabel(model, group.providerId)}
                              </span>
                              {description && (
                                <span className="text-xs text-muted-foreground whitespace-normal">
                                  {description}
                                </span>
                              )}
                            </div>
                            {isSelected && (
                              <CheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                            )}
                          </DropdownMenuItem>
                        );
                      })}
                      {(hasChannelSwitcher || onAddModel) && (
                        <>
                          <DropdownMenuSeparator />
                          {hasChannelSwitcher ? (
                            <div
                              className="flex items-stretch gap-1.5 p-1.5"
                              data-submenu-footer={group.providerId}
                              data-channel-select={group.providerId}
                            >
                              <button
                                type="button"
                                data-provider-profile-id={
                                  group.targetProfileId ?? undefined
                                }
                                data-channel-select-trigger={group.providerId}
                                disabled={group.profiles.length <= 1}
                                aria-label={t('models.switchChannel', {
                                  defaultValue: '切换渠道',
                                })}
                                title={
                                  group.targetProfileLabel
                                    ? `${t('models.switchChannel', {
                                        defaultValue: '切换渠道',
                                      })}: ${group.targetProfileLabel}`
                                    : t('models.switchChannel', {
                                        defaultValue: '切换渠道',
                                      })
                                }
                                className={SUBMENU_FOOTER_BUTTON_CLASS}
                                onPointerDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                }}
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                }}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  openChannelPicker(group);
                                }}
                              >
                                <span className="min-w-0 truncate">
                                  {group.targetProfileLabel ||
                                    t('models.selectChannel', {
                                      defaultValue: '选择渠道',
                                    })}
                                </span>
                                {group.profiles.length > 1 && (
                                  <ChevronDownIcon
                                    className="size-3.5 shrink-0 opacity-70"
                                    aria-hidden
                                  />
                                )}
                              </button>
                              {onAddModel && (
                                <button
                                  type="button"
                                  className={SUBMENU_FOOTER_BUTTON_CLASS}
                                  onPointerDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                  }}
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                  }}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleAddModel(group.providerId);
                                  }}
                                >
                                  <span className="min-w-0 truncate">
                                    {t('models.addModel')}
                                  </span>
                                </button>
                              )}
                            </div>
                          ) : (
                            <DropdownMenuItem
                              onSelect={(event) => {
                                event.preventDefault();
                                handleAddModel(group.providerId);
                              }}
                            >
                              {t('models.addModel')}
                            </DropdownMenuItem>
                          )}
                        </>
                      )}
                      {refreshConfigError &&
                        !hasTargetGroups &&
                        group.providerId === currentProvider && (
                          <div className="px-2 py-1 text-xs text-destructive" role="status">
                            {t('models.refreshConfigFailed', { message: refreshConfigError })}
                          </div>
                        )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </Fragment>
              );
            })}
          </>
        ) : (
          <>
            <DropdownMenuLabel className="text-muted-foreground">
              {t('models.selectModel')}
            </DropdownMenuLabel>
            {effectiveModels.map((model) => {
              const description = getModelDescription(model);
              return (
                <DropdownMenuItem
                  key={model.id}
                  data-model-id={model.id}
                  data-selected={model.id === value ? 'true' : undefined}
                  onSelect={(event) => {
                    event.preventDefault();
                    handleSelect(model.id);
                  }}
                  className="items-start gap-2"
                >
                  <ModelIcon
                    provider={currentProvider}
                    model={model}
                    modelIdForIcon={getModelIconId(model, currentProvider)}
                    size={20}
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm">
                      {getModelLabel(model, currentProvider)}
                    </span>
                    {description && (
                      <span className="text-xs text-muted-foreground whitespace-normal">
                        {description}
                      </span>
                    )}
                  </div>
                  {model.id === value && (
                    <CheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                  )}
                </DropdownMenuItem>
              );
            })}
          </>
        )}
        {hasConfigActions && !hasPickerGroups && (
          <>
            <DropdownMenuSeparator />
            {onAddModel && (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  handleAddModel(currentProvider);
                }}
              >
                {t('models.addModel')}
              </DropdownMenuItem>
            )}
            {onRefreshConfig && (
              <DropdownMenuItem
                disabled={isRefreshingConfig}
                onSelect={(event) => {
                  event.preventDefault();
                  handleRefreshConfig();
                }}
                title={t(isRefreshingConfig ? 'models.refreshingConfig' : 'models.refreshConfig')}
                className="gap-2"
              >
                <span
                  className={`codicon codicon-refresh${isRefreshingConfig ? ' selector-refresh-icon-spinning' : ''}`}
                  aria-hidden
                />
                <span>{t(isRefreshingConfig ? 'models.refreshingConfig' : 'models.refreshConfig')}</span>
              </DropdownMenuItem>
            )}
            {refreshConfigError && (
              <div className="px-2 py-1 text-xs text-destructive" role="status">
                {t('models.refreshConfigFailed', { message: refreshConfigError })}
              </div>
            )}
          </>
        )}
        {onOpenCliSettings && (
          <>
            <DropdownMenuSeparator />
            <div className="p-1.5 pt-1">
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  handleOpenCliSettings();
                }}
                className="justify-center gap-2 rounded-md border border-border/70 bg-muted/45 font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <Settings2Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
                <span>{t('models.openCliSettings')}</span>
              </DropdownMenuItem>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const channelDialog = (
    <Dialog
      open={channelPickerGroup != null}
      onOpenChange={(open) => {
        if (!open) {
          closeChannelPicker();
        }
      }}
    >
      <DialogContent
        className="flex max-h-[min(80vh,32rem)] w-[min(100vw-2rem,24rem)] flex-col gap-3 sm:max-w-md"
        data-channel-picker-dialog={
          channelPickerGroup?.providerId ?? undefined
        }
      >
        <DialogHeader>
          <DialogTitle>
            {t('models.switchChannel', { defaultValue: '切换渠道' })}
          </DialogTitle>
          <DialogDescription>
            {t('models.selectChannelForEngine', {
              name: channelPickerGroup?.providerLabel ?? '',
              defaultValue: `选择 ${channelPickerGroup?.providerLabel ?? ''} 的配置渠道`,
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {channelPickerGroup?.profiles.map((profile) => {
            const isActive = profile.id === channelPickerGroup.targetProfileId;
            return (
              <button
                key={profile.id}
                type="button"
                data-provider-profile-id={profile.id}
                data-channel-option={channelPickerGroup.providerId}
                data-selected={isActive ? 'true' : undefined}
                className="flex w-full items-center gap-2 rounded-md border border-transparent px-3 py-2.5 text-left text-sm hover:bg-accent hover:text-accent-foreground data-[selected=true]:border-border data-[selected=true]:bg-muted/60"
                onClick={() => {
                  handleChannelPickerSelect(profile.id);
                }}
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {profile.label}
                </span>
                {isActive && (
                  <CheckIcon className="size-4 shrink-0" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );

  if (triggerVariant === 'readiness') {
    return (
      <div className="composer-readiness-model-select">
        {menu}
        {channelDialog}
      </div>
    );
  }

  return (
    <>
      {menu}
      {channelDialog}
    </>
  );
});

export default ModelSelect;
