import type { ConversationItem, EngineType } from "../../../types";
import {
  extractToolName,
  parseToolArgs,
  resolveToolStatus,
} from "../../../utils/toolSemantics";
import type { EngineTaskOutputSource } from "../../engine-task-output/types";
import type { SubagentInfo } from "../../status-panel/types";
import { isCollabSpawnTool, isGrokSpawnSubagentTool } from "@/utils/isSubagentTool";

/** 卡片固定展示名（UI 用 i18n `subagentUi.defaultName` 覆盖） */
export const FIXED_SUBAGENT_DISPLAY_NAME = "Subagent";

export type SubagentCardStatus = "running" | "completed" | "error";

export type SubagentCardViewModel = {
  id: string;
  displayName: string;
  indexLabel: string;
  description: string;
  typeLabel: string;
  status: SubagentCardStatus;
  /** 0..1；running 时 < 1 */
  progress: number;
  toolCount: number | null;
  outputText: string | null;
  taskOutput: EngineTaskOutputSource | null;
  githubLogin: string | null;
  githubProfileUrl: string | null;
  avatarSrc: string | null;
  /** 引擎侧 agent id（Claude agentId / Codex receiver thread / Grok subagent 序号） */
  agentId: string | null;
  /**
   * 可加载的子会话 threadId。
   * Claude: `claude:subagent:{parent}:{agentId}`
   * Codex: 裸 thread id（如 agent-7 / uuid）
   * Grok/Kimi: 有则 `grok:…` / `kimi:…`，否则 null（抽屉展示 output 回退）
   */
  sessionThreadId: string | null;
};

type ToolItem = Extract<ConversationItem, { kind: "tool" }>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getToolDetail(item: ToolItem): string {
  return typeof item.detail === "string" ? item.detail : "";
}

function getToolOutput(item: ToolItem): string | null {
  return typeof item.output === "string" ? item.output : null;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
}

/**
 * Codex 官方 collab spawn 的 message 常为 Fernet 密文（gAAAAA…），不可作 UI 文案。
 */
export function isOpaqueCiphertext(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  if (!v) {
    return false;
  }
  if (v.startsWith("gAAAAA")) {
    return true;
  }
  // 长 base64 且无空白/中文：几乎肯定是密文或 token
  if (
    v.length >= 64 &&
    !/\s/.test(v) &&
    !/[\u4e00-\u9fff]/.test(v) &&
    /^[A-Za-z0-9+/=_:-]+$/.test(v)
  ) {
    return true;
  }
  return false;
}

function pickReadableString(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const trimmed = candidate.trim();
    if (!trimmed || isOpaqueCiphertext(trimmed)) {
      continue;
    }
    return trimmed;
  }
  return "";
}

function extractDescription(args: Record<string, unknown> | null, item: ToolItem): string {
  // 优先可读字段；task_name 是 Codex spawn_agent 明文任务名（message 常为密文）
  const fromArgs = pickReadableString(
    args?.description,
    args?.task_name,
    args?.taskName,
    args?.agent_nickname,
    args?.agentNickname,
    args?.name,
    args?.label,
    args?.prompt,
    args?.prompt_template,
    args?.promptTemplate,
    args?.query,
    args?.task,
    args?.message,
  );
  if (fromArgs) {
    return fromArgs.slice(0, 160);
  }
  const title = typeof item.title === "string" ? item.title.trim() : "";
  // Grok: "Subagent 1 问候测试" → 去掉前缀留描述
  const subagentTitle = title.replace(/^subagent\s*\d+\s*/i, "").trim();
  if (
    subagentTitle &&
    subagentTitle.toLowerCase() !== title.toLowerCase() &&
    !isOpaqueCiphertext(subagentTitle)
  ) {
    return subagentTitle.slice(0, 160);
  }
  // Kimi swarm: "Launching agent swarm: xxx"
  const swarmTitle = title.replace(/^launching\s+agent\s+swarm:\s*/i, "").trim();
  if (
    swarmTitle &&
    swarmTitle.toLowerCase() !== title.toLowerCase() &&
    !isOpaqueCiphertext(swarmTitle)
  ) {
    return swarmTitle.slice(0, 160);
  }
  const outputLine = getToolOutput(item)?.split(/\r?\n/, 1)[0]?.trim();
  if (outputLine && !outputLine.startsWith("<") && !isOpaqueCiphertext(outputLine)) {
    return outputLine.slice(0, 160);
  }
  const toolLabel = extractToolName(item.title).replace(/^Tool:\s*/i, "").trim();
  if (toolLabel && !isOpaqueCiphertext(toolLabel) && toolLabel !== "spawn agent") {
    return toolLabel;
  }
  return "Subagent";
}

function extractTypeLabel(args: Record<string, unknown> | null, item: ToolItem): string {
  const raw =
    (typeof args?.subagent_type === "string" && args.subagent_type) ||
    (typeof args?.subagentType === "string" && args.subagentType) ||
    (typeof args?.agent === "string" && args.agent) ||
    (typeof args?.type === "string" && args.type) ||
    (typeof args?.name === "string" && args.name) ||
    "";
  if (raw.trim()) {
    return raw.trim();
  }
  if (isCollabSpawnTool(item)) {
    return "spawn";
  }
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const subagentMatch = /^subagent\s*(\d+)/i.exec(title);
  if (subagentMatch) {
    return `Subagent ${subagentMatch[1]}`;
  }
  return extractToolName(item.title).replace(/^collab:\s*/i, "").trim() || "agent";
}

