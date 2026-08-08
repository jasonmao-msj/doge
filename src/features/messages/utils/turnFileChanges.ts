/**
 * 回合级文件变更聚合 - 为「已编辑 N 个文件」回合汇总卡片提供数据。
 * 切段口径与 messagesLiveWindow.buildAssistantFinalBoundarySet 一致：
 * 以 user 消息分段，key 为段内最后一个 isFinal assistant 消息 id，
 * 卡片渲染在该消息的回合完成边界处。
 * 进行中回合（尚无 isFinal）写入 LIVE_TURN_FILE_CHANGES_BOUNDARY_ID，
 * 供 Composer 运行态条实时展示，不作为时间线回合边界卡。
 * 纯派生投影：不发请求、不 setState；单条工具项解析结果按引用 WeakMap 缓存，
 * 流式期间 items 数组高频变化时只对新引用做 JSON/diff 解析。
 */
import type { ConversationItem } from "../../../types";
import {
  asRecord,
  classifyToolCategory,
  parseToolArgs,
  pickStringField,
  resolveToolStatus,
  EDIT_CONTENT_KEYS,
  EDIT_NEW_KEYS,
  EDIT_OLD_KEYS,
  EDIT_PATH_KEYS,
  type ToolStatusTone,
} from "../components/toolBlocks/toolConstants";
import { computeDiffFromUnifiedPatch, computeDiffStats } from "../../../utils/diff";
import { resolveDiffPathFromWorkspacePath } from "../../../utils/workspacePaths";

type ToolItem = Extract<ConversationItem, { kind: "tool" }>;

/** 进行中回合（无 isFinal assistant）的会话汇总占位 key；非真实消息 id。 */
export const LIVE_TURN_FILE_CHANGES_BOUNDARY_ID = "__live_turn_file_changes__";

export type TurnFileChange = {
  path: string;
  additions: number;
  deletions: number;
  status: ToolStatusTone;
};

export type TurnFileChangesSummary = {
  files: TurnFileChange[];
  totalAdditions: number;
  totalDeletions: number;
};

/** path → "additions:deletions"，用于撤销后隐藏与「再编辑则重现」。 */
export type FileChangeSignatureMap = ReadonlyMap<string, string>;

export function fileChangeSignature(
  file: Pick<TurnFileChange, "additions" | "deletions">,
): string {
  return `${file.additions}:${file.deletions}`;
}

/**
 * 结构相等比较：供 TurnFilesChangedCard 的 memo 判定使用。
 * 派生函数每次重算都返回新 summary 对象，历史回合内容不变时靠它跳过卡片重渲染。
 */
export function areTurnFileChangesSummariesEqual(
  a: TurnFileChangesSummary,
  b: TurnFileChangesSummary,
): boolean {
  if (
    a.totalAdditions !== b.totalAdditions ||
    a.totalDeletions !== b.totalDeletions ||
    a.files.length !== b.files.length
  ) {
    return false;
  }
  return a.files.every((file, index) => {
    const other = b.files[index];
    return (
      file.path === other.path &&
      file.additions === other.additions &&
      file.deletions === other.deletions &&
      file.status === other.status
    );
  });
}

/**
 * 解析口径对齐 EditToolGroupBlock.parseEditItem：
 * fileChange 的 changes[].diff 走 unified patch 统计；
 * 否则从 detail JSON 的 old/new（Edit）或 content（Write）现算。
 * 区别：changes 里的多个文件各自成条，供按文件聚合。
 */
function parseEditToolChanges(item: ToolItem): TurnFileChange[] {
  const hasOutput = Boolean(item.output) || Boolean(item.changes?.length);
  const status = resolveToolStatus(item.status, hasOutput);

  if (item.toolType === "fileChange" && item.changes?.length) {
    return item.changes
      .filter((change) => Boolean(change.path))
      .map((change) => {
        const stats = computeDiffFromUnifiedPatch(change.diff ?? "");
        return { path: change.path, ...stats, status };
      });
  }

  const args = parseToolArgs(item.detail);
  const nestedInput = asRecord(args?.input);
  const nestedArgs = asRecord(args?.arguments);
  const path = pickStringField(args, nestedInput, nestedArgs, EDIT_PATH_KEYS);
  if (!path) {
    return [];
  }
  const oldString = pickStringField(
    args,
    nestedInput,
    nestedArgs,
    EDIT_OLD_KEYS,
  );
  const newString = pickStringField(
    args,
    nestedInput,
    nestedArgs,
    EDIT_NEW_KEYS,
  );
  if (oldString || newString) {
    return [{ path, ...computeDiffStats(oldString, newString), status }];
  }
  const content = pickStringField(
    args,
    nestedInput,
    nestedArgs,
    EDIT_CONTENT_KEYS,
  );
  if (content) {
    return [{ path, ...computeDiffStats("", content), status }];
  }
  return [{ path, additions: 0, deletions: 0, status }];
}

