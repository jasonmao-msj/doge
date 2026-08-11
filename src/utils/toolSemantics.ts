export const READ_TOOL_NAMES = new Set([
  "read",
  "read_file",
  "readfile",
  "file_read",
  "view",
  "view_file",
  "open_file",
  "get_file",
  "cat",
  // Grok / agent-style directory browse (group with reads on canvas)
  "list_dir",
  "listdir",
  "list_directory",
  "ls",
  "list",
  "list_files",
]);

export const EDIT_TOOL_NAMES = new Set([
  "edit",
  "edit_file",
  "editfile",
  "write",
  "write_file",
  "writefile",
  "write_to_file",
  "replace_string",
  "search_replace",
  "str_replace",
  "strreplace",
  "multiedit",
  "multi_edit",
  "file_edit",
  "file_write",
  "notebookedit",
  "notebook_edit",
  "create_file",
  "apply_patch",
  "applypatch",
  "delete",
  "delete_file",
  "remove_file",
  "rm",
]);

export const BASH_TOOL_NAMES = new Set([
  "bash",
  "shell",
  "terminal",
  "run_terminal_cmd",
  "run_terminal_command",
  "execute_command",
  "shell_command",
  "run_command",
  "exec",
  "exec_command",
  "write_stdin",
  "run",
]);

export const SEARCH_TOOL_NAMES = new Set([
  "grep",
  "glob",
  "search",
  "find",
  "ripgrep",
  "rg",
  "codebase_search",
  "find_by_name",
  "find_files",
  "file_search",
]);

export const WEB_TOOL_NAMES = new Set([
  "webfetch",
  "websearch",
  "web_fetch",
  "web_search",
  "fetch",
  "http",
  "browser",
  "open_url",
]);

const FAILED_TOOL_STATUS_REGEX =
  /(fail|error|cancel(?:led)?|abort|timeout|timed[_ -]?out)/;
const COMPLETED_TOOL_STATUS_REGEX =
  /(complete|completed|success|succeed(?:ed)?|done|finish(?:ed)?)/;
const PROCESSING_TOOL_STATUS_REGEX =
  /(pending|running|processing|started|in[_ -]?progress|inprogress|queued)/;

export type ToolStatusTone = "completed" | "processing" | "failed";

function normalizeRuntimeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function resolveToolStatus(
  status: string | undefined,
  hasOutput: boolean,
): ToolStatusTone {
  const normalized = (status ?? "").toLowerCase();

  if (FAILED_TOOL_STATUS_REGEX.test(normalized)) {
    return "failed";
  }
  if (COMPLETED_TOOL_STATUS_REGEX.test(normalized)) {
    return "completed";
  }
  if (PROCESSING_TOOL_STATUS_REGEX.test(normalized)) {
    return "processing";
  }
  return hasOutput ? "completed" : "processing";
}

export function extractToolName(title: unknown): string {
  const normalizedTitle = normalizeRuntimeString(title);
  if (!normalizedTitle) {
    return "";
  }

  const prefixMatch = normalizedTitle.match(/^(?:Tool|Command):\s*(.+)$/i);
  const cleanTitle = prefixMatch
    ? (prefixMatch[1] ?? normalizedTitle).trim()
    : normalizedTitle.trim();

  // mcp__server__ToolName → ToolName
  if (cleanTitle.includes("__")) {
    const parts = cleanTitle.split("__");
    return (parts[parts.length - 1] ?? cleanTitle).trim();
  }

  // "server / tool" or "Claude / askuserquestion"
  if (cleanTitle.includes("/")) {
    const parts = cleanTitle.split("/");
    return (parts[parts.length - 1] ?? cleanTitle).trim();
  }

  // Display-formatted MCP titles: "Mcp doge Askuserquestion" → Askuserquestion
  const mcpSpacedMatch = cleanTitle.match(/^mcp\s+\S+\s+(.+)$/i);
  if (mcpSpacedMatch?.[1]) {
    return mcpSpacedMatch[1].trim();
  }

  return cleanTitle.toLowerCase();
}

/** AskUserQuestion (native or doge/legacy MCP variants). */
export function isAskUserQuestionToolName(
  toolName: string,
  title?: string,
): boolean {
  const compact = (value: string) =>
    value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const compactName = compact(toolName);
  if (
    compactName === "askuserquestion" ||
    compactName.endsWith("askuserquestion")
  ) {
    return true;
  }
  return compact(normalizeRuntimeString(title)).includes("askuserquestion");
}

export function isReadTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  if (READ_TOOL_NAMES.has(lower)) {
    return true;
  }
  if (lower.includes("list_dir") || lower.includes("listdir")) {
    return true;
  }
  return lower.includes("read");
}

export function isEditTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  if (EDIT_TOOL_NAMES.has(lower)) {
    return true;
  }
  if (lower === "todowrite" || lower === "todo_write") {
    return false;
  }
  // search_replace / str_replace style editors
  if (lower.includes("replace") && !lower.includes("search_query")) {
    return true;
  }
  return lower.includes("edit") || lower.includes("write");
}

