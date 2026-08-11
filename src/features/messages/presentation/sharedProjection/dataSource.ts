/**
 * Shared DataSource（Wave 3 / A3）。
 *
 * 职责：把 Rust `SharedProjector` 产出的 `SharedProjectionItem[]` 映射为
 * `ConversationItem[]`，供 Messages/Canvas 消费。
 *
 * 纪律：
 * - 不写 Canonical / 不反向依赖 Shared runtime。
 * - 允许调用 `buildConversationItem` 做**只读**工具保真（Codex apply_patch /
 *   fileChange / agent Read·Write），与 Native 同一转换入口，避免历史投影漏字段。
 * - Phase 2 后默认开启；只允许 explicit-negative flag 回滚到 Legacy-only 读取。
 * - `systemNotice` / `metadata` 不是 `ConversationItem` kind，映射时丢弃
 *   （它们是 Shadow 观测面，不属于 Canvas 渲染面）。
 */

import type { ConversationItem } from "../../../../types/conversation";
import type { EngineType } from "../../../../types/engine";
import { BUILTIN_ENGINE_TYPES } from "../../../engine/engineRegistry";
import type { SharedProjectionItem } from "./types";
import { LOCAL_PROVIDER_LABEL } from "../../../../utils/turnBadge";
import { buildConversationItem } from "../../../../utils/threadItems";
import { isMultiAgentSettledSummaryItemId } from "../../../multi-agent/utils/canvasItems";

export const SHARED_PROJECTION_STORAGE_KEY = "doge.sharedProjection";
const LEGACY_SHARED_PROJECTION_STORAGE_KEY = "mossx.sharedProjection";

function isEnabledFlag(value: unknown) {
  return typeof value === "string" && /^(1|true|yes|on)$/i.test(value.trim());
}

function isDisabledFlag(value: unknown) {
  return typeof value === "string" && /^(0|false|no|off)$/i.test(value.trim());
}

function parseBooleanFlag(value: unknown): boolean | null {
  if (isEnabledFlag(value)) {
    return true;
  }
  if (isDisabledFlag(value)) {
    return false;
  }
  return null;
}

