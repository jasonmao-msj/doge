import i18n from "../../../../i18n";
import {
  BASH_TOOL_NAMES,
  EDIT_CONTENT_KEYS,
  EDIT_TOOL_NAMES,
  EDIT_NEW_KEYS,
  EDIT_OLD_KEYS,
  EDIT_PATH_KEYS,
  READ_TOOL_NAMES,
  SEARCH_TOOL_NAMES,
  WEB_TOOL_NAMES,
  asRecord,
  buildCommandSummary,
  extractCommandFromTitle,
  extractToolName,
  getFileName,
  getFirstCommandField,
  getFirstStringField,
  isBashTool,
  isEditTool,
  isReadTool,
  isSearchTool,
  isWebTool,
  looksLikePathOnlyValue,
  normalizeCommandValue,
  parseToolArgs,
  pickStringField,
  resolveToolStatus,
  truncateText,
} from "../../../../utils/toolSemantics";
import { isSubagentTool } from "../../../subagent-ui";
import type { ToolStatusTone } from "../../../../utils/toolSemantics";

export {
  BASH_TOOL_NAMES,
  EDIT_CONTENT_KEYS,
  EDIT_TOOL_NAMES,
  EDIT_NEW_KEYS,
  EDIT_OLD_KEYS,
  EDIT_PATH_KEYS,
  READ_TOOL_NAMES,
  SEARCH_TOOL_NAMES,
  WEB_TOOL_NAMES,
  asRecord,
  buildCommandSummary,
  extractCommandFromTitle,
  extractToolName,
  getFileName,
  getFirstCommandField,
  getFirstStringField,
  isBashTool,
  isEditTool,
  isReadTool,
  isSearchTool,
  isWebTool,
  looksLikePathOnlyValue,
  normalizeCommandValue,
  parseToolArgs,
  pickStringField,
  resolveToolStatus,
  truncateText,
};
export type { ToolStatusTone };

/**
 * 工具类型常量和判断函数
 * Tool type constants and helper functions
 */

// 工具图标映射 (使用 Lucide 图标名称)
export const TOOL_ICON_MAP: Record<string, string> = {
  // 读取
  read: 'FileText',
  read_file: 'FileText',
  // 编辑
  edit: 'FileEdit',
  write: 'FilePlus',
  notebookedit: 'FileCode',
  // 终端
  bash: 'Terminal',
  shell: 'Terminal',
  terminal: 'Terminal',
  // 搜索
  grep: 'Search',
  glob: 'FolderSearch',
  search: 'Search',
  find: 'FolderSearch',
  // 网络
  webfetch: 'Globe',
  websearch: 'Globe',
  // 其他
  task: 'ListTodo',
  todowrite: 'ListChecks',
  diff: 'Diff',
};

// 工具显示名称映射 - 工厂函数，接受 t 翻译函数
export function getToolDisplayNames(t: (key: string) => string): Record<string, string> {
  return {
    // 读取
    read: t("tools.readFile"),
    read_file: t("tools.readFile"),
    // 编辑
    edit: t("tools.editFile"),
    write: t("tools.writeFile"),
    notebookedit: t("tools.editNotebook"),
    // 终端
    bash: t("tools.runCommand"),
    shell: t("tools.runCommand"),
    terminal: t("tools.runCommand"),
    shell_command: t("tools.runCommand"),
    run_terminal_cmd: t("tools.runCommand"),
    execute_command: t("tools.executeCommand"),
    // 搜索
    grep: t("tools.search"),
    glob: t("tools.fileMatch"),
    search: t("tools.search"),
    find: t("tools.findFile"),
    // 网络
    webfetch: t("tools.webFetch"),
    websearch: t("tools.webSearch"),
    // 其他
    task: t("tools.subtask"),
    todowrite: t("tools.todoList"),
    askuserquestion: t("tools.userInputRequest"),
    diff: t("tools.diffCompare"),
    result: t("tools.result"),
    claudecontrolevent: t("tools.claudeControlLocalOutput"),
  };
}

// 静态 key 回退映射，当没有组件级 t 函数时走全局 i18n
const TOOL_DISPLAY_NAMES_FALLBACK: Record<string, string> = {
  read: 'tools.readFile',
  read_file: 'tools.readFile',
  edit: 'tools.editFile',
  write: 'tools.writeFile',
  notebookedit: 'tools.editNotebook',
  bash: 'tools.runCommand',
  shell: 'tools.runCommand',
  terminal: 'tools.runCommand',
  shell_command: 'tools.runCommand',
  run_terminal_cmd: 'tools.runCommand',
  execute_command: 'tools.executeCommand',
  grep: 'tools.search',
  glob: 'tools.fileMatch',
  search: 'tools.search',
  find: 'tools.findFile',
  webfetch: 'tools.webFetch',
  websearch: 'tools.webSearch',
  task: 'tools.subtask',
  todowrite: 'tools.todoList',
  askuserquestion: 'tools.userInputRequest',
  diff: 'tools.diffCompare',
  result: 'tools.result',
  claudecontrolevent: 'tools.claudeControlLocalOutput',
};

function normalizeRuntimeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 检查是否为 MCP 工具
 */
export function isMcpTool(title: unknown): boolean {
  const name = normalizeRuntimeString(title).toLowerCase();
  return (
    name.includes('mcp__') ||
    name.includes('mcp_') ||
    // Display-formatted titles from formatMcpToolName: "Mcp doge Askuserquestion"
    /^mcp\s+\S+/i.test(name.replace(/^tool:\s*/i, ''))
  );
}

function isAskUserQuestionDisplayName(toolName: string, title?: string): boolean {
  const compact = (value: string) =>
    value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const nameKey = compact(toolName);
  const titleKey = compact(normalizeRuntimeString(title));
  return (
    nameKey === 'askuserquestion' ||
    nameKey.endsWith('askuserquestion') ||
    titleKey.includes('askuserquestion')
  );
}

/**
 * 获取工具的显示名称
 */
export function getToolDisplayName(toolName: string, title?: string, t?: (key: string) => string): string {
  const lower = toolName.toLowerCase();

  // AskUserQuestion (native / MCP) → locale "询问用户问题"
  if (isAskUserQuestionDisplayName(toolName, title)) {
    return t ? t('tools.userInputRequest') : i18n.t('tools.userInputRequest');
  }

  // 当 t 函数存在时使用翻译
  if (t) {
    const translatedNames = getToolDisplayNames(t);
    if (translatedNames[lower]) {
      return translatedNames[lower];
    }
  } else {
    const fallbackKey = TOOL_DISPLAY_NAMES_FALLBACK[lower];
    if (fallbackKey) {
      return i18n.t(fallbackKey);
    }
  }

  // 基于类型返回通用名称
  if (t) {
    if (isReadTool(lower)) return t("tools.readFile");
    if (isEditTool(lower)) return t("tools.editFile");
    if (isBashTool(lower)) return t("tools.runCommand");
    if (isSearchTool(lower)) return t("tools.search");
    if (isWebTool(lower)) return t("tools.webRequest");
  } else {
    if (isReadTool(lower)) return i18n.t("tools.readFile");
    if (isEditTool(lower)) return i18n.t("tools.editFile");
    if (isBashTool(lower)) return i18n.t("tools.runCommand");
    if (isSearchTool(lower)) return i18n.t("tools.search");
    if (isWebTool(lower)) return i18n.t("tools.webRequest");
  }

  // MCP 工具特殊处理
  if (title && isMcpTool(title)) {
    // 格式化 MCP 工具名称
    // mcp__ace-tool__search_context -> Mcp Ace-tool Search Context
    const parts = title.replace(/^Tool:\s*/i, '').split('__');
    return parts
      .map(part =>
        part.split(/[-_]/)
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ')
      )
      .join(' ');
  }

  // snake_case 转 Title Case
  if (toolName.includes('_')) {
    return toolName
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  // CamelCase 转 Title Case
  if (/^[A-Z]/.test(toolName)) {
    return toolName.replace(/([A-Z])/g, ' $1').trim();
  }

  return toolName.charAt(0).toUpperCase() + toolName.slice(1);
}

/**
 * 工具分类类型
 */
export type ToolCategory =
  | 'read'
  | 'edit'
  | 'bash'
  | 'search'
  | 'web'
  | 'fileChange'
  | 'mcp'
  | 'subagent'
  | 'other';

/**
 * 对 tool item 进行分类，返回其所属类别。
 * 用于连续同类工具的分组逻辑。
 */
export function classifyToolCategory(item: {
  toolType: unknown;
  title: unknown;
}): ToolCategory {
  const toolType = normalizeRuntimeString(item.toolType);
  const toolName = extractToolName(item.title);
  const lower = toolName.toLowerCase();

  // 优先级0：subAgent 跨引擎统一识别（strip / status-panel / enrich；幕布不再组 squad）
  if (isSubagentTool(item)) {
    return "subagent";
  }

  // 优先级1：明确 toolType（但 fileChange 仍可用 title 名做 edit 场景）
  if (toolType === 'commandExecution') return 'bash';
  if (toolType === 'fileChange') return 'fileChange';
  if (toolType === 'webSearch') return 'web';

  // 优先级2：工具名称分类（agent 工具常以 mcpToolCall + 裸 title 到达）
  if (isBashTool(lower)) return 'bash';
  if (isReadTool(lower)) return 'read';
  if (isEditTool(lower)) return 'edit';
  if (isSearchTool(lower)) return 'search';
  if (isWebTool(lower)) return 'web';

  // 优先级3：真正 MCP 前缀；裸 agent 名不要误判成 MCP 桶
  if (isMcpTool(item.title)) return 'mcp';
  if (toolType === 'mcpToolCall') return 'other';

  return 'other';
}