function mapToolStatus(item: ToolItem): SubagentCardStatus {
  const output = getToolOutput(item) ?? "";
  const hasOutput = Boolean(output.trim());
  const normalized = (typeof item.status === "string" ? item.status : "").toLowerCase();

  if (
    /(fail|error|cancel|abort|timeout)/i.test(normalized) ||
    (/outcome\s*=\s*["']?(failed|error)["']?/i.test(output) || /\[failed\]/i.test(output))
  ) {
    return "error";
  }
  if (/(complete|success|succeed|done|finish)/i.test(normalized)) {
    return "completed";
  }

  // status 仍是 started/running：用 output 判断是否已收工（async spawn 常见）
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const onlyStartAck =
    lines.length > 0 &&
    lines.every((line) =>
      /^(subagent started|async agent launched|subagent_id\s*[:=]|agentId\s*[:=]|type\s*[:=]|description\s*[:=]|use get_command|status\s*[:=]\s*running)/i.test(
        line,
      ),
    );
  if (hasOutput && !onlyStartAck) {
    if (
      /outcome\s*=\s*["']?(completed|success)["']?/i.test(output) ||
      /\[completed\]/i.test(output) ||
      /status\s*[:=]\s*completed/i.test(output) ||
      (/duration_ms\s*=\s*\d+/i.test(output) && /subagent_meta/i.test(output)) ||
      /(你好|hello|完成|completed|问候|欢迎|任务)/i.test(output)
    ) {
      return "completed";
    }
  }

  const tone = resolveToolStatus(item.status, hasOutput);
  if (tone === "failed") {
    return "error";
  }
  if (tone === "completed") {
    return "completed";
  }
  return "running";
}

/**
 * 从 tool args / output 提取引擎侧 agent/subagent id（S10 与 Strip/inspector 共用）。
 * 支持：args 字段、纯文本 meta 行、以及历史投影的 JSON 信封（_input/_output）。
 */
export function extractAgentId(
  args: Record<string, unknown> | null,
  outputText: string | null,
): string | null {
  for (const key of [
    "agent_id",
    "agentId",
    "agentID",
    "subagent_id",
    "subagentId",
    "child_session_id",
    "childSessionId",
  ]) {
    const value = args?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  // args._input 嵌套（部分历史把整段 JSON 塞进 detail）
  const nestedInput = args?._input;
  if (nestedInput && typeof nestedInput === "object" && nestedInput !== null) {
    const nested = extractAgentId(nestedInput as Record<string, unknown>, null);
    if (nested) {
      return nested;
    }
  }
  if (!outputText) {
    return null;
  }
  const match =
    // 允许 grok:uuid / claude:… 完整 thread id
    /subagent_id\s*[:=]\s*['"]?([a-z0-9:_-]+)['"]?/i.exec(outputText) ??
    /"subagent_id"\s*:\s*"([^"]+)"/i.exec(outputText) ??
    /agentId\s*[:=]\s*['"]?([a-z0-9:_-]+)['"]?/i.exec(outputText) ??
    /"agentId"\s*:\s*"([^"]+)"/i.exec(outputText) ??
    /agent_id\s*[:=]\s*['"]?([a-z0-9:_-]+)['"]?/i.exec(outputText) ??
    /"agent_id"\s*:\s*"([^"]+)"/i.exec(outputText) ??
    /agent_id="([^"]+)"/i.exec(outputText) ??
    /child_session_id\s*[:=]\s*['"]?([a-z0-9:_-]+)['"]?/i.exec(outputText);
  return match?.[1]?.trim() || null;
}

/** tool 行 id / 占位 id，不能当 session 加载目标 */
function looksLikeOpaqueToolRowId(id: string): boolean {
  const raw = id.trim();
  if (!raw) return true;
  // tool use / 合成占位
  if (raw.startsWith("tool") || raw.includes("synthetic-")) return true;
  if (/^(spawn|task|agent)-/i.test(raw)) return true;
  // 完整引擎 thread id 或 UUID / Claude hex 都算合法 agent key
  if (
    raw.startsWith("claude:") ||
    raw.startsWith("grok:") ||
    raw.startsWith("kimi:") ||
    raw.startsWith("gemini:") ||
    raw.startsWith("opencode:") ||
    raw.startsWith("shared:")
  ) {
    return false;
  }
  if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(raw)) return false;
  if (looksLikeClaudeAgentId(raw)) return false;
  // 其它短 id 可能是 collab agent 名
  if (raw.length >= 4 && raw.length <= 64 && !/\s/.test(raw)) return false;
  return true;
}

/**
 * 由父会话 threadId + agentId 推导 Claude 子代理 threadId（与 sidebarInternals 一致）。
 */
export function resolveClaudeSubagentThreadId(
  parentThreadId: string | null | undefined,
  agentId: string | null | undefined,
): string | null {
  const parent = parentThreadId?.trim() ?? "";
  const agent = agentId?.trim() ?? "";
  if (!parent || !agent) {
    return null;
  }
  // 已是 compound id
  if (agent.startsWith("claude:subagent:")) {
    return agent;
  }
  const parentSessionId = parent.startsWith("claude:")
    ? parent.slice("claude:".length)
    : parent.startsWith("claude:subagent:")
      ? null
      : parent;
  if (!parentSessionId || parentSessionId.startsWith("subagent:")) {
    return null;
  }
  // strip nested subagent parent
  const bareParent = parentSessionId.includes(":")
    ? parentSessionId.split(":")[0] ?? parentSessionId
    : parentSessionId;
  return `claude:subagent:${bareParent}:${agent}`;
}