function readStorageFlag(key: string): boolean | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    return parseBooleanFlag(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

/**
 * 写入测试 override。返回值表示 storage 是否实际变化，供调用方决定是否 reload。
 * `true` 开启；`false` 显式回滚 Legacy-only；`null` 回到 build/default 判定。
 */
export function setSharedProjectionTestOverrideEnabled(
  enabled: boolean | null,
) {
  try {
    if (typeof window === "undefined") {
      return false;
    }
    const currentValue = window.localStorage.getItem(
      SHARED_PROJECTION_STORAGE_KEY,
    );
    if (enabled !== null) {
      const nextValue = enabled ? "1" : "0";
      if (currentValue === nextValue) {
        return false;
      }
      window.localStorage.setItem(SHARED_PROJECTION_STORAGE_KEY, nextValue);
      return true;
    }
    if (currentValue === null) {
      return false;
    }
    window.localStorage.removeItem(SHARED_PROJECTION_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Shared Projection DataSource：local override > build > legacy override > default-on。 */
export function isSharedProjectionDataSourceEnabled() {
  const localOverride = readStorageFlag(SHARED_PROJECTION_STORAGE_KEY);
  if (localOverride !== null) {
    return localOverride;
  }
  const buildOverride = parseBooleanFlag(
    import.meta.env.VITE_DOGE_SHARED_PROJECTION ??
      import.meta.env.VITE_MOSSX_SHARED_PROJECTION,
  );
  if (buildOverride !== null) {
    return buildOverride;
  }
  return readStorageFlag(LEGACY_SHARED_PROJECTION_STORAGE_KEY) ?? true;
}

function readString(content: Record<string, unknown>, key: string) {
  const value = content[key];
  return typeof value === "string" ? value : "";
}

function readToolChanges(
  value: unknown,
): { path: string; kind?: string; diff?: string }[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const changes = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const path = typeof record.path === "string" ? record.path.trim() : "";
      if (!path) {
        return null;
      }
      return {
        path,
        ...(typeof record.kind === "string" ? { kind: record.kind } : {}),
        ...(typeof record.diff === "string" ? { diff: record.diff } : {}),
      };
    })
    .filter((entry): entry is { path: string; kind?: string; diff?: string } => entry !== null);
  return changes.length > 0 ? changes : undefined;
}

function tryParseJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Rebuild canvas-ready tool items from Shared projection summaries.
 *
 * Shared canonical storage only keeps portable summaries; Native live path uses
 * `buildConversationItem` which understands Codex apply_patch / fileChange and
 * agent Read/Write argument shapes. Reuse that converter as a pure enricher.
 */
function enrichSharedToolConversationItem(input: {
  id: string;
  content: Record<string, unknown>;
  engineSource: EngineType | undefined;
}): Extract<ConversationItem, { kind: "tool" }> {
  const { id, content, engineSource } = input;
  const toolType = readString(content, "toolType");
  const title = readString(content, "title");
  const detail = readString(content, "detail");
  const output = typeof content.output === "string" ? content.output : "";
  const status = typeof content.status === "string" ? content.status : "";
  const durationMs =
    typeof content.durationMs === "number" ? content.durationMs : undefined;
  const turnId = typeof content.turnId === "string" ? content.turnId : undefined;
  const projectedChanges = readToolChanges(content.changes);
  const parsedDetail = tryParseJsonObject(detail);

  const attachMeta = (
    item: Extract<ConversationItem, { kind: "tool" }>,
  ): Extract<ConversationItem, { kind: "tool" }> => ({
    ...item,
    ...(engineSource ? { engineSource } : {}),
    ...(turnId ? { turnId } : {}),
  });

  // Shared projector 常把 spawn 参数里的 description 顶成 title；保留可识别的 toolType。
  const looksLikeGrokSpawn =
    /spawn_subagent/i.test(toolType) ||
    /spawn[_\s-]?subagent/i.test(title) ||
    (/^subagent\b/i.test(title) &&
      (detail.includes("subagent_type") ||
        detail.includes("subagentType") ||
        detail.includes("background")));
  // Claude Agent/Task：即使 title 被换成 description，也要保住 toolType，
  // 以便 status-panel / run-status strip 的 isSubagentTool 识别。
  const looksLikeClaudeAgent =
    /^agent$/i.test(toolType) ||
    /^task$/i.test(toolType) ||
    /^tool:\s*agent$/i.test(title) ||
    /^tool:\s*task$/i.test(title) ||
    (Boolean(detail.trim()) &&
      (/"subagent_type"\s*:/i.test(detail) || /"subagentType"\s*:/i.test(detail)));
  const resolvedToolType = looksLikeGrokSpawn
    ? "spawn_subagent"
    : looksLikeClaudeAgent
      ? /^task$/i.test(toolType) || /^tool:\s*task$/i.test(title)
        ? "task"
        : toolType && /^(agent|task)$/i.test(toolType)
          ? toolType
          : "agent"
      : toolType || "toolCall";
  const resolvedTitle = looksLikeGrokSpawn
    ? title && !/^spawn/i.test(title)
      ? title // 保留 description 作展示文案；识别靠 toolType
      : "Spawn Subagent"
    : title || toolType || "Tool";

  const base: Extract<ConversationItem, { kind: "tool" }> = {
    id,
    kind: "tool",
    toolType: resolvedToolType,
    title: resolvedTitle,
    detail,
    ...(status ? { status } : {}),
    ...(output ? { output } : {}),
    ...(typeof durationMs === "number" ? { durationMs } : {}),
    ...(projectedChanges ? { changes: projectedChanges } : {}),
  };

  // Already rich enough for file-edit scene.
  if ((base.changes?.length ?? 0) > 0 && base.toolType === "fileChange") {
    return attachMeta(base);
  }

  const commandFromDetail = (() => {
    if (typeof parsedDetail?.command === "string" && parsedDetail.command.trim()) {
      return parsedDetail.command.trim();
    }
    if (typeof parsedDetail?.cmd === "string" && parsedDetail.cmd.trim()) {
      return parsedDetail.cmd.trim();
    }
    // Codex often sends argv as string[] — same shape as live item.command arrays.
    if (Array.isArray(parsedDetail?.command)) {
      return parsedDetail.command
        .map((part) => (typeof part === "string" ? part.trim() : ""))
        .filter(Boolean)
        .join(" ");
    }
    return "";
  })();
  const patchCandidate =
    (typeof parsedDetail?.patch === "string" && parsedDetail.patch) ||
    (typeof parsedDetail?.input === "string" && parsedDetail.input) ||
    detail;
  const looksLikeApplyPatch =
    /apply[_-]?patch/i.test(`${toolType} ${title}`) ||
    patchCandidate.includes("*** Begin Patch") ||
    patchCandidate.includes("*** Update File:");
  const looksLikeCommand =
    toolType === "commandExecution" ||
    /^command\s*:/i.test(title) ||
    Boolean(commandFromDetail);
  const looksLikeNativeFileChange =
    toolType === "fileChange" ||
    /file[_-]?change/i.test(`${toolType} ${title}`) ||
    (projectedChanges?.length ?? 0) > 0 ||
    looksLikeApplyPatch;

  const rawCandidates: Record<string, unknown>[] = [];

  // Codex commandExecution (may promote to fileChange when command is apply_patch).
  if (looksLikeCommand || looksLikeApplyPatch) {
    rawCandidates.push({
      id,
      type: "commandExecution",
      title,
      tool: title,
      name: title,
      status,
      output,
      aggregatedOutput: output,
      command: commandFromDetail || (looksLikeApplyPatch ? patchCandidate : undefined),
      cwd:
        typeof parsedDetail?.cwd === "string" ? parsedDetail.cwd : undefined,
      description:
        typeof parsedDetail?.description === "string"
          ? parsedDetail.description
          : undefined,
      input: looksLikeApplyPatch ? patchCandidate : parsedDetail ?? undefined,
      arguments: parsedDetail ?? undefined,
      changes: projectedChanges ?? content.changes,
    });
  }

  // Codex fileChange item shape
  if (looksLikeNativeFileChange) {
    rawCandidates.push({
      id,
      type: "fileChange",
      title: title || "File changes",
      tool: title,
      name: title,
      status,
      output,
      aggregatedOutput: output,
      input: patchCandidate || parsedDetail || detail || undefined,
      arguments: parsedDetail ?? undefined,
      changes: projectedChanges ?? content.changes,
    });
  }

  // Agent-style Read/Write/Edit — only when title looks like a tool name and detail is JSON args
  if (parsedDetail && title && !looksLikeCommand) {
    rawCandidates.push({
      id,
      type: "mcpToolCall",
      server: "agent",
      tool: title || toolType,
      title: title || toolType,
      status,
      output,
      arguments: parsedDetail,
      result: output,
    });
  }

  for (const raw of rawCandidates) {
    const converted = buildConversationItem(raw);
    if (!converted || converted.kind !== "tool") {
      continue;
    }
    const richerFileChange =
      converted.toolType === "fileChange" &&
      (converted.changes?.length ?? 0) > 0;
    // Accept mcpToolCall polish only when we get structured detail (path etc.).
    const richerAgentTool =
      converted.toolType !== "commandExecution" &&
      converted.toolType !== base.toolType &&
      Boolean(converted.detail?.trim()) &&
      converted.detail !== detail;
    if (richerFileChange || richerAgentTool) {
      return attachMeta({
        ...converted,
        id,
      });
    }
  }

  return attachMeta(base);
}

function readEngineSource(content: Record<string, unknown>): EngineType | undefined {
  const value = content.engineSource;
  return typeof value === "string" &&
    BUILTIN_ENGINE_TYPES.includes(value as EngineType)
    ? (value as EngineType)
    : undefined;
}

function readExecutionTargetSnapshot(
  content: Record<string, unknown>,
  fidelity: SharedProjectionItem["fidelity"],
): Extract<ConversationItem, { kind: "message" }>["executionTargetSnapshot"] {
  const value = content.executionTargetSnapshot;
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const snapshot = value as Record<string, unknown>;
  const engine = snapshot.engine;
  if (
    typeof engine !== "string" ||
    !BUILTIN_ENGINE_TYPES.includes(engine as EngineType)
  ) {
    return undefined;
  }
  const reasoning =
    snapshot.reasoning && typeof snapshot.reasoning === "object"
      ? (snapshot.reasoning as Record<string, unknown>)
      : null;
  const providerProfileId =
    typeof snapshot.providerProfileId === "string"
      ? snapshot.providerProfileId
      : null;
  const isCanonicalLocalTarget =
    fidelity === "canonical" &&
    providerProfileId === null &&
    snapshot.providerProfileSource === "local";
  const providerProfileSource =
    snapshot.providerProfileSource === "local" ||
    snapshot.providerProfileSource === "managed"
      ? snapshot.providerProfileSource
      : isCanonicalLocalTarget
        ? "local"
        : null;
  return {
    engine: engine as EngineType,
    providerProfileId,
    modelCatalogEntryId:
      typeof snapshot.modelCatalogEntryId === "string"
        ? snapshot.modelCatalogEntryId
        : null,
    model: typeof snapshot.model === "string" ? snapshot.model : null,
    reasoning:
      reasoning && typeof reasoning.effort === "string"
        ? { effort: reasoning.effort }
        : null,
    providerProfileNameSnapshot:
      typeof snapshot.providerProfileNameSnapshot === "string"
        ? snapshot.providerProfileNameSnapshot
        : isCanonicalLocalTarget
          ? LOCAL_PROVIDER_LABEL
          : null,
    providerProfileSource,
    runtimeCapabilityFingerprint:
      typeof snapshot.runtimeCapabilityFingerprint === "string"
        ? snapshot.runtimeCapabilityFingerprint
        : null,
    providerAvailable:
      typeof snapshot.providerAvailable === "boolean"
        ? snapshot.providerAvailable
        : true,
  };
}

function toConversationItem(item: SharedProjectionItem): ConversationItem | null {
  const { id, kind, content } = item;
  const engineSource = readEngineSource(content);

  switch (kind) {
    case "message": {
      const role = content.role === "user" ? "user" : "assistant";
      // Multi-Agent durable settle 摘要：不进独立气泡，由 HistoryFold 卡下汇总展示
      if (role === "assistant" && isMultiAgentSettledSummaryItemId(id)) {
        return null;
      }
      const executionTargetSnapshot = readExecutionTargetSnapshot(
        content,
        item.fidelity,
      );
      const rawImages = Array.isArray(content.images) ? content.images : [];
      const images = rawImages
        .filter((image): image is string => typeof image === "string")
        .map((image) => image.trim())
        .filter((image) => image.length > 0);
      return {
        id,
        kind: "message",
        role,
        text: readString(content, "text"),
        turnId: typeof content.turnId === "string" ? content.turnId : null,
        engineSource,
        ...(images.length > 0 ? { images } : {}),
        ...(executionTargetSnapshot ? { executionTargetSnapshot } : {}),
        isFinal: content.isFinal === true,
        ...(typeof content.finalCompletedAt === "number"
          ? { finalCompletedAt: content.finalCompletedAt }
          : {}),
        ...(typeof content.finalDurationMs === "number"
          ? { finalDurationMs: content.finalDurationMs }
          : {}),
        ...(typeof content.finalInputTokens === "number"
          ? { finalInputTokens: content.finalInputTokens }
          : {}),
        ...(typeof content.finalOutputTokens === "number"
          ? { finalOutputTokens: content.finalOutputTokens }
          : {}),
      };
    }
    case "reasoning":
      return {
        id,
        kind: "reasoning",
        summary: readString(content, "summary"),
        content: readString(content, "content"),
        engineSource,
      };
    case "tool": {
      return enrichSharedToolConversationItem({
        id,
        content,
        engineSource,
      });
    }
    case "generatedImage": {
      const rawImages = Array.isArray(content.images) ? content.images : [];
      const images = rawImages
        .filter(
          (image): image is { src: string; localPath?: string | null } =>
            typeof image === "object" &&
            image !== null &&
            typeof (image as { src?: unknown }).src === "string",
        )
        .map((image) => ({ src: image.src, localPath: image.localPath ?? null }));
      const status =
        content.status === "processing" || content.status === "degraded"
          ? content.status
          : "completed";
      return { id, kind: "generatedImage", engineSource, status, images };
    }
    case "diff":
      return {
        id,
        kind: "diff",
        title: readString(content, "title"),
        diff: readString(content, "diff"),
        ...(typeof content.status === "string" ? { status: content.status } : {}),
        engineSource,
      };
    case "review":
      return {
        id,
        kind: "review",
        state: content.state === "started" ? "started" : "completed",
        text: readString(content, "text"),
        engineSource,
      };
    case "explore": {
      const rawEntries = Array.isArray(content.entries) ? content.entries : [];
      const entries = rawEntries
        .filter(
          (entry): entry is { kind: "read" | "search" | "list" | "run"; label: string; detail?: string } =>
            typeof entry === "object" &&
            entry !== null &&
            ["read", "search", "list", "run"].includes(
              String((entry as { kind?: unknown }).kind),
            ) &&
            typeof (entry as { label?: unknown }).label === "string",
        )
        .map((entry) => ({
          kind: entry.kind,
          label: entry.label,
          ...(typeof entry.detail === "string" ? { detail: entry.detail } : {}),
        }));
      return {
        id,
        kind: "explore",
        status: content.status === "exploring" ? "exploring" : "explored",
        engineSource,
        entries,
      };
    }
    case "systemNotice":
    case "metadata":
      // Shadow 观测面，不属于 Canvas 渲染面。
      return null;
  }
}

/**
 * 把 Shared Projection items 映射为 ConversationItems。
 * 纯函数：不做 IO，不修改输入；输入顺序即输出顺序。
 */
export function toSharedConversationItems(
  items: readonly SharedProjectionItem[],
): ConversationItem[] {
  const mapped: ConversationItem[] = [];
  for (const item of items) {
    const conversationItem = toConversationItem(item);
    if (conversationItem !== null) {
      mapped.push(conversationItem);
    }
  }
  return mapped;
}

/**
 * DataSource 选择 seam：explicit-negative rollback 或输入为空时返回 `null`；
 * Shared loader 据此保留 Legacy-only 读取。
 */
export function resolveSharedConversationItems(
  items: readonly SharedProjectionItem[] | null | undefined,
): ConversationItem[] | null {
  if (!isSharedProjectionDataSourceEnabled() || !items) {
    return null;
  }
  return toSharedConversationItems(items);
}
