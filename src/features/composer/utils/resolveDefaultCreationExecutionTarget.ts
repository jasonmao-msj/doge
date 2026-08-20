import type { EngineType } from "../../../types";
import type { ExecutionTarget } from "../../shared-session/target/types";
import { isSharedSessionSupportedEngine } from "../../shared-session/utils/sharedSessionEngines";
import {
  isManagedProviderProfileIdV1,
} from "../../account/runtime/engineEntitlementStore";
import {
  CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
  CODEX_DISK_PROVIDER_PROFILE_ID,
  GROK_LOCAL_PROVIDER_PROFILE_ID,
  KIMI_LOCAL_PROVIDER_PROFILE_ID,
  LOCAL_PROVIDER_PROFILE_DISPLAY_NAME,
  OPENCODE_LOCAL_PROVIDER_PROFILE_ID,
} from "../../threads/constants/codexProviderProfiles";

/**
 * Home / create-session 默认下一轮目标的 catalog 行投影。
 * 与 ModelOption / picker ModelInfo 字段对齐（仅消费 id / model / isDefault）。
 */
export type CreationTargetModelLike = {
  id: string;
  model?: string | null;
  providerProfileId?: string | null;
  isDefault?: boolean;
};

const LOCAL_PROFILE_IDS: Partial<Record<EngineType, string>> = {
  claude: CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
  codex: CODEX_DISK_PROVIDER_PROFILE_ID,
  kimi: KIMI_LOCAL_PROVIDER_PROFILE_ID,
  grok: GROK_LOCAL_PROVIDER_PROFILE_ID,
  opencode: OPENCODE_LOCAL_PROVIDER_PROFILE_ID,
};

function resolveRuntimeModel(model: CreationTargetModelLike): string {
  return model.model?.trim() || model.id.trim() || "";
}

/**
 * 首页 create-session Atomic picker 的默认 ExecutionTarget。
 *
 * - 覆盖全部 Shared/Atomic 引擎（含 Grok / Kimi / OpenCode），禁止仅 claude/codex。
 * - catalog 命中优先；未命中但有 selectedModelId 时用 id 合成 snapshot（闭合态可展示）。
 * - runtime 回落 id，避免只有 catalog entry 无 model 字段时假空。
 * - Shared 会话不得走此默认（enabled=false）。
 */
export function resolveDefaultCreationExecutionTarget(input: {
  enabled: boolean;
  selectedEngine: EngineType | null | undefined;
  selectedModelId: string | null | undefined;
  selectedEffort?: string | null;
  providerProfileId?: string | null;
  /** Explicitly mark a provider-scoped refresh as unavailable. */
  providerCatalogAvailable?: boolean;
  models: readonly CreationTargetModelLike[];
}): ExecutionTarget | null {
  if (!input.enabled) {
    return null;
  }
  const engine = input.selectedEngine;
  if (!isSharedSessionSupportedEngine(engine)) {
    return null;
  }

  const requestedId = input.selectedModelId?.trim() || "";
  const rawProviderProfileId = input.providerProfileId?.trim() || null;
  const isManaged = isManagedProviderProfileIdV1(rawProviderProfileId);
  if (isManaged && input.providerCatalogAvailable === false) {
    return null;
  }
  // Managed targets may only consume rows explicitly stamped with their own
  // provider identity. An untagged row is not enough evidence that it came
  // from the provider-scoped request and may be a disk/global row.
  const models = isManaged
    ? input.models.filter((candidate) => {
        const candidateProvider = candidate.providerProfileId?.trim() || null;
        return candidateProvider === rawProviderProfileId;
      })
    : input.models;
  if (isManaged && models.length === 0) {
    return null;
  }
  const matched =
    (requestedId
      ? (models.find((candidate) => candidate.id === requestedId) ??
        models.find(
          (candidate) => resolveRuntimeModel(candidate) === requestedId,
        ) ??
        null)
      : null) ??
    models.find((candidate) => candidate.isDefault) ??
    models[0] ??
    null;

  const modelCatalogEntryId = matched?.id.trim() || requestedId;
  const runtimeModel = matched
    ? resolveRuntimeModel(matched)
    : requestedId;
  if (!modelCatalogEntryId || !runtimeModel) {
    return null;
  }

  const localProfileId = LOCAL_PROFILE_IDS[engine];
  const isLocal =
    !rawProviderProfileId || rawProviderProfileId === localProfileId;
  const effort = input.selectedEffort?.trim() || "";

  return {
    engine,
    providerProfileId: isLocal ? null : rawProviderProfileId,
    modelCatalogEntryId,
    model: runtimeModel,
    reasoning: effort ? { effort } : null,
    providerProfileNameSnapshot: isLocal
      ? LOCAL_PROVIDER_PROFILE_DISPLAY_NAME
      : rawProviderProfileId,
    providerProfileSource: isLocal ? "disk" : "managed",
  };
}