// reducer 不可变更新下已完成工具项引用稳定；引用变化（如状态流转）自然失效。
const editChangesCache = new WeakMap<ToolItem, TurnFileChange[]>();

function getEditToolChanges(item: ToolItem): TurnFileChange[] {
  const cached = editChangesCache.get(item);
  if (cached) {
    return cached;
  }
  const parsed = parseEditToolChanges(item);
  editChangesCache.set(item, parsed);
  return parsed;
}

function mergeStatus(a: ToolStatusTone, b: ToolStatusTone): ToolStatusTone {
  if (a === "failed" || b === "failed") {
    return "failed";
  }
  if (a === "processing" || b === "processing") {
    return "processing";
  }
  return "completed";
}

/**
 * 同 path 合并策略：
 * - 回合内多次工具调用：以最新一次统计为准（避免 5 轮 rewrite 把 +10 累加成 +60）。
 * - 跨回合 mergeTurnFileChangesSummaries：同样取后写入的 stats（会话 pill 最终以 git overlay 为准）。
 */
function accumulateFileChange(
  byPath: Map<string, TurnFileChange>,
  change: TurnFileChange,
) {
  const existing = byPath.get(change.path);
  byPath.set(
    change.path,
    existing
      ? {
          path: change.path,
          additions: change.additions,
          deletions: change.deletions,
          status: mergeStatus(existing.status, change.status),
        }
      : change,
  );
}

