import type { GlobalMcpServerEntry } from "../../../services/tauri";

export type McpEngineType = "claude" | "codex";

export type McpSourceFilter = "all" | "config" | "runtime";

export type CodexMcpServer = {
  name: string;
  authLabel: string | null;
  toolNames: string[];
  resourcesCount: number;
  templatesCount: number;
};

export type ClaudeRuntimeServer = {
  name: string;
  status: string | null;
};

export type McpConfigRow = {
  kind: "config";
  id: string;
  name: string;
  enabled: boolean;
  transport: string | null;
  command: string | null;
  url: string | null;
  argsCount: number;
  source: GlobalMcpServerEntry["source"];
};

export type McpRuntimeRow = {
  kind: "runtime";
  id: string;
  name: string;
  authLabel: string | null;
  statusLabel: string | null;
  builtIn: boolean;
  toolNames: string[];
  resourcesCount: number;
  templatesCount: number;
};

export type McpServerRow = McpConfigRow | McpRuntimeRow;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function parseCodexMcpServers(raw: unknown): CodexMcpServer[] {
  const payload = asRecord(raw);
  const result = asRecord(payload?.result) ?? payload;
  const data = Array.isArray(result?.data) ? result.data : [];

  return data
    .map((item) => {
      const row = asRecord(item);
      if (!row) {
        return null;
      }
      const name = String(row.name ?? "").trim();
      if (!name) {
        return null;
      }
      const auth = row.authStatus ?? row.auth_status;
      const authLabel =
        typeof auth === "string"
          ? auth
          : asRecord(auth)
            ? String(asRecord(auth)?.status ?? "").trim() || null
            : null;

      const toolsRecord = asRecord(row.tools) ?? {};
      const prefix = `mcp__${name}__`;
      const normalizedPrefix = prefix.toLowerCase();
      const toolNames = Object.keys(toolsRecord)
        .map((toolName) => {
          return toolName.toLowerCase().startsWith(normalizedPrefix)
            ? toolName.slice(prefix.length)
            : toolName;
        })
        .sort((left, right) => left.localeCompare(right));

      const resourcesCount = Array.isArray(row.resources) ? row.resources.length : 0;
      const templatesCount = Array.isArray(row.resourceTemplates)
        ? row.resourceTemplates.length
        : Array.isArray(row.resource_templates)
          ? row.resource_templates.length
          : 0;

      return {
        name,
        authLabel,
        toolNames,
        resourcesCount,
        templatesCount,
      } satisfies CodexMcpServer;
    })
    .filter((item): item is CodexMcpServer => Boolean(item))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** 内置 AskUserQuestion 服务由 app 在 spawn 时注入 claude 运行时。 */
const BUILT_IN_CLAUDE_SERVER = "doge";

/**
 * 把 hook 返回的原始清单整理成当前引擎的行模型：配置来源按引擎过滤
 * （claude → claude_json，codex → doge_config；兼容旧 ccgui_config），运行时来源 codex 走
 * listMcpServerStatus 结果、claude 走 init 事件快照。
 */
export function buildEngineRows({
  engine,
  globalServers,
  codexServers,
  claudeRuntimeServers,
}: {
  engine: McpEngineType;
  globalServers: GlobalMcpServerEntry[];
  codexServers: CodexMcpServer[];
  claudeRuntimeServers: ClaudeRuntimeServer[];
}): McpServerRow[] {
  const configRows: McpConfigRow[] = globalServers
    .filter((server) =>
      engine === "claude"
        ? server.source === "claude_json"
        : server.source === "doge_config" || server.source === "ccgui_config",
    )
    .map((server) => ({
      kind: "config",
      id: `config:${server.name}`,
      name: server.name,
      enabled: server.enabled,
      transport: server.transport ?? null,
      command: server.command ?? null,
      url: server.url ?? null,
      argsCount: server.argsCount,
      source: server.source,
    }));

  const runtimeRows: McpRuntimeRow[] =
    engine === "codex"
      ? codexServers.map((server) => ({
          kind: "runtime",
          id: `runtime:${server.name}`,
          name: server.name,
          authLabel: server.authLabel,
          statusLabel: null,
          builtIn: false,
          toolNames: server.toolNames,
          resourcesCount: server.resourcesCount,
          templatesCount: server.templatesCount,
        }))
      : claudeRuntimeServers.map((server) => ({
          kind: "runtime",
          id: `runtime:${server.name}`,
          name: server.name,
          authLabel: null,
          statusLabel: server.status,
          builtIn: server.name === BUILT_IN_CLAUDE_SERVER,
          toolNames: [],
          resourcesCount: 0,
          templatesCount: 0,
        }));

  return [...configRows, ...runtimeRows];
}

export function filterMcpRows(
  rows: McpServerRow[],
  source: McpSourceFilter,
  query: string,
): McpServerRow[] {
  const normalizedQuery = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (source !== "all" && row.kind !== source) {
      return false;
    }
    if (normalizedQuery && !row.name.toLowerCase().includes(normalizedQuery)) {
      return false;
    }
    return true;
  });
}

export function splitRowsByKind(rows: McpServerRow[]): {
  configRows: McpConfigRow[];
  runtimeRows: McpRuntimeRow[];
} {
  const configRows: McpConfigRow[] = [];
  const runtimeRows: McpRuntimeRow[] = [];
  rows.forEach((row) => {
    if (row.kind === "config") {
      configRows.push(row);
    } else {
      runtimeRows.push(row);
    }
  });
  return { configRows, runtimeRows };
}
