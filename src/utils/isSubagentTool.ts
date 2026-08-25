import { extractToolName } from "./toolSemantics";

type ToolLike = {
  toolType?: unknown;
  title?: unknown;
  /** Shared 常把 description 顶成 title，识别要靠 detail */
  detail?: unknown;
};

function normalizeRuntimeString(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * 从 title 抽出 collab action（与 StatusPanel 口径对齐）。
 * 例："Collab: spawn Agent" → "spawn agent"
 *     "Collab: spawn_agent" → "spawn_agent" → 归一 "spawn agent"
 */
export function extractCollabActionName(title: unknown): string {
  const raw = typeof title === "string" ? title.trim() : "";
  if (!raw) {
    return "";
  }
  const stripped = raw
    .replace(/^collab:\s*/i, "")
    .replace(/^tool:\s*/i, "")
    .trim()
    .toLowerCase();
  // Codex 新协议 function name 用下划线：spawn_agent / wait_agent / close_agent
  return stripped.replace(/_/g, " ");
}

function isCollabToolType(toolType: string): boolean {
  return (
    toolType === "collabtoolcall" ||
    toolType === "collabagenttoolcall" ||
    // 部分历史/投影只带 title 不带标准 type
    toolType === "collaboration" ||
    toolType.includes("collab")
  );
}

/**
 * Codex collab 生命周期动作（wait/close）不渲染 persona 卡，只更新状态面板。
 * 兼容 "wait agent" / "wait_agent" / "close agent" / "close_agent"。
 */
export function isCollabLifecycleTool(item: ToolLike): boolean {
  const toolType = normalizeRuntimeString(item.toolType);
  const rawTitle =
    typeof item.title === "string" ? item.title.trim().toLowerCase() : "";
  const action = extractCollabActionName(item.title);
  const toolName = extractToolName(item.title).trim().toLowerCase().replace(/_/g, " ");
  const looksCollab =
    isCollabToolType(toolType) ||
    rawTitle.startsWith("collab:") ||
    toolName.includes("wait agent") ||
    toolName.includes("close agent") ||
    action === "wait agent" ||
    action === "close agent";
  if (!looksCollab && !isCollabToolType(toolType)) {
    // 无 collab 痕迹时，仅用 action 精确判断
    return (
      action === "wait agent" ||
      action === "wait" ||
      action === "close agent" ||
      action === "close"
    );
  }
  return (
    action === "wait agent" ||
    action === "wait" ||
    action === "close agent" ||
    action === "close" ||
    toolName === "wait agent" ||
    toolName === "close agent" ||
    /wait_agent|close_agent/.test(normalizeRuntimeString(item.toolType))
  );
}

/**
 * Codex collab 的 spawn 类工具：幕布要展开成 persona 卡。
 * 兼容 title "Collab: spawn Agent" / "Collab: spawn_agent" / tool name spawn_agent。
 */
export function isCollabSpawnTool(item: ToolLike): boolean {
  const toolType = normalizeRuntimeString(item.toolType);
  const rawTitle =
    typeof item.title === "string" ? item.title.trim().toLowerCase() : "";
  const action = extractCollabActionName(item.title);
  const toolName = extractToolName(item.title).trim().toLowerCase().replace(/_/g, " ");
  const isSpawnAction =
    action === "spawn agent" ||
    action === "spawn" ||
    action.startsWith("spawn ") ||
    toolName === "spawn agent" ||
    toolName.includes("spawn agent") ||
    rawTitle.includes("spawn_agent") ||
    rawTitle.includes("spawn agent");
  if (!isSpawnAction) {
    return false;
  }
  // 有 collab type/title 或明确 spawn_agent
  return (
    isCollabToolType(toolType) ||
    rawTitle.startsWith("collab:") ||
    toolName.includes("spawn agent") ||
    toolType === "spawn_agent" ||
    toolType.includes("spawn_agent")
  );
}

/**
 * Grok 轮询子代理输出的工具，不是 spawn，禁止当 persona 卡。
 */
export function isSubagentOutputPoller(item: ToolLike): boolean {
  const toolName = extractToolName(item.title).trim().toLowerCase();
  const toolType = normalizeRuntimeString(item.toolType);
  const rawTitle =
    typeof item.title === "string" ? item.title.trim().toLowerCase() : "";
  const haystack = `${toolName} ${toolType} ${rawTitle}`;
  return (
    haystack.includes("get_command_or_subagent_output") ||
    haystack.includes("get_command_or_subagent") ||
    (haystack.includes("subagent_output") && !haystack.includes("spawn"))
  );
}

/**
 * Grok `spawn_subagent` / 标题 “Spawn Subagent”。
 * 收窄匹配：避免 “spawn + subagent” 误伤其它工具名。
 */
export function isGrokSpawnSubagentTool(item: ToolLike): boolean {
  if (isSubagentOutputPoller(item)) {
    return false;
  }
  const toolName = extractToolName(item.title).trim().toLowerCase();
  const toolType = normalizeRuntimeString(item.toolType);
  const rawTitle =
    typeof item.title === "string" ? item.title.trim().toLowerCase() : "";
  if (
    toolType === "spawn_subagent" ||
    toolName === "spawn_subagent" ||
    toolName === "spawn subagent" ||
    rawTitle === "spawn subagent" ||
    rawTitle === "spawn_subagent"
  ) {
    return true;
  }
  // “Spawn Subagent xxx” 变体
  if (
    /^(spawn[_\s-]?subagent)\b/.test(toolName) ||
    /^(spawn[_\s-]?subagent)\b/.test(rawTitle)
  ) {
    return true;
  }
  return false;
}

/**
 * 幕布/分组用的 subAgent 识别（跨引擎）：
 * - Claude：Agent / Task
 * - Codex：collab spawn（非 wait/close）
 * - Grok：spawn_subagent / Spawn Subagent（非 output poller）
 * - Kimi / Shared：agent swarm 等
 */
/**
 * Shared/历史投影常把 spawn 的 description 顶成 title（如「问候测试代理1」），
 * toolType 也可能退化成 toolCall。靠 detail 里的 subagent 字段兜底，
 * 否则会同时出现 S10 小队卡 + 下方扳手行（同一批 Agent 双重渲染）。
 */
function looksLikeSubagentPayload(detail: unknown): boolean {
  if (typeof detail !== "string" || !detail.trim()) {
    return false;
  }
  if (
    /"subagent_type"\s*:/i.test(detail) ||
    /"subagentType"\s*:/i.test(detail) ||
    /"subagent_id"\s*:/i.test(detail) ||
    /"subagentId"\s*:/i.test(detail) ||
    /"agentId"\s*:/i.test(detail) ||
    /"agent_id"\s*:/i.test(detail)
  ) {
    return true;
  }
  // Claude Agent：detail 里有 description + 常见 type 枚举
  if (
    /"description"\s*:/i.test(detail) &&
    /"(general-purpose|explore|plan|debug|worker)"/i.test(detail)
  ) {
    return true;
  }
  return false;
}

export function isSubagentTool(item: ToolLike): boolean {
  if (isSubagentOutputPoller(item)) {
    return false;
  }
  if (isCollabLifecycleTool(item)) {
    return false;
  }
  if (isCollabSpawnTool(item)) {
    return true;
  }
  if (isGrokSpawnSubagentTool(item)) {
    return true;
  }

  const toolName = extractToolName(item.title).trim().toLowerCase();
  const toolType = normalizeRuntimeString(item.toolType);
  const rawTitle =
    typeof item.title === "string" ? item.title.trim().toLowerCase() : "";

  if (
    toolName === "task" ||
    toolName === "agent" ||
    toolType === "task" ||
    toolType === "agent"
  ) {
    return true;
  }

  // Grok 历史卡："Subagent 1 问候测试"（spawn 完成态标题）
  if (
    toolName.startsWith("subagent") ||
    rawTitle.startsWith("subagent") ||
    /^subagent\s*\d+/i.test(rawTitle)
  ) {
    return true;
  }

  // Kimi / multi-agent：Launching agent swarm …
  if (
    toolName.includes("agent swarm") ||
    toolName.includes("agent_swarm") ||
    rawTitle.includes("agent swarm") ||
    rawTitle.includes("launching agent swarm") ||
    toolType.includes("agent_swarm") ||
    toolType.includes("agentswarm")
  ) {
    return true;
  }

  // Codex / 其它：spawn agent / spawn_agent
  if (
    toolName.includes("spawn agent") ||
    rawTitle.includes("spawn agent") ||
    toolName.includes("spawn_agent") ||
    rawTitle.includes("spawn_agent") ||
    toolType === "spawn_agent" ||
    toolType.includes("spawn_agent")
  ) {
    return true;
  }

  // Shared description-as-title：payload 含 subagent_type 等字段时仍识别为子代理工具
  if (looksLikeSubagentPayload(item.detail)) {
    return true;
  }

  return false;
}
