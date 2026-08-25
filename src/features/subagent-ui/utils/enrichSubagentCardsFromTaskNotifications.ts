import type { ConversationItem } from "../../../types";
import {
  isSubagentStyleAgentTaskNotification,
  parseAgentTaskNotification,
  type AgentTaskNotification,
} from "@/contracts/agentTaskNotification";
import type { SubagentCardStatus, SubagentCardViewModel } from "./subagentViewModel";

function mapNotificationStatus(
  status: string | null | undefined,
): SubagentCardStatus | null {
  const normalized = (status ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (/(fail|error|cancel|abort|timeout)/.test(normalized)) {
    return "error";
  }
  if (/(complete|success|succeed|done|finish)/.test(normalized)) {
    return "completed";
  }
  if (/(run|pending|progress|queued|start)/.test(normalized)) {
    return "running";
  }
  return null;
}

function basenameFromPath(path: string | null | undefined): string | null {
  const normalized = (path ?? "").trim().replace(/\\/g, "/");
  if (!normalized) {
    return null;
  }
  return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

/**
 * 安全边界 suffix：needle 作为 id 的后缀，且边界为 : / - _ 或全等。
 * 禁止 call_1 误匹配 call_12（裸 includes）。
 */
function hasSafeIdBoundaryMatch(id: string, needle: string): boolean {
  if (id === needle) {
    return true;
  }
  if (id.length <= needle.length) {
    return false;
  }
  if (!id.endsWith(needle)) {
    return false;
  }
  const boundary = id.charAt(id.length - needle.length - 1);
  return boundary === ":" || boundary === "/" || boundary === "-" || boundary === "_";
}

/**
 * tool item id / detail 与 notification.toolUseId 安全匹配。
 * - exact
 * - 安全 suffix（`tool:call-9` ↔ `call-9`）
 * - detail 中带引号/键值形态的精确出现（避免 call_1 命中 call_12）
 */
export function matchToolItemToNotificationToolUseId(
  toolItemId: string,
  toolDetail: string | null | undefined,
  toolUseId: string | null | undefined,
): boolean {
  const needle = (toolUseId ?? "").trim();
  if (!needle) {
    return false;
  }
  const id = toolItemId.trim();
  if (!id) {
    return false;
  }
  if (id === needle) {
    return true;
  }
  if (hasSafeIdBoundaryMatch(id, needle) || hasSafeIdBoundaryMatch(needle, id)) {
    return true;
  }
  const detail = typeof toolDetail === "string" ? toolDetail : "";
  if (!detail) {
    return false;
  }
  // 仅接受结构化边界，避免子串误伤
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const structured = new RegExp(
    `(?:["']|tool[_-]?use[_-]?id\\s*[:=]\\s*["']?|call[_-]?id\\s*[:=]\\s*["']?)${escaped}(?:["'\\s,}]|$)`,
    "i",
  );
  return structured.test(detail);
}

export function collectSubagentStyleNotificationsFromItems(
  items: readonly ConversationItem[] | null | undefined,
): AgentTaskNotification[] {
  if (!items || items.length === 0) {
    return [];
  }
  const result: AgentTaskNotification[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.kind !== "message") {
      continue;
    }
    const parsed = parseAgentTaskNotification(item.text);
    if (!parsed || !isSubagentStyleAgentTaskNotification(parsed)) {
      continue;
    }
    const key = `${parsed.taskId ?? ""}|${parsed.toolUseId ?? ""}|${parsed.summary ?? ""}|${parsed.resultText.slice(0, 64)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(parsed);
  }
  return result;
}

/** 合并多源 items（幕布 items ∪ 父 thread 表），notification 扫描用 */
export function mergeConversationItemSources(
  ...sources: Array<readonly ConversationItem[] | null | undefined>
): ConversationItem[] {
  const out: ConversationItem[] = [];
  const seenIds = new Set<string>();
  for (const source of sources) {
    if (!source) {
      continue;
    }
    for (const item of source) {
      const id = typeof item.id === "string" ? item.id : "";
      if (id) {
        if (seenIds.has(id)) {
          continue;
        }
        seenIds.add(id);
      }
      out.push(item);
    }
  }
  return out;
}

function descriptionMatchesSummary(
  description: string | null | undefined,
  summary: string | null | undefined,
): boolean {
  const desc = (description ?? "").trim();
  const sum = (summary ?? "").trim();
  if (!desc || !sum) {
    return false;
  }
  // summary 里 Agent "desc" / 智能体 "desc" —— 优先引号标题精确/包含（desc≥2）
  const quoted =
    /Agent\s+["“]([^"”]+)["”]/i.exec(sum) ??
    /智能体\s*["“]([^"”]+)["”]/.exec(sum);
  const title = quoted?.[1]?.trim() ?? "";
  if (title) {
    if (title === desc) {
      return true;
    }
    // 短 desc（如 "A"）禁止 includes，避免命中 "Agent"
    if (desc.length >= 2 && title.length >= 2) {
      if (title.includes(desc) || desc.includes(title)) {
        // 再挡一层：单字母/过短碎片
        if (desc.length >= 4 || title.length >= 4 || title === desc) {
          return true;
        }
      }
    }
    return false;
  }
  // 无引号时：desc 足够长才允许 sum.includes(desc)
  if (desc.length >= 6 && sum.includes(desc)) {
    return true;
  }
  return false;
}

function applyNotificationToCard(
  card: SubagentCardViewModel,
  notification: AgentTaskNotification,
): SubagentCardViewModel {
  const mappedStatus = mapNotificationStatus(notification.status);
  const nextStatus = mappedStatus ?? card.status;
  const resultText = notification.resultText?.trim() ?? "";
  const existingOutput = card.outputText?.trim() ?? "";
  const preferResult =
    resultText.length > 0 &&
    (resultText.length >= existingOutput.length ||
      /async agent launched/i.test(existingOutput));

  const outputFilePath =
    notification.outputFile?.trim() ||
    card.taskOutput?.outputFilePath ||
    null;
  const outputFileName =
    basenameFromPath(outputFilePath) ?? card.taskOutput?.outputFileName ?? null;
  const taskId =
    notification.taskId?.trim() || card.taskOutput?.taskId || null;
  const toolUseId =
    notification.toolUseId?.trim() ||
    card.taskOutput?.toolUseId ||
    card.id;

  const recentOutput = preferResult
    ? resultText
    : card.taskOutput?.recentOutput ?? card.outputText;

  return {
    ...card,
    status: nextStatus,
    progress: nextStatus === "running" ? card.progress : 1,
    outputText: preferResult ? resultText : card.outputText,
    taskOutput: card.taskOutput
      ? {
          ...card.taskOutput,
          status:
            nextStatus === "error"
              ? "error"
              : nextStatus === "completed"
                ? "completed"
                : "running",
          taskId,
          toolUseId,
          outputFilePath,
          outputFileName,
          recentOutput,
        }
      : {
          id: card.id,
          engine: "claude",
          title: card.typeLabel,
          description: card.description,
          status:
            nextStatus === "error"
              ? "error"
              : nextStatus === "completed"
                ? "completed"
                : "running",
          taskId,
          toolUseId,
          threadId: card.sessionThreadId,
          outputFilePath,
          outputFileName,
          recentOutput,
        },
  };
}

function findNotificationForCard(
  card: SubagentCardViewModel,
  notifications: readonly AgentTaskNotification[],
  tool: Extract<ConversationItem, { kind: "tool" }> | undefined,
  claimedNotificationKeys: Set<string>,
): AgentTaskNotification | null {
  const detail = tool && typeof tool.detail === "string" ? tool.detail : null;
  const matchKeys = [
    card.id,
    tool?.id,
    card.taskOutput?.toolUseId,
    // agentId 仅当看起来像 tool call id 时参与（避免 hex agentId 与 call_ 误碰）
    card.agentId && /call|tool|function/i.test(card.agentId) ? card.agentId : null,
  ].filter((value): value is string => Boolean(value && value.trim()));

  // 1) 有 toolUseId：安全 id 匹配
  for (const entry of notifications) {
    const key = notificationKey(entry);
    if (claimedNotificationKeys.has(key)) {
      continue;
    }
    if (!entry.toolUseId) {
      continue;
    }
    const hit = matchKeys.some((id) =>
      matchToolItemToNotificationToolUseId(id, detail, entry.toolUseId),
    );
    if (hit) {
      return entry;
    }
  }

  // 2) description ↔ summary 标题
  for (const entry of notifications) {
    const key = notificationKey(entry);
    if (claimedNotificationKeys.has(key)) {
      continue;
    }
    if (descriptionMatchesSummary(card.description, entry.summary)) {
      return entry;
    }
  }

  return null;
}

function notificationKey(entry: AgentTaskNotification): string {
  return `${entry.taskId ?? ""}|${entry.toolUseId ?? ""}|${entry.summary ?? ""}`;
}

/**
 * 将 SubAgent 型 task-notification 事实 enrich 进 S10 卡。
 * - 优先 toolUseId 安全匹配
 * - 其次 description/summary
 * - 无 toolUseId 且仅 1 张卡：fallback 到该卡（避免结果静默丢失）
 * - 多卡无匹配：不伪造
 */
export function enrichSubagentCardsFromTaskNotifications(
  cards: readonly SubagentCardViewModel[],
  items: readonly ConversationItem[] | null | undefined,
  toolItems?: readonly Extract<ConversationItem, { kind: "tool" }>[],
): SubagentCardViewModel[] {
  const notifications = collectSubagentStyleNotificationsFromItems(items);
  if (notifications.length === 0 || cards.length === 0) {
    return cards.slice();
  }

  const toolByCardId = new Map<string, Extract<ConversationItem, { kind: "tool" }>>();
  if (toolItems) {
    for (const tool of toolItems) {
      toolByCardId.set(tool.id, tool);
    }
  }

  const claimed = new Set<string>();
  const next = cards.map((card) => {
    // 多卡 expand 时 card.id 可能 ≠ tool.id；也按 agentId / 同源 tool 查找
    const tool =
      toolByCardId.get(card.id) ??
      (card.taskOutput?.toolUseId
        ? toolByCardId.get(card.taskOutput.toolUseId)
        : undefined) ??
      toolItems?.find((item) =>
        matchToolItemToNotificationToolUseId(
          item.id,
          typeof item.detail === "string" ? item.detail : null,
          card.id,
        ),
      );

    const notification = findNotificationForCard(
      card,
      notifications,
      tool,
      claimed,
    );
    if (!notification) {
      return card;
    }
    claimed.add(notificationKey(notification));
    return applyNotificationToCard(card, notification);
  });

  // 无 toolUseId 的 notification：单卡时强制挂上，避免结果丢失
  const orphanNotifications = notifications.filter(
    (entry) => !claimed.has(notificationKey(entry)),
  );
  if (orphanNotifications.length === 1 && next.length === 1) {
    const only = orphanNotifications[0]!;
    if (!only.toolUseId?.trim() || next[0]) {
      // 仅当尚未 enrich 过，或仍是 launch ack
      const current = next[0]!;
      const stillLaunch =
        !current.outputText?.trim() ||
        /async agent launched/i.test(current.outputText) ||
        current.status === "running";
      if (stillLaunch || !only.toolUseId?.trim()) {
        next[0] = applyNotificationToCard(current, only);
        claimed.add(notificationKey(only));
      }
    }
  }

  // 多 orphan + 多卡：仅当唯一 running 卡时挂第一个 orphan（保守）
  if (orphanNotifications.length >= 1 && next.length > 1) {
    const runningIndexes = next
      .map((card, index) => (card.status === "running" ? index : -1))
      .filter((index) => index >= 0);
    if (runningIndexes.length === 1) {
      const index = runningIndexes[0]!;
      const orphan = orphanNotifications[0]!;
      next[index] = applyNotificationToCard(next[index]!, orphan);
    }
  }

  return next;
}