export function isBashTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return (
    BASH_TOOL_NAMES.has(lower) ||
    lower.includes("bash") ||
    lower.includes("shell") ||
    lower.includes("terminal") ||
    lower.includes("run_terminal") ||
    lower === "run" ||
    lower.startsWith("run_")
  );
}

export function isSearchTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  // Avoid treating search_replace editors as search tools (edit wins in callers).
  if (lower.includes("replace") && !lower.includes("search_query")) {
    return false;
  }
  return (
    SEARCH_TOOL_NAMES.has(lower) ||
    lower.includes("grep") ||
    lower.includes("glob") ||
    lower.includes("codebase_search") ||
    (lower.includes("search") && !lower.includes("search_replace"))
  );
}

export function isWebTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return (
    WEB_TOOL_NAMES.has(lower) ||
    lower.includes("web") ||
    lower.includes("fetch")
  );
}

export function getFileName(path?: string): string {
  if (!path) {
    return "";
  }
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 0 ? (parts[parts.length - 1] ?? path) : path;
}

export function truncateText(text: string, maxLength = 60): string {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

export function parseToolArgs(detail: unknown): Record<string, unknown> | null {
  const normalizedDetail = normalizeRuntimeString(detail);
  if (!normalizedDetail) {
    return null;
  }
  try {
    return JSON.parse(normalizedDetail) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getFirstStringField(
  source: Record<string, unknown> | null,
  keys: string[],
): string {
  if (!source) {
    return "";
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function normalizeCommandValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return "";
  }
  const parts = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parts.join(" ").trim();
}

export function getFirstCommandField(
  source: Record<string, unknown> | null,
  keys: string[],
): string {
  if (!source) {
    return "";
  }
  for (const key of keys) {
    const normalized = normalizeCommandValue(source[key]);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

export const EDIT_PATH_KEYS = [
  "file_path",
  "filePath",
  "filepath",
  "path",
  "target_file",
  "targetFile",
  "filename",
  "file",
];
export const EDIT_OLD_KEYS = ["old_string", "oldString"];
export const EDIT_NEW_KEYS = ["new_string", "newString"];
export const EDIT_CONTENT_KEYS = ["content", "new_content", "newContent"];

export function pickStringField(
  source: Record<string, unknown> | null,
  nestedInput: Record<string, unknown> | null,
  nestedArgs: Record<string, unknown> | null,
  keys: string[],
): string {
  return (
    getFirstStringField(source, keys) ||
    getFirstStringField(nestedInput, keys) ||
    getFirstStringField(nestedArgs, keys)
  );
}

export function extractCommandFromTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) {
    return "";
  }
  const match = trimmed.match(
    /^(?:Command|Bash|Shell|Terminal|Run(?:\s+command)?):\s*(.+)$/i,
  );
  if (match?.[1]) {
    return match[1].trim();
  }
  // Bare tool-name titles are not the command itself.
  if (/^(?:command|bash|shell|terminal|run)$/i.test(trimmed)) {
    return "";
  }
  return "";
}

export function looksLikePathOnlyValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    /^[A-Za-z]:[\\/]/.test(trimmed)
  );
}

type BuildCommandSummaryOptions = {
  includeDetail?: boolean;
  ignorePathOnlyDetail?: boolean;
};

function isCommandSummaryToolType(toolType: string): boolean {
  if (!toolType || toolType === "commandExecution") {
    return true;
  }
  // Claude/Grok often emit toolType "bash" / "shell" rather than commandExecution.
  return isBashTool(toolType);
}

export function buildCommandSummary(
  item: {
    title?: unknown;
    detail?: unknown;
    toolType?: unknown;
  },
  options: BuildCommandSummaryOptions = {},
): string {
  const { includeDetail = true, ignorePathOnlyDetail = true } = options;
  const toolType = normalizeRuntimeString(item.toolType);
  if (toolType && !isCommandSummaryToolType(toolType)) {
    return "";
  }

  const detail = normalizeRuntimeString(item.detail);
  const detailArgs = parseToolArgs(detail);
  const nestedInput = asRecord(detailArgs?.input);
  const nestedArgs = asRecord(detailArgs?.arguments);
  const titleCommand = extractCommandFromTitle(
    normalizeRuntimeString(item.title),
  );
  const commandKeys = [
    "command",
    "cmd",
    "script",
    "shell_command",
    "bash",
    "argv",
  ];
  const argsCommand =
    getFirstCommandField(detailArgs, commandKeys) ||
    getFirstCommandField(nestedInput, commandKeys) ||
    getFirstCommandField(nestedArgs, commandKeys);
  // Prefer structured command fields; raw detail only as last resort when it is not JSON.
  const detailCommand = includeDetail
    ? ignorePathOnlyDetail && looksLikePathOnlyValue(detail)
      ? ""
      : detailArgs
        ? ""
        : detail.trim()
    : "";

  return [titleCommand, argsCommand, detailCommand]
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index, array) => array.indexOf(part) === index)
    .join(" · ");
}
