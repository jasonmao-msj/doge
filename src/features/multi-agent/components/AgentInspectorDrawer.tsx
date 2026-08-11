import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import X from "lucide-react/dist/esm/icons/x";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Messages } from "../../messages";
import { pushErrorToast } from "../../../services/toasts";
import {
  getAgentLivePhase,
  getAgentStageLiveText,
  subscribeAgentLivePhase,
} from "../runtime/livePhaseChannel";
import {
  getAgentProjectionByRunId,
  useAgentRoundList,
} from "../store/agentStore";
import {
  closeAgentInspector,
  selectAgentRound,
  selectAgentStage,
  useAgentInspectorSelection,
} from "../store/inspectorStore";
import { useAgentStageTranscript } from "../hooks/useAgentStageTranscript";
import {
  isTerminalAgentStatus,
  type AgentProjectionV1,
  type AgentStageProjection,
} from "../types";
import {
  formatDurationMs,
  stageInspectorTypeLine,
  stageStatusText,
} from "../utils/format";
import { StageInjectContextHeader } from "./StageInjectContextHeader";

function useLivePhase(
  workspaceId: string | null | undefined,
  threadId: string | null | undefined,
) {
  return useSyncExternalStore(
    subscribeAgentLivePhase,
    () => getAgentLivePhase(workspaceId, threadId),
    () => null,
  );
}

function cardBadge(
  stage: AgentStageProjection,
  projection: AgentProjectionV1,
  isLive: boolean,
  t: (key: string, options?: Record<string, unknown>) => string,
): { text: string; tone: "live" | "ok" | "muted" | "fail" } {
  if (stage.status === "failed") {
    return {
      text: t("multiAgent.stageStatus.failed"),
      tone: "fail",
    };
  }
  if (isLive || stage.status === "running") {
    return {
      text: t("multiAgent.stageStatus.live"),
      tone: "live",
    };
  }
  if (stage.status === "succeeded") {
    const approved = stage.requiresApproval || stage.id === "plan"
      ? Boolean(projection.approvedAt) || stage.status === "succeeded"
      : false;
    const dur = formatDurationMs(stage.startedAt, stage.settledAt);
    if (approved && (stage.requiresApproval || stage.id === "plan")) {
      return {
        text: dur
          ? t("multiAgent.stageStatus.approvedWithDur", { dur })
          : t("multiAgent.stageStatus.approved"),
        tone: "ok",
      };
    }
    return {
      text: dur
        ? t("multiAgent.stageStatus.doneWithDur", { dur })
        : t("multiAgent.stageStatus.doneShort"),
      tone: "ok",
    };
  }
  return { text: stageStatusText(stage), tone: "muted" };
}

/**
 * 右侧协作详情：
 * - 壳：subagent-inspector-drawer（宽度/拖拽由 ConversationInspectorSplit 负责）
 * - 正文：subagent-session-canvas + Messages 幕布渲染（与子代理详情同源）
 */