/** Claude Agent 异步启动回执（Shared Claude / native Claude 同源） */
export function isClaudeAsyncAgentLaunchOutput(
  output: string | null | undefined,
): boolean {
  const text = output ?? "";
  return (
    /Async agent launched successfully/i.test(text) &&
    /agentId\s*[:=]/i.test(text)
  );
}

/** Claude agentId 常见形态：12–32 位 hex，无连字符（文件名 agent-{id}.jsonl） */
export function looksLikeClaudeAgentId(agentId: string | null | undefined): boolean {
  const agent = agentId?.trim() ?? "";
  return /^[a-f0-9]{12,32}$/i.test(agent);
}

/**
 * 从 Claude Agent 启动回执的 output_file 路径提取 parent session UUID。
 *
 * 本地常见形态：
 * `/private/tmp/claude-501/.../<parentSessionId>/tasks/<agentId>.output`
 * `.../<parentSessionId>/subagents/agent-<agentId>.jsonl`（少见）
 *
 * Shared 绑定为空时，这是拼 `claude:subagent:{parent}:{agentId}` 的关键兜底。
 */
export function extractClaudeParentSessionIdFromAgentOutput(
  output: string | null | undefined,
): string | null {
  const text = output ?? "";
  if (!text.trim()) {
    return null;
  }
  const pathMatch =
    /output_file\s*[:=]\s*(\S+)/i.exec(text) ??
    /outputFile\s*[:=]\s*(\S+)/i.exec(text) ??
    /"output_file"\s*:\s*"([^"]+)"/i.exec(text) ??
    /"outputFile"\s*:\s*"([^"]+)"/i.exec(text);
  const rawPath = pathMatch?.[1]?.trim().replace(/[.,;)"']+$/, "") ?? "";
  if (rawPath) {
    const fromTasks =
      /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/tasks\//i.exec(
        rawPath,
      );
    if (fromTasks?.[1]) {
      return fromTasks[1];
    }
    const fromSubagents =
      /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/subagents\//i.exec(
        rawPath,
      );
    if (fromSubagents?.[1]) {
      return fromSubagents[1];
    }
    // DeepSeek / 部分 CLI：.../<sessionUUID>/<agentId>.output 无 tasks 段
    const fromDirect =
      /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(?:agent-)?[a-f0-9]{12,32}\.output/i.exec(
        rawPath,
      );
    if (fromDirect?.[1]) {
      return fromDirect[1];
    }
  }
  // 无 path 时：部分回执会写 session 字段
  const sessionField =
    /(?:parent_)?session(?:_id|Id)?\s*[:=]\s*['"]?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
      text,
    );
  return sessionField?.[1]?.trim() || null;
}

/**
 * Shared Claude / DeepSeek：从父线 items + child 线程列表补齐 claude:subagent 会话 id。
 * 解决 nativeThreadIds 空、单卡 output 缺 output_file 时详情只显示 launch 提示。
 */
export function resolveClaudeSubagentSessionFromContext(options: {
  agentId: string | null | undefined;
  outputText?: string | null;
  nativeThreadIds?: readonly string[] | null;
  /** canvas childSubagentThreads ids */
  childThreadIds?: readonly string[] | null;
  /** 父会话时间线（扫 Agent tool 的 output_file） */
  parentItems?: readonly ConversationItem[] | null;
}): string | null {
  const agent = options.agentId?.trim() || "";
  if (!agent || !looksLikeClaudeAgentId(agent)) {
    return null;
  }

  // 1) 侧栏/canvas 已有完整子会话 id
  for (const raw of options.childThreadIds ?? []) {
    const id = raw.trim();
    if (!id) continue;
    if (id.startsWith("claude:subagent:") && id.endsWith(`:${agent}`)) {
      return id;
    }
  }

  // 2) 父线所有 tool 输出里找该 agentId 的 output_file / session
  let ownerFromItems: string | null = null;
  let richerOutput = options.outputText ?? "";
  for (const item of options.parentItems ?? []) {
    if (!item || item.kind !== "tool") continue;
    const detail = typeof item.detail === "string" ? item.detail : "";
    const output = typeof item.output === "string" ? item.output : "";
    const hay = `${detail}\n${output}`;
    if (!hay.includes(agent)) continue;
    if (output.length > richerOutput.length) {
      richerOutput = output;
    }
    const fromItem = extractClaudeParentSessionIdFromAgentOutput(hay);
    if (fromItem) {
      ownerFromItems = fromItem;
      break;
    }
  }

  const claudeOwner =
    pickClaudeNativeOwnerId(options.nativeThreadIds) ||
    (ownerFromItems ? `claude:${ownerFromItems}` : null) ||
    (() => {
      const fromOutput = extractClaudeParentSessionIdFromAgentOutput(richerOutput);
      return fromOutput ? `claude:${fromOutput}` : null;
    })();

  if (!claudeOwner) {
    return null;
  }
  return resolveClaudeSubagentThreadId(claudeOwner, agent);
}

function pickClaudeNativeOwnerId(
  nativeThreadIds: readonly string[] | null | undefined,
): string | null {
  if (!nativeThreadIds?.length) {
    return null;
  }
  for (const raw of nativeThreadIds) {
    const id = raw.trim();
    if (!id.startsWith("claude:")) {
      continue;
    }
    if (id.includes(":subagent:") || id.startsWith("claude:subagent:")) {
      continue;
    }
    if (id.includes("pending")) {
      continue;
    }
    return id;
  }
  return null;
}

