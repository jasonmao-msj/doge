import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConversationItem, EngineType } from "../../../types";
import { Messages } from "../../messages";
import { MultiAgentHistoryFoldTimelineRow } from "../../multi-agent/components/HistoryFoldCard";
import { PromptDistillDialog } from "../../prompt-distill/components/PromptDistillDialog";
import { usePromptDistillation } from "../../prompt-distill/hooks/usePromptDistillation";
import {
  EMPTY_ACTIVE_CANVAS_ITEMS,
  useActiveCanvasSelector,
} from "../../layout/hooks/activeCanvasStore";
import { createThreadHistoryLoaderForThread } from "../../threads/hooks/useThreadActions.historyLoaderFactory";
import { useSubagentInspectorSelection } from "../hooks/useSubagentInspectorStore";
import { publishSubagentSessionProbe } from "../hooks/useSubagentSessionProbeStore";
import {
  appendAssistantReplyIfMissing,
  buildTranscriptItemsFromSubagentFallback,
  conversationHasAssistantReply,
  extractSubagentAssistantFromParentItems,
  isOpaqueCiphertextOutput,
  isSyntheticSubagentMetaOutput,
} from "../utils/subagentDetailTranscript";
import { isClaudeAsyncAgentLaunchOutput } from "../utils/subagentViewModel";

type SubagentSessionCanvasProps = {
  sessionThreadId: string;
  workspaceId?: string | null;
  workspacePath?: string | null;
};

function inferEngine(threadId: string): EngineType {
  if (threadId.startsWith("claude:")) return "claude";
  if (threadId.startsWith("grok:")) return "grok";
  if (threadId.startsWith("kimi:")) return "kimi";
  if (threadId.startsWith("gemini:")) return "gemini";
  if (threadId.startsWith("opencode:")) return "opencode";
  if (threadId.startsWith("shared:")) return "codex";
  return "codex";
}

function candidateThreadIds(
  sessionThreadId: string,
  parentThreadId?: string | null,
): string[] {
  const id = sessionThreadId.trim();
  if (!id) {
    return [];
  }
  const out = [id];
  // 误加 grok: 前缀的 Codex UUID → 再试裸 id
  if (id.startsWith("grok:")) {
    const bare = id.slice("grok:".length);
    if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(bare)) {
      out.push(bare);
    }
  } else if (id.startsWith("kimi:")) {
    const bare = id.slice("kimi:".length);
    if (bare) out.push(bare);
  } else if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(id)) {
    // 裸 UUID：按父会话引擎补前缀，提高子会话 load 命中率
    const parent = (parentThreadId ?? "").trim();
    if (parent.startsWith("grok:") || parent.startsWith("shared:")) {
      out.push(`grok:${id}`);
    }
    if (parent.startsWith("kimi:")) {
      out.push(`kimi:${id}`);
    }
  }
  return out;
}