export function AgentInspectorDrawer() {
  const { t } = useTranslation();
  const selection = useAgentInspectorSelection();
  const rounds = useAgentRoundList(selection?.workspaceId, selection?.threadId);
  const live = useLivePhase(selection?.workspaceId, selection?.threadId);
  const [cardIndex, setCardIndex] = useState(0);

  const roundIndex = useMemo(() => {
    if (!selection) return 0;
    if (
      typeof selection.roundIndex === "number" &&
      selection.roundIndex >= 0 &&
      selection.roundIndex < rounds.length
    ) {
      return selection.roundIndex;
    }
    const idx = rounds.findIndex((item) => item.runId === selection.runId);
    return idx >= 0 ? idx : Math.max(0, rounds.length - 1);
  }, [rounds, selection]);

  const projection =
    rounds[roundIndex] ??
    (selection
      ? getAgentProjectionByRunId(
          selection.workspaceId,
          selection.threadId,
          selection.runId,
        )
      : null);

  const stages = projection?.stages ?? [];

  useEffect(() => {
    if (!projection || stages.length === 0) {
      setCardIndex(0);
      return;
    }
    if (selection?.stageId) {
      const idx = stages.findIndex((stage) => stage.id === selection.stageId);
      if (idx >= 0) {
        setCardIndex(idx);
        return;
      }
    }
    const running = stages.findIndex((stage) => stage.status === "running");
    setCardIndex(running >= 0 ? running : 0);
  }, [projection?.runId, selection?.stageId, stages]);

  useEffect(() => {
    if (!selection) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAgentInspector();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection]);

  const safeIndex =
    stages.length === 0
      ? 0
      : ((cardIndex % stages.length) + stages.length) % stages.length;
  const stage = stages[safeIndex] ?? null;
  const isLive =
    Boolean(projection) &&
    !isTerminalAgentStatus(projection!.status) &&
    live?.phase === stage?.id;

  const liveText =
    stage && selection
      ? getAgentStageLiveText(
          selection.workspaceId,
          selection.threadId,
          stage.id,
          projection?.runId,
        )
      : "";

  const {
    items: canvasItems,
    canvasThreadId,
    processingStartedAt,
  } = useAgentStageTranscript({
    workspaceId: selection?.workspaceId,
    threadId: selection?.threadId,
    projection,
    stage,
    isLive: Boolean(isLive),
    liveText,
  });

  if (!selection || !projection) {
    return null;
  }

  const badge = stage
    ? cardBadge(stage, projection, Boolean(isLive), t)
    : null;

  const showCard = (index: number) => {
    if (stages.length === 0) return;
    const next = ((index % stages.length) + stages.length) % stages.length;
    setCardIndex(next);
    const nextStage = stages[next];
    if (nextStage) selectAgentStage(nextStage.id);
  };

  const switchRound = (index: number) => {
    const run = rounds[index];
    if (!run) {
      pushErrorToast({
        title: t("multiAgent.inspector.roundBlockedTitle"),
        message: t("multiAgent.inspector.roundBlocked"),
      });
      return;
    }
    const nextStage =
      run.stages?.find((item) => item.status === "running") ??
      run.stages?.[0] ??
      null;
    selectAgentRound({
      runId: run.runId,
      roundIndex: index,
      stageId: nextStage?.id ?? null,
    });
    setCardIndex(
      nextStage
        ? Math.max(
            0,
            (run.stages ?? []).findIndex((item) => item.id === nextStage.id),
          )
        : 0,
    );
  };

  return (
    <aside
      className={cn("subagent-inspector-drawer", "ma-agent-inspector")}
      aria-label={t("multiAgent.inspector.aria")}
    >
      <header className="subagent-inspector-header">
        <div className="subagent-inspector-identity">
          <div className="min-w-0">
            <div className="subagent-inspector-name-row">
              <strong
                className="subagent-inspector-name"
                tabIndex={-1}
                data-inspector-initial-focus
              >
                {stage ? stage.title || stage.id : t("multiAgent.inspector.title")}
              </strong>
              {stage ? (
                <span className="subagent-persona-index">
                  {safeIndex + 1}/{stages.length}
                </span>
              ) : null}
              {badge ? (
                <span className={`ma-card-badge is-${badge.tone}`}>
                  {badge.text}
                </span>
              ) : null}
            </div>
            <div className="subagent-inspector-type ma-inspector-type-row">
              <span className="ma-inspector-type-text">
                {stage
                  ? stageInspectorTypeLine(stage)
                  : t("multiAgent.inspector.phaseIdle")}
              </span>
              {stage ? (
                <span
                  className={cn(
                    "ma-feed-badge",
                    (stage.upstreamFeedMode === "full" ||
                      (!stage.upstreamFeedMode && safeIndex === 0)) &&
                      "is-full",
                    (stage.upstreamFeedMode === "summary" ||
                      (!stage.upstreamFeedMode && safeIndex > 0)) &&
                      "is-summary",
                  )}
                  title={t("multiAgent.inspector.feedModeHint")}
                >
                  {stage.upstreamFeedMode === "full" ||
                  (!stage.upstreamFeedMode && safeIndex === 0)
                    ? t("multiAgent.inspector.feedFull")
                    : t("multiAgent.inspector.feedSummary")}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="subagent-inspector-close"
          onClick={closeAgentInspector}
          aria-label={t("multiAgent.inspector.close")}
        >
          <X size={16} aria-hidden />
        </Button>
      </header>

      <div className="subagent-inspector-meta-bar ma-agent-meta-bar">
        <div className="ma-rndsw" role="tablist">
          {rounds.map((run, index) => {
            const terminal = isTerminalAgentStatus(run.status);
            const on = index === roundIndex;
            return (
              <button
                type="button"
                key={run.runId}
                role="tab"
                aria-selected={on}
                className={`ma-rnd${on ? " is-on" : ""}`}
                onClick={() => switchRound(index)}
              >
                {t("multiAgent.inspector.roundChip", {
                  n: index + 1,
                  mark: terminal ? "✓" : "●",
                })}
              </button>
            );
          })}
        </div>
        <div className="ma-pager">
          <button
            type="button"
            className="ma-pager-btn"
            aria-label={t("multiAgent.inspector.prevCard")}
            onClick={() => showCard(safeIndex - 1)}
            disabled={stages.length <= 1}
          >
            <ChevronLeft size={16} strokeWidth={2} aria-hidden />
          </button>
          <span className="ma-dots">
            {stages.map((item, index) => (
              <button
                type="button"
                key={item.id}
                className={index === safeIndex ? "is-on" : ""}
                aria-label={`${item.title} ${index + 1}`}
                onClick={() => showCard(index)}
              />
            ))}
          </span>
          <button
            type="button"
            className="ma-pager-btn"
            aria-label={t("multiAgent.inspector.nextCard")}
            onClick={() => showCard(safeIndex + 1)}
            disabled={stages.length <= 1}
          >
            <ChevronRight size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>

      {stage ? (
        <StageInjectContextHeader
          projection={projection}
          stage={stage}
          stageIndex={safeIndex}
          onJumpStage={(stageId) => {
            const idx = stages.findIndex((item) => item.id === stageId);
            if (idx >= 0) showCard(idx);
            else selectAgentStage(stageId);
          }}
        />
      ) : null}

      <div className="subagent-inspector-body is-session-canvas">
        {canvasItems.length > 0 ? (
          <div
            className="subagent-session-canvas"
            data-subagent-session-canvas="1"
            // 切 stage/attempt 强制重挂，避免 Messages 复用上一节点流式状态
            key={`${projection.runId}:${stage?.id ?? "na"}:${stage?.attemptId ?? "na"}`}
          >
            <Messages
              items={canvasItems}
              // 仅 agent-canvas / 合成 stage 作用域；禁止回退 shared 主会话（会串上一节点）
              threadId={
                canvasThreadId ||
                `agent-stage-fallback:${projection.runId}:${stage?.id ?? "na"}`
              }
              workspaceId={selection.workspaceId}
              isThinking={Boolean(isLive)}
              processingStartedAt={processingStartedAt}
              openTargets={[]}
              selectedOpenAppId=""
            />
          </div>
        ) : isLive ? (
          <div
            className="subagent-session-canvas-status is-waiting"
            role="status"
            aria-live="polite"
          >
            <span className="ma-orch-pending-dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span>{t("multiAgent.inspector.emptyLive")}</span>
          </div>
        ) : (
          <div className="subagent-session-canvas-status">
            {t("multiAgent.inspector.emptyLive")}
          </div>
        )}
      </div>
    </aside>
  );
}