/**
 * 跨引擎解析子会话 threadId。
 *
 * Shared Claude 场景：父是 shared:…，子会话在 native owner 下
 * `claude:subagent:{nativeSessionId}:{agentId}`，不能返回裸 agentId（会走 codex loader）。
 */
export function resolveSubagentSessionThreadId(options: {
  parentThreadId?: string | null;
  agentId?: string | null;
  /** Codex collab receiver 等已是完整 thread id 时直接使用 */
  explicitThreadId?: string | null;
  outputText?: string | null;
  /** Shared 父会话的 nativeThreadIds（含 claude: owner） */
  nativeThreadIds?: readonly string[] | null;
}): string | null {
  const explicit = options.explicitThreadId?.trim() || null;
  if (explicit) {
    return explicit;
  }
  const parent = options.parentThreadId?.trim() || "";
  const agent = options.agentId?.trim() || "";
  if (!agent) {
    return null;
  }
  // 已是完整引擎前缀 id
  if (
    agent.startsWith("claude:") ||
    agent.startsWith("grok:") ||
    agent.startsWith("kimi:") ||
    agent.startsWith("gemini:") ||
    agent.startsWith("opencode:") ||
    agent.startsWith("shared:")
  ) {
    return agent;
  }
  if (parent.startsWith("claude:")) {
    return resolveClaudeSubagentThreadId(parent, agent);
  }
  if (parent.startsWith("grok:")) {
    return agent.includes(":") ? agent : `grok:${agent}`;
  }
  if (parent.startsWith("kimi:")) {
    return agent.includes(":") ? agent : `kimi:${agent}`;
  }
  if (parent.startsWith("shared:")) {
    if (agent.includes(":")) {
      return agent;
    }
    // Shared Claude Agent 启动回执 / Claude 风格 agentId → claude:subagent
    // 1) bindings 里的 native owner
    // 2) 启动回执 output_file 路径里的 parent session UUID（bindings 常为空时的关键兜底）
    // 3) 调用方可通过 resolveClaudeSubagentSessionFromContext 再补 parentItems/child 列表
    const claudeOwner =
      pickClaudeNativeOwnerId(options.nativeThreadIds) ||
      (() => {
        const fromOutput = extractClaudeParentSessionIdFromAgentOutput(
          options.outputText,
        );
        return fromOutput ? `claude:${fromOutput}` : null;
      })();
    if (
      claudeOwner &&
      (isClaudeAsyncAgentLaunchOutput(options.outputText) ||
        looksLikeClaudeAgentId(agent))
    ) {
      return resolveClaudeSubagentThreadId(claudeOwner, agent);
    }
    // 裸 UUID：可能是 Grok 子会话，也可能是 Codex collab 子 thread。
    // 误加 grok: 前缀会导致 Codex 详情加载失败 → 只剩「交付报告」合成文本。
    if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(agent)) {
      if (isClaudeAsyncAgentLaunchOutput(options.outputText)) {
        return null;
      }
      const natives = options.nativeThreadIds ?? [];
      const hasGrokOwner = natives.some((id) => id.startsWith("grok:"));
      const hasCodexOwner = natives.some(
        (id) =>
          id.startsWith("codex:") ||
          (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(id) && !id.includes(":")),
      );
      // 仅当明确是 Grok Shared 且无 Codex owner 时加 grok: 前缀
      if (hasGrokOwner && !hasCodexOwner) {
        return `grok:${agent}`;
      }
      // Codex / 未知：裸 UUID 走 codex history loader
      return agent;
    }
    // Claude hex agentId 但无法定位 parent session
    if (
      isClaudeAsyncAgentLaunchOutput(options.outputText) &&
      looksLikeClaudeAgentId(agent)
    ) {
      return null;
    }
    return agent;
  }
  // Codex 等裸 thread id
  if (!parent.includes(":") || parent.startsWith("codex:")) {
    return agent;
  }
  return agent;
}

function inferEngineFromThreadId(
  threadId: string | null | undefined,
): EngineType | "claude" {
  const id = threadId?.trim() ?? "";
  if (id.startsWith("claude:")) return "claude";
  if (id.startsWith("grok:")) return "grok";
  if (id.startsWith("kimi:")) return "kimi";
  if (id.startsWith("gemini:")) return "gemini";
  if (id.startsWith("opencode:")) return "opencode";
  if (id.startsWith("shared:")) return "codex";
  return "codex";
}

function extractOutputFilePath(
  args: Record<string, unknown> | null,
  outputText: string | null,
): string | null {
  const fromArgs = [
    args?.output_file,
    args?.outputFile,
    args?.output_file_path,
    args?.outputFilePath,
    args?.artifact_path,
    args?.artifactPath,
  ];
  for (const value of fromArgs) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  if (!outputText) {
    return null;
  }
  const match =
    /output_file\s*[:=]\s*(\S+)/i.exec(outputText) ??
    /outputFile\s*[:=]\s*(\S+)/i.exec(outputText);
  const path = match?.[1]?.trim();
  return path && path.length > 0 ? path.replace(/[.,;)"']+$/, "") : null;
}

function extractToolCount(
  args: Record<string, unknown> | null,
  item: ToolItem,
): number | null {
  const candidates = [
    args?.tool_count,
    args?.toolCount,
    args?.tools_used,
    args?.num_tools,
    (item as { toolCount?: unknown }).toolCount,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
      return Number.parseInt(value.trim(), 10);
    }
  }
  const agentStatus = asRecord((item as { agentStatus?: unknown }).agentStatus);
  if (agentStatus) {
    return Object.keys(agentStatus).length || null;
  }
  return null;
}

