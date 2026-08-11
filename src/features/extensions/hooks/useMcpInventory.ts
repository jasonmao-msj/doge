import { useCallback, useEffect, useRef, useState } from "react";

import {
  listGlobalMcpServers,
  listMcpServerStatus,
  type GlobalMcpServerEntry,
} from "../../../services/tauri";
import { getClaudeMcpRuntimeSnapshot } from "../../threads/utils/claudeMcpRuntimeSnapshot";
import {
  parseCodexMcpServers,
  type ClaudeRuntimeServer,
  type CodexMcpServer,
} from "../utils/mcpInventory";

export type McpInventory = {
  loading: boolean;
  error: string | null;
  globalServers: GlobalMcpServerEntry[];
  codexServers: CodexMcpServer[];
  claudeRuntimeServers: ClaudeRuntimeServer[];
  reload: () => Promise<void>;
};

/**
 * 拓展 → Mcps 的数据源：全局配置清单（claude_json / doge_config）+ codex
 * 运行时清单 + claude 运行时快照。防竞态沿用旧设置面板的
 * mountedRef + loadSequenceRef 模式（旧 McpSection.loadMcp）。
 */
export function useMcpInventory(workspaceId: string | null): McpInventory {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalServers, setGlobalServers] = useState<GlobalMcpServerEntry[]>([]);
  const [codexServers, setCodexServers] = useState<CodexMcpServer[]>([]);
  const [claudeRuntimeServers, setClaudeRuntimeServers] = useState<ClaudeRuntimeServer[]>(
    [],
  );
  const mountedRef = useRef(true);
  const loadSequenceRef = useRef(0);

  const reload = useCallback(async () => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    const canCommit = () =>
      mountedRef.current && loadSequenceRef.current === sequence;

    if (canCommit()) {
      setLoading(true);
      setError(null);
    }
    const loadErrors: string[] = [];

    try {
      try {
        const nextGlobalServers = await listGlobalMcpServers();
        if (canCommit()) {
          setGlobalServers(nextGlobalServers);
        }
      } catch (loadError) {
        if (canCommit()) {
          setGlobalServers([]);
        }
        loadErrors.push(loadError instanceof Error ? loadError.message : String(loadError));
      }

      if (workspaceId) {
        try {
          const response = await listMcpServerStatus(workspaceId, null, null);
          if (canCommit()) {
            setCodexServers(parseCodexMcpServers(response));
          }
        } catch {
          if (canCommit()) {
            setCodexServers([]);
          }
        }
      } else if (canCommit()) {
        setCodexServers([]);
      }

      // Claude 的运行时 MCP 服务（含内置 AskUserQuestion "doge" 服务）通过 init
      // 事件上报并记录在本地快照里——这是"是否连上"的准确信号；配置清单看不到
      // spawn 时通过 --mcp-config 注入的服务。
      if (canCommit()) {
        const snapshot = workspaceId ? getClaudeMcpRuntimeSnapshot(workspaceId) : null;
        setClaudeRuntimeServers(snapshot?.mcpServers ?? []);
      }
    } finally {
      if (canCommit()) {
        setError(loadErrors[0] ?? null);
        setLoading(false);
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadSequenceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    loading,
    error,
    globalServers,
    codexServers,
    claudeRuntimeServers,
    reload,
  };
}