function buildSummaryFromByPath(
  byPath: Map<string, TurnFileChange>,
): TurnFileChangesSummary {
  // 只保留有实际净变更的文件：零增删多为「失败/空操作」或失败后重试的残留调用，
  // 展示出来会误导（曾把重试成功的文件也标成失败）。第一版只列真正写入了内容的文件。
  const files = Array.from(byPath.values()).filter(
    (file) => file.additions > 0 || file.deletions > 0,
  );
  return {
    files,
    totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

function summarizeEditItems(items: ToolItem[]): TurnFileChangesSummary {
  const byPath = new Map<string, TurnFileChange>();
  for (const item of items) {
    for (const change of getEditToolChanges(item)) {
      accumulateFileChange(byPath, change);
    }
  }
  return buildSummaryFromByPath(byPath);
}

/**
 * 合并多个回合汇总为全会话累计（同路径累加）。
 * 供时间线末尾（输入框上方）的常驻会话卡使用；无任何文件变更时返回 null。
 */
export function mergeTurnFileChangesSummaries(
  summaries: Iterable<TurnFileChangesSummary>,
): TurnFileChangesSummary | null {
  const byPath = new Map<string, TurnFileChange>();
  for (const summary of summaries) {
    for (const change of summary.files) {
      accumulateFileChange(byPath, change);
    }
  }
  const merged = buildSummaryFromByPath(byPath);
  return merged.files.length > 0 ? merged : null;
}

/** git status 行级统计（与 GitFileStatus 子集对齐） */
export type GitLineStatFile = {
  path: string;
  additions: number;
  deletions: number;
};

export type OverlaySessionFileChangesWithGitStatsOptions = {
  workspacePath?: string | null;
  /**
   * 回合进行中：git 尚未刷新时，对仍不在 dirty set 的 path 保留 tool 统计作临时展示。
   * 回合结束后为 false → 不在 git 中的 path 视为已 clean/撤销，从列表移除。
   */
  allowToolProvisional?: boolean;
};

/**
 * 将会话 tool 派生的「AI 碰过的 path」投影到 git status 行统计。
 * - path 集合仍来自会话编辑工具（只显示本会话 AI 相关文件，不含纯手动改动）。
 * - additions/deletions 优先用 git working tree 相对 HEAD 的统计（与右侧 Git 面板一致）。
 * - 回合结束后 git 中已不存在的 path 会移除（撤销/还原后 pill 自然消失）。
 */
export function overlaySessionFileChangesWithGitStats(
  session: TurnFileChangesSummary | null,
  gitFiles: readonly GitLineStatFile[] | null | undefined,
  options?: OverlaySessionFileChangesWithGitStatsOptions,
): TurnFileChangesSummary | null {
  if (!session || session.files.length === 0) {
    return null;
  }
  // git 不可用（非仓库 / 未接入）：退回 tool 统计
  if (gitFiles == null) {
    return session;
  }

  const workspacePath = options?.workspacePath ?? null;
  const allowToolProvisional = options?.allowToolProvisional ?? false;
  const availableGitPaths = gitFiles.map((file) => file.path);
  const gitByCanonicalPath = new Map<string, GitLineStatFile>();
  for (const file of gitFiles) {
    gitByCanonicalPath.set(file.path, file);
  }

  const files: TurnFileChange[] = [];
  for (const toolFile of session.files) {
    const matchedGitPath = resolveDiffPathFromWorkspacePath(
      toolFile.path,
      availableGitPaths,
      workspacePath,
    );
    const gitFile = matchedGitPath
      ? gitByCanonicalPath.get(matchedGitPath)
      : undefined;

    if (gitFile) {
      // 使用 git 路径与行统计；零增删仍展示（如 mode-only），与 git 面板一致
      files.push({
        path: gitFile.path,
        additions: gitFile.additions,
        deletions: gitFile.deletions,
        status: toolFile.status,
      });
      continue;
    }

    if (allowToolProvisional) {
      files.push(toolFile);
    }
    // else: git 已 clean → 从列表移除
  }

  if (files.length === 0) {
    return null;
  }
  return {
    files,
    totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

/**
 * 按「已撤销签名」过滤汇总：同 path 且增删统计未变则隐藏；
 * 统计变化视为代理再次编辑，重新展示。无可见文件时返回 null。
 */
export function filterTurnFileChangesSummary(
  summary: TurnFileChangesSummary | null,
  hiddenSignatures: FileChangeSignatureMap | null | undefined,
): TurnFileChangesSummary | null {
  if (!summary || summary.files.length === 0) {
    return null;
  }
  if (!hiddenSignatures || hiddenSignatures.size === 0) {
    return summary;
  }
  const files = summary.files.filter((file) => {
    const hidden = hiddenSignatures.get(file.path);
    if (hidden == null) {
      return true;
    }
    return fileChangeSignature(file) !== hidden;
  });
  if (files.length === 0) {
    return null;
  }
  return {
    files,
    totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

/**
 * 扫描会话 items，产出「回合末 final assistant 消息 id → 该回合文件变更汇总」。
 * 当前段尚无 isFinal 但已有编辑时，写入 LIVE_TURN_FILE_CHANGES_BOUNDARY_ID，
 * 使 Composer 运行态条可在回合进行中实时更新。
 * 历史段在遇到下一条 user 消息时若仍无 final，仍不产出（与旧口径一致）。
 */
export function buildTurnFileChangesByBoundaryId(
  items: ConversationItem[],
): Map<string, TurnFileChangesSummary> {
  const result = new Map<string, TurnFileChangesSummary>();
  let segmentEditItems: ToolItem[] = [];
  let boundaryId: string | null = null;

  const settleSegment = (options?: { allowLive?: boolean }) => {
    if (segmentEditItems.length === 0) {
      return;
    }
    const summary = summarizeEditItems(segmentEditItems);
    if (summary.files.length === 0) {
      return;
    }
    if (boundaryId) {
      result.set(boundaryId, summary);
      return;
    }
    if (options?.allowLive) {
      result.set(LIVE_TURN_FILE_CHANGES_BOUNDARY_ID, summary);
    }
  };

  for (const entry of items) {
    if (entry.kind === "message" && entry.role === "user") {
      // 关闭上一段：仅 settle 已有 final 的回合；未 finalize 的中间段丢弃（旧口径）
      settleSegment();
      segmentEditItems = [];
      boundaryId = null;
      continue;
    }
    if (
      entry.kind === "message" &&
      entry.role === "assistant" &&
      entry.isFinal === true
    ) {
      boundaryId = entry.id;
      continue;
    }
    if (entry.kind === "tool") {
      const category = classifyToolCategory(entry);
      if (category === "edit" || category === "fileChange") {
        segmentEditItems.push(entry);
      }
    }
  }
  // 尾段：有 final 走真实 boundary；进行中回合走 live key
  settleSegment({ allowLive: true });
  return result;
}