export function resolveSubagentProgress(
  status: SubagentCardStatus,
  toolCount: number | null,
): number {
  if (status === "completed" || status === "error") {
    return 1;
  }
  const count = toolCount ?? 0;
  return Math.min(0.85, 0.12 + count * 0.06);
}

function formatIndexLabel(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/** 不再绑定贡献者头像 / GitHub 名；并行实例靠 indexLabel 区分 */
function applyFixedSubagentIdentity(): Pick<
  SubagentCardViewModel,
  "displayName" | "githubLogin" | "githubProfileUrl" | "avatarSrc"
> {
  return {
    displayName: FIXED_SUBAGENT_DISPLAY_NAME,
    githubLogin: null,
    githubProfileUrl: null,
    avatarSrc: null,
  };
}

/**
 * 从 collab spawn / agentStatus / detail 箭头解析出 receiver agent thread ids。
 */
export function extractCollabAgentIds(item: ToolItem): string[] {
  const fromReceivers = Array.isArray(item.receiverThreadIds)
    ? item.receiverThreadIds.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0,
      )
    : [];
  const agentStatus = asRecord((item as { agentStatus?: unknown }).agentStatus);
  const fromStatus = agentStatus
    ? Object.keys(agentStatus).filter((key) => {
        const lower = key.toLowerCase();
        return (
          lower !== "status" &&
          lower !== "state" &&
          !lower.endsWith("ids") &&
          key.trim().length > 0
        );
      })
    : [];
  const detail = getToolDetail(item);
  const arrowMatch = /(?:→|->)\s*(.+)$/.exec(detail);
  const fromDetail = arrowMatch
    ? arrowMatch[1]
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
  return uniqueStrings([...fromReceivers, ...fromStatus, ...fromDetail]);
}

/** AgentSwarm 展开条目：XML 结果带独立 body，items 占位无 body。 */
export type SwarmAgentEntry = {
  id: string;
  description: string;
  status: SubagentCardStatus;
  /**
   * 仅 `<subagent>…</subagent>` 解析结果有值：该代理交付正文（不含 XML 外壳）。
   * 详情抽屉应只展示此正文，禁止回退到父 tool 整包 agent_swarm_result。
   */
  outputText?: string | null;
  /** wire / XML 上的 agent_id（如 agent-0），用于 dedupe，不表示可加载 session */
  agentKey?: string | null;
  /**
   * true：已从 XML 拆出独立结果。此时禁止把 agent-0 映射成 kimi:agent-0 去加载
   *（Kimi history 只读 agents/main，假 id 会失败并污染详情）。
   */
  isolatedResult?: boolean;
};

/**
 * 从 agent swarm 参数 / result XML 展开子代理条目。
 * 优先 XML 结果（完成态真实报告），否则用 items 占位；二者互斥，避免 3+3=6 重复计数。
 */
export function extractSwarmAgentEntries(
  item: ToolItem,
  args: Record<string, unknown> | null,
): SwarmAgentEntry[] {
  const status = mapToolStatus(item);
  const baseDescription = extractDescription(args, item);
  const fromXml: SwarmAgentEntry[] = [];

  const output = getToolOutput(item) ?? "";
  const subagentTagRegex = /<subagent\b([^>]*)>([\s\S]*?)<\/subagent>/gi;
  let match: RegExpExecArray | null;
  while ((match = subagentTagRegex.exec(output)) !== null) {
    const attrs = match[1] ?? "";
    const body = (match[2] ?? "").trim();
    const agentId =
      /agent_id\s*=\s*"([^"]+)"/i.exec(attrs)?.[1] ??
      /agent-id\s*=\s*"([^"]+)"/i.exec(attrs)?.[1] ??
      null;
    const itemLabel = /item\s*=\s*"([^"]+)"/i.exec(attrs)?.[1] ?? null;
    const outcome = /outcome\s*=\s*"([^"]+)"/i.exec(attrs)?.[1]?.toLowerCase() ?? "";
    const entryStatus: SubagentCardStatus =
      outcome === "failed" || outcome === "error"
        ? "error"
        : outcome === "completed" || outcome === "success"
          ? "completed"
          : status;
    const firstLine =
      body.split(/\r?\n/, 1)[0]?.replace(/^#+\s*/, "").trim() || baseDescription;
    fromXml.push({
      id: `${item.id}:swarm-result:${agentId ?? itemLabel ?? fromXml.length}`,
      description: firstLine.slice(0, 160),
      status: entryStatus,
      // 空 body 也视为已隔离：宁可详情为空，也不要整包 XML 泄漏到每张卡
      outputText: body.length > 0 ? body : null,
      agentKey: agentId ?? itemLabel,
      isolatedResult: true,
    });
  }
  if (fromXml.length > 0) {
    return fromXml;
  }

  const fromItems: SwarmAgentEntry[] = [];
  const itemsField = args?.items ?? args?.ITEMS;
  if (Array.isArray(itemsField) && itemsField.length > 0) {
    itemsField.forEach((entry, index) => {
      const label =
        typeof entry === "string" || typeof entry === "number"
          ? String(entry)
          : `item-${index + 1}`;
      fromItems.push({
        id: `${item.id}:swarm:${label}`,
        description: `${baseDescription} · #${label}`.slice(0, 160),
        status,
      });
    });
  }
  return fromItems;
}