function collectAgentKeysForParentLookup(selection: {
  agentId?: string | null;
  id?: string;
  sessionThreadId?: string | null;
  taskOutput?: { threadId?: string | null } | null;
} | null): string[] {
  if (!selection) return [];
  return [
    selection.agentId,
    selection.sessionThreadId,
    selection.taskOutput?.threadId,
    selection.id,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
}

/**
 * 在右侧抽屉内复用全局 Messages 幕布，渲染子代理 session 历史。
 * 跨引擎：Claude / Codex / Grok / Kimi / Shared 均走 createThreadHistoryLoaderForThread。
 */
export const SubagentSessionCanvas = memo(function SubagentSessionCanvas({
  sessionThreadId,
  workspaceId = null,
  workspacePath = null,
}: SubagentSessionCanvasProps) {
  const { t } = useTranslation();
  const selection = useSubagentInspectorSelection();
  const parentThreadId = useActiveCanvasSelector((snapshot) => snapshot.threadId);
  const canvasItems = useActiveCanvasSelector((snapshot) => snapshot.items);
  const threadItemsByThread = useActiveCanvasSelector(
    (snapshot) => snapshot.threadItemsByThread,
  );
  const canvasWorkspacePath = useActiveCanvasSelector((s) => s.workspacePath);
  const canvasWorkspaceId = useActiveCanvasSelector((s) => s.workspaceId);

  const resolvedWorkspaceId = workspaceId ?? canvasWorkspaceId ?? null;
  const resolvedWorkspacePath = workspacePath ?? canvasWorkspacePath ?? null;
  const promptDistillation = usePromptDistillation({
    workspaceId: resolvedWorkspaceId,
  });
  const loadCandidates = useMemo(
    () => candidateThreadIds(sessionThreadId, parentThreadId),
    [parentThreadId, sessionThreadId],
  );

  const cachedItems = useMemo(() => {
    for (const id of loadCandidates) {
      const items = threadItemsByThread[id];
      if (items && items.length > 0) {
        return items;
      }
    }
    return null;
  }, [loadCandidates, threadItemsByThread]);

  const [loadedItems, setLoadedItems] = useState<ConversationItem[] | null>(null);
  const [resolvedLoadId, setResolvedLoadId] = useState(sessionThreadId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const renderHistoryFold = useCallback(
    (itemId: string) => (
      <MultiAgentHistoryFoldTimelineRow
        itemId={itemId}
        workspaceId={resolvedWorkspaceId}
        threadId={resolvedLoadId}
      />
    ),
    [resolvedLoadId, resolvedWorkspaceId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setResolvedLoadId(sessionThreadId);

    if (cachedItems && cachedItems.length > 0) {
      setLoadedItems(cachedItems);
      setLoading(false);
      // canvas 已有缓存也发布 probe，驱动小队卡 status 与 inspector 同步
      for (const id of loadCandidates) {
        const items = threadItemsByThread[id];
        if (items && items.length > 0) {
          publishSubagentSessionProbe(id, items);
          break;
        }
      }
      return () => {
        cancelled = true;
      };
    }

    if (!resolvedWorkspaceId || loadCandidates.length === 0) {
      setLoadedItems(null);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);

    void (async () => {
      let lastError: string | null = null;
      for (const candidateId of loadCandidates) {
        try {
          const loader = createThreadHistoryLoaderForThread({
            targetThreadId: candidateId,
            workspaceId: resolvedWorkspaceId,
            workspacePath: resolvedWorkspacePath ?? null,
            preferLocalCodexHistory: true,
          });
          const snapshot = await loader.load(candidateId);
          if (cancelled) {
            return;
          }
          const nextItems = snapshot.items ?? [];
          if (nextItems.length > 0) {
            setResolvedLoadId(candidateId);
            setLoadedItems(nextItems);
            setLoading(false);
            // 旁路历史加载回写 probe，让列表 status 不必依赖「侧栏打开 session」
            publishSubagentSessionProbe(candidateId, nextItems);
            return;
          }
          // 空 transcript：继续试下一个 candidate
          setResolvedLoadId(candidateId);
          setLoadedItems([]);
        } catch (error: unknown) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
      if (cancelled) {
        return;
      }
      if (lastError) {
        setLoadError(lastError);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    cachedItems,
    loadCandidates,
    resolvedWorkspaceId,
    resolvedWorkspacePath,
    sessionThreadId,
    threadItemsByThread,
  ]);

  const items = useMemo(
    () => loadedItems ?? cachedItems ?? EMPTY_ACTIVE_CANVAS_ITEMS,
    [cachedItems, loadedItems],
  );

  const rawFallbackCandidate =
    selection?.outputText?.trim() ||
    selection?.taskOutput?.recentOutput?.trim() ||
    "";
  // 密文 message / Claude launch 不当作可读回退
  const rawFallback =
    isOpaqueCiphertextOutput(rawFallbackCandidate) ||
    isClaudeAsyncAgentLaunchOutput(rawFallbackCandidate)
      ? ""
      : rawFallbackCandidate;
  const isClaudeLaunchMeta = isClaudeAsyncAgentLaunchOutput(rawFallbackCandidate);

  // 始终可算 fallback（即使用会话里已有 user-only，也要用来补 assistant）
  const fallbackTranscriptItems = useMemo(() => {
    const desc = selection?.description?.trim() || "";
    const readableDesc = isOpaqueCiphertextOutput(desc) ? "" : desc;
    if (isClaudeLaunchMeta) {
      return readableDesc
        ? buildTranscriptItemsFromSubagentFallback({
            cardId: selection?.id ?? sessionThreadId,
            description: readableDesc,
            outputText: "",
          })
        : EMPTY_ACTIVE_CANVAS_ITEMS;
    }
    if (!rawFallback && !readableDesc) {
      return EMPTY_ACTIVE_CANVAS_ITEMS;
    }
    if (isSyntheticSubagentMetaOutput(rawFallback) || rawFallback) {
      return buildTranscriptItemsFromSubagentFallback({
        cardId: selection?.id ?? sessionThreadId,
        description: readableDesc,
        outputText: rawFallback,
      });
    }
    if (readableDesc) {
      return buildTranscriptItemsFromSubagentFallback({
        cardId: selection?.id ?? sessionThreadId,
        description: readableDesc,
        outputText: "",
      });
    }
    return EMPTY_ACTIVE_CANVAS_ITEMS;
  }, [
    isClaudeLaunchMeta,
    rawFallback,
    selection?.description,
    selection?.id,
    sessionThreadId,
  ]);

  const parentItemsForLookup = useMemo(() => {
    const fromParentTable =
      parentThreadId && threadItemsByThread
        ? threadItemsByThread[parentThreadId]
        : null;
    if (fromParentTable && fromParentTable.length > 0) {
      return fromParentTable;
    }
    return canvasItems;
  }, [canvasItems, parentThreadId, threadItemsByThread]);

  const activeEngine = inferEngine(resolvedLoadId);

  /**
   * 显示策略：
   * 1) 子会话 history 优先
   * 2) 若 history 空 → 用 fallback 气泡
   * 3) 若 history 只有 user、没有 AI 回复（Grok 常见：回复在父线 get_command_or_subagent_output）
   *    → 从 fallback / 父线 tool 补 assistant
   */
  const displayItems = useMemo(() => {
    const cardId = selection?.id ?? sessionThreadId;
    const base =
      items.length > 0
        ? items
        : fallbackTranscriptItems.length > 0
          ? fallbackTranscriptItems
          : EMPTY_ACTIVE_CANVAS_ITEMS;

    if (conversationHasAssistantReply(base)) {
      return base;
    }

    const fallbackAssistant = fallbackTranscriptItems.find(
      (item) =>
        item.kind === "message" &&
        item.role === "assistant" &&
        typeof item.text === "string" &&
        item.text.trim().length > 0,
    );
    const fromFallback =
      fallbackAssistant && fallbackAssistant.kind === "message"
        ? fallbackAssistant.text
        : null;

    const fromParent = extractSubagentAssistantFromParentItems(
      parentItemsForLookup,
      collectAgentKeysForParentLookup(selection),
    );

    const assistantText = (fromFallback || fromParent || "").trim();
    if (!assistantText) {
      return base;
    }

    // base 为空时：用 fallback 整段（通常已含 user）；再确保 assistant
    if (base.length === 0) {
      return appendAssistantReplyIfMissing(
        fallbackTranscriptItems,
        assistantText,
        cardId,
      );
    }
    return appendAssistantReplyIfMissing(base, assistantText, cardId);
  }, [
    fallbackTranscriptItems,
    items,
    parentItemsForLookup,
    selection,
    sessionThreadId,
  ]);

  if (loading && displayItems.length === 0) {
    return (
      <div className="subagent-session-canvas-status">
        {t("subagentUi.loadingSession", { defaultValue: "正在加载子代理会话…" })}
      </div>
    );
  }

  if (loadError && displayItems.length === 0) {
    return (
      <div className="subagent-session-canvas-status is-error">
        {t("subagentUi.sessionLoadFailed", {
          defaultValue: "子代理会话加载失败",
        })}
        <span className="subagent-session-canvas-error-detail">{loadError}</span>
      </div>
    );
  }

  if (displayItems.length === 0) {
    return (
      <div className="subagent-session-canvas-status">
        {isClaudeLaunchMeta
          ? t("subagentUi.claudeLaunchNoSession", {
              defaultValue:
                "已识别 Claude Agent 启动回执，但子会话 transcript 尚未加载。请稍后重试或从左侧打开对应子代理会话。",
            })
          : t("subagentUi.emptySession", {
              defaultValue: "子代理会话暂无消息（可能仍在索引）",
            })}
      </div>
    );
  }

  // 嵌套 Messages 仅渲染子会话 transcript（与 Grok 详情一致：user/assistant 气泡）
  return (
    <>
      <div className="subagent-session-canvas" data-subagent-session-canvas="1">
        <Messages
          items={displayItems}
          threadId={resolvedLoadId}
          workspaceId={resolvedWorkspaceId}
          workspacePath={resolvedWorkspacePath}
          isThinking={false}
          openTargets={[]}
          selectedOpenAppId=""
          activeEngine={activeEngine}
          conversationState={null}
          onSaveAsPrompt={promptDistillation.start}
          renderHistoryFold={renderHistoryFold}
        />
      </div>
      <PromptDistillDialog
        isOpen={promptDistillation.isOpen}
        phase={promptDistillation.phase}
        name={promptDistillation.name}
        content={promptDistillation.content}
        error={promptDistillation.error}
        distillingEngine={promptDistillation.distillingEngine}
        onNameChange={promptDistillation.setName}
        onContentChange={promptDistillation.setContent}
        onSave={() => void promptDistillation.save()}
        onClose={promptDistillation.close}
      />
    </>
  );
});