type CardBuildOptions = {
  index?: number;
  parentThreadId?: string | null;
  /** Shared 父会话 nativeThreadIds，用于 Claude Agent 子会话 id 解析 */
  nativeThreadIds?: readonly string[] | null;
  /** 覆盖 id / agentId / description / status（swarm / collab 展开用） */
  override?: {
    id?: string;
    agentId?: string | null;
    explicitThreadId?: string | null;
    description?: string;
    typeLabel?: string;
    status?: SubagentCardStatus;
    /**
     * 覆盖交付正文。undefined = 沿用父 tool.output；
     * null/string = 强制使用（AgentSwarm 按 subagent 拆 body 时用）。
     */
    outputText?: string | null;
    /**
     * true：不解析 sessionThreadId（AgentSwarm XML 结果无独立可加载 session）。
     * 不影响 Claude/Codex/Grok 的 agentId → 子会话映射。
     */
    suppressSessionThread?: boolean;
  };
};

export function buildSubagentCardFromToolItem(
  item: ToolItem,
  options?: CardBuildOptions,
): SubagentCardViewModel {
  const args = parseToolArgs(getToolDetail(item));
  const status = options?.override?.status ?? mapToolStatus(item);
  const toolCount = extractToolCount(args, item);
  const description =
    options?.override?.description ?? extractDescription(args, item);
  const typeLabel = options?.override?.typeLabel ?? extractTypeLabel(args, item);
  const cardId = options?.override?.id ?? item.id;
  const parentOutputText = getToolOutput(item);
  // 仅当 override 显式传入 outputText（含 null）时覆盖；其它路径保持父 tool 原文
  const outputText =
    options?.override && Object.prototype.hasOwnProperty.call(options.override, "outputText")
      ? (options.override.outputText ?? null)
      : parentOutputText;
  // output_file / Claude launch 元数据仍从父 tool 原文解析，避免被拆 body 后丢字段
  const outputFilePath = extractOutputFilePath(args, parentOutputText);
  const agentId =
    options?.override?.agentId ?? extractAgentId(args, parentOutputText);
  const sessionThreadId = options?.override?.suppressSessionThread
    ? null
    : resolveSubagentSessionThreadId({
        parentThreadId: options?.parentThreadId,
        agentId,
        explicitThreadId: options?.override?.explicitThreadId,
        outputText: parentOutputText,
        nativeThreadIds: options?.nativeThreadIds,
      });
  const taskId =
    typeof args?.task_id === "string"
      ? args.task_id
      : typeof args?.taskId === "string"
        ? args.taskId
        : null;
  const outputFileName = outputFilePath
    ? outputFilePath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? outputFilePath
    : null;
  const engine = inferEngineFromThreadId(
    sessionThreadId ?? options?.parentThreadId,
  );

  const taskOutput: EngineTaskOutputSource = {
    id: cardId,
    engine,
    title: typeLabel,
    description,
    status: status === "error" ? "error" : status === "completed" ? "completed" : "running",
    taskId,
    toolUseId: item.id,
    threadId: sessionThreadId,
    outputFilePath,
    outputFileName,
    recentOutput: outputText,
  };

  return {
    id: cardId,
    ...applyFixedSubagentIdentity(),
    indexLabel: formatIndexLabel(options?.index ?? 0),
    description,
    typeLabel,
    status,
    progress: resolveSubagentProgress(status, toolCount),
    toolCount,
    outputText,
    taskOutput,
    agentId,
    sessionThreadId,
  };
}

/**
 * 将一个 tool item 展开为 1..N 张 persona 卡（collab multi-agent / agent swarm / grok spawn）。
 */
export function expandSubagentToolToCards(
  item: ToolItem,
  options?: {
    parentThreadId?: string | null;
    indexOffset?: number;
    nativeThreadIds?: readonly string[] | null;
  },
): SubagentCardViewModel[] {
  const indexOffset = options?.indexOffset ?? 0;
  const args = parseToolArgs(getToolDetail(item));
  const outputText = getToolOutput(item);
  const nativeThreadIds = options?.nativeThreadIds;

  // Codex collab spawn：按 receiver agent 展开
  if (isCollabSpawnTool(item)) {
    const agentIds = extractCollabAgentIds(item);
    const taskName = pickReadableString(args?.task_name, args?.taskName, args?.name);
    const description = extractDescription(args, item);
    if (agentIds.length > 0) {
      return agentIds.map((agentId, index) =>
        buildSubagentCardFromToolItem(item, {
          index: indexOffset + index,
          parentThreadId: options?.parentThreadId,
          nativeThreadIds,
          override: {
            id: `${item.id}:${agentId}`,
            agentId,
            explicitThreadId: agentId,
            // 不要用 UUID 当 typeLabel；优先 task_name
            typeLabel: taskName || "agent",
            description: description || taskName || "Subagent",
          },
        }),
      );
    }
    // 尚无 receiver：单卡，描述用 task_name，勿展示密文 message
    return [
      buildSubagentCardFromToolItem(item, {
        index: indexOffset,
        parentThreadId: options?.parentThreadId,
        nativeThreadIds,
        override: {
          typeLabel: taskName || "spawn",
          description: description || taskName || "Subagent",
          // 清掉密文 output，避免详情当交付报告
          ...(isOpaqueCiphertext(outputText) ? { description: taskName || "Subagent" } : {}),
        },
      }),
    ];
  }

  // Grok spawn_subagent：单卡，session 用 subagent_id → grok:{id}
  if (isGrokSpawnSubagentTool(item)) {
    const agentId = extractAgentId(args, outputText);
    const description =
      (typeof args?.description === "string" && args.description.trim()) ||
      (typeof args?.prompt === "string" && args.prompt.trim().slice(0, 80)) ||
      extractDescription(args, item);
    const typeLabel =
      (typeof args?.subagent_type === "string" && args.subagent_type) ||
      (typeof args?.subagentType === "string" && args.subagentType) ||
      "general-purpose";
    return [
      buildSubagentCardFromToolItem(item, {
        index: indexOffset,
        parentThreadId: options?.parentThreadId,
        nativeThreadIds,
        override: {
          id: agentId ? `${item.id}:${agentId}` : item.id,
          agentId,
          description,
          typeLabel,
        },
      }),
    ];
  }

  // Agent swarm：按 items / XML result 展开（互斥）
  // XML 结果：每张卡只挂该 <subagent> body，禁止共享整包 agent_swarm_result。
  const swarmEntries = extractSwarmAgentEntries(item, args);
  if (swarmEntries.length > 0) {
    return swarmEntries.map((entry, index) =>
      buildSubagentCardFromToolItem(item, {
        index: indexOffset + index,
        parentThreadId: options?.parentThreadId,
        nativeThreadIds,
        override: {
          id: entry.id,
          agentId:
            entry.agentKey?.trim() ||
            (entry.id.includes(":") ? entry.id.split(":").pop() ?? null : entry.id),
          description: entry.description,
          status: entry.status,
          typeLabel: extractTypeLabel(args, item),
          // 仅 XML 隔离结果覆盖 output / 禁止假 session；items 占位保持原行为
          ...(entry.isolatedResult
            ? {
                outputText: entry.outputText ?? null,
                suppressSessionThread: true,
              }
            : {}),
        },
      }),
    );
  }

  return [
    buildSubagentCardFromToolItem(item, {
      index: indexOffset,
      parentThreadId: options?.parentThreadId,
      nativeThreadIds,
    }),
  ];
}

/**
 * 小队去重：
 * 1) 同组既有 launch items 占位又有 XML 结果时，丢掉 items 占位（防 3+3=6）
 * 2) 相同 agentId 保留完成度更高 / 描述更完整的一张
 */
export function dedupeSubagentSquadCards(
  cards: readonly SubagentCardViewModel[],
): SubagentCardViewModel[] {
  if (cards.length <= 1) {
    return [...cards];
  }
  const hasXmlResult = cards.some((card) => card.id.includes(":swarm-result:"));
  const withoutItemsPlaceholder = hasXmlResult
    ? cards.filter(
        (card) =>
          !card.id.includes(":swarm:") || card.id.includes(":swarm-result:"),
      )
    : [...cards];

  const byKey = new Map<string, SubagentCardViewModel>();
  const rank = (card: SubagentCardViewModel) => {
    let score = 0;
    if (card.status === "completed") score += 4;
    if (card.status === "error") score += 3;
    if (card.id.includes(":swarm-result:")) score += 2;
    if (card.sessionThreadId) score += 1;
    score += Math.min(2, Math.floor(card.description.length / 40));
    // 真实 collab/spawn tool 优先于 synthetic-*-subagent 占位，避免 live 双卡
    if (card.id.includes("synthetic-") && card.id.includes("-subagent:")) {
      score -= 5;
    }
    return score;
  };

  withoutItemsPlaceholder.forEach((card) => {
    const key =
      (card.agentId && card.agentId.trim()) ||
      /#(\d+)\s*$/.exec(card.description)?.[1] ||
      card.id;
    const existing = byKey.get(key);
    if (!existing || rank(card) >= rank(existing)) {
      byKey.set(key, card);
    }
  });

  // 保持相对稳定顺序：按首次出现顺序
  const seen = new Set<string>();
  const ordered: SubagentCardViewModel[] = [];
  withoutItemsPlaceholder.forEach((card) => {
    const key =
      (card.agentId && card.agentId.trim()) ||
      /#(\d+)\s*$/.exec(card.description)?.[1] ||
      card.id;
    if (seen.has(key)) {
      return;
    }
    const chosen = byKey.get(key);
    if (chosen) {
      seen.add(key);
      ordered.push(chosen);
    }
  });
  return ordered;
}

export type ChildThreadHint = {
  id: string;
  name?: string | null;
};

/**
 * 用侧栏真实子会话补全 collab 卡：sessionThreadId + 昵称描述。
 * Native Codex 官方 spawn 的 message 是密文，但子会话已有 Nietzsche 等名字。
 */
export function enrichCardsWithChildThreads(
  cards: readonly SubagentCardViewModel[],
  children: readonly ChildThreadHint[] | null | undefined,
): SubagentCardViewModel[] {
  if (!children?.length) {
    return cards.map((card) =>
      isOpaqueCiphertext(card.description)
        ? { ...card, description: card.typeLabel || "Subagent", outputText: null }
        : isOpaqueCiphertext(card.outputText)
          ? { ...card, outputText: null }
          : card,
    );
  }
  const usedChildIds = new Set<string>();
  let childCursor = 0;

  return cards.map((card) => {
    let next = card;
    // 已有合法 session 且描述可读
    const hasReadableDesc = Boolean(
      next.description && !isOpaqueCiphertext(next.description),
    );
    const hasSession = Boolean(next.sessionThreadId?.trim());

    if (hasSession && hasReadableDesc && !isOpaqueCiphertext(next.outputText)) {
      return next;
    }

    // 按序绑定未使用的子会话
    while (childCursor < children.length && usedChildIds.has(children[childCursor]!.id)) {
      childCursor += 1;
    }
    const child = children[childCursor];
    if (child) {
      usedChildIds.add(child.id);
      childCursor += 1;
      const childName = child.name?.trim() || "";
      next = {
        ...next,
        sessionThreadId: next.sessionThreadId?.trim() || child.id,
        agentId: next.agentId || child.id,
        description:
          hasReadableDesc && !isOpaqueCiphertext(next.description)
            ? next.description
            : childName || next.description || "Subagent",
        typeLabel:
          next.typeLabel &&
          next.typeLabel !== "spawn" &&
          next.typeLabel !== "agent" &&
          !isOpaqueCiphertext(next.typeLabel) &&
          next.typeLabel.length < 40
            ? next.typeLabel
            : childName || next.typeLabel,
        // 密文 output 清掉，详情走子会话 transcript
        outputText: isOpaqueCiphertext(next.outputText) ? null : next.outputText,
      };
    } else if (isOpaqueCiphertext(next.description) || isOpaqueCiphertext(next.outputText)) {
      next = {
        ...next,
        description: isOpaqueCiphertext(next.description)
          ? next.typeLabel && next.typeLabel !== "spawn"
            ? next.typeLabel
            : "Subagent"
          : next.description,
        outputText: isOpaqueCiphertext(next.outputText) ? null : next.outputText,
      };
    }
    return next;
  });
}

export function buildSubagentCardsFromToolItems(
  items: readonly ToolItem[],
  options?: {
    parentThreadId?: string | null;
    nativeThreadIds?: readonly string[] | null;
    /** 侧栏子会话（含 nickname），用于 Codex 官方密文 message 场景 */
    childThreads?: readonly ChildThreadHint[] | null;
  },
): SubagentCardViewModel[] {
  const cards: SubagentCardViewModel[] = [];
  // 组内任一 tool 已有 XML 结果时，跳过纯 items 占位展开（launch 与 result 拆成两条 tool 的场景）
  const groupHasSwarmXml = items.some((item) =>
    /<subagent\b/i.test(getToolOutput(item) ?? ""),
  );

  items.forEach((item) => {
    if (groupHasSwarmXml) {
      const args = parseToolArgs(getToolDetail(item));
      const ownXml = /<subagent\b/i.test(getToolOutput(item) ?? "");
      const itemsField = args?.items ?? args?.ITEMS;
      const isItemsOnlyLaunch =
        !ownXml && Array.isArray(itemsField) && itemsField.length > 0;
      if (isItemsOnlyLaunch) {
        return;
      }
    }
    const expanded = expandSubagentToolToCards(item, {
      parentThreadId: options?.parentThreadId,
      nativeThreadIds: options?.nativeThreadIds,
      indexOffset: cards.length,
    });
    cards.push(...expanded);
  });

  const withChildren = enrichCardsWithChildThreads(cards, options?.childThreads);
  const deduped = dedupeSubagentSquadCards(withChildren);
  return deduped.map((card, index) => ({
    ...card,
    ...applyFixedSubagentIdentity(),
    indexLabel: formatIndexLabel(index),
  }));
}

export function buildSubagentCardFromSubagentInfo(
  agent: SubagentInfo,
  options?: {
    index?: number;
    parentThreadId?: string | null;
    /** Shared 父 nativeThreadIds，拼 claude:subagent:{owner}:{agentId} */
    nativeThreadIds?: readonly string[] | null;
  },
): SubagentCardViewModel {
  const toolCount = null;
  const outputText = agent.taskOutput?.recentOutput ?? null;
  // S10 同源：优先从 output meta / agent.id（若是真 agent key）取 id，禁止 tool 行 id 当 session
  const agentIdFromOutput = extractAgentId(null, outputText);
  const agentIdFromRow =
    agent.id && !looksLikeOpaqueToolRowId(agent.id) ? agent.id.trim() : null;
  const agentId = agentIdFromOutput ?? agentIdFromRow;
  const navigationThreadId =
    agent.navigationTarget?.kind === "thread"
      ? agent.navigationTarget.threadId
      : null;
  const explicitFromTask =
    agent.taskOutput?.threadId?.trim() &&
    !looksLikeOpaqueToolRowId(agent.taskOutput.threadId)
      ? agent.taskOutput.threadId.trim()
      : null;
  const sessionThreadId =
    navigationThreadId ??
    explicitFromTask ??
    resolveSubagentSessionThreadId({
      parentThreadId: options?.parentThreadId,
      agentId,
      explicitThreadId: navigationThreadId ?? explicitFromTask,
      outputText,
      nativeThreadIds: options?.nativeThreadIds,
    });
  return {
    id: agent.id,
    ...applyFixedSubagentIdentity(),
    indexLabel: formatIndexLabel(options?.index ?? 0),
    description: agent.description || agent.type || "Subagent",
    typeLabel: agent.type || "agent",
    status: agent.status,
    progress: resolveSubagentProgress(agent.status, toolCount),
    toolCount,
    outputText,
    taskOutput: agent.taskOutput
      ? { ...agent.taskOutput, threadId: sessionThreadId ?? agent.taskOutput.threadId }
      : null,
    agentId: agentId,
    sessionThreadId,
  };
}
