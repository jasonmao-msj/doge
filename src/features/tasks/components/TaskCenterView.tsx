import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TaskRunRecord, TaskRunStatus } from "../types";
import {
  OPEN_TASK_RUN_EVENT,
  readOpenTaskRunEvent,
} from "@/services/taskRunNavigationEvents";
import {
  compareTaskRunSurfacePriority,
  describeTaskRunSurface,
} from "../utils/taskRunSurface";
import { RunDetailSurface, formatTaskRunTime } from "./RunDetailSurface";
import { getEngineRegistryEntry } from "../../engine/engineRegistry";

type TaskCenterViewProps = {
  runs: TaskRunRecord[];
  workspaceId?: string | null;
  onOpenConversation?: (threadId: string) => void;
  onRetryRun?: (run: TaskRunRecord) => void;
  onResumeRun?: (run: TaskRunRecord) => void;
  onCancelRun?: (run: TaskRunRecord) => void;
  onForkRun?: (run: TaskRunRecord) => void;
};

const STATUS_ORDER: TaskRunStatus[] = [
  "waiting_input",
  "blocked",
  "failed",
  "running",
  "planning",
  "queued",
  "completed",
  "canceled",
];
const ENGINE_FILTERS: readonly TaskRunRecord["engine"][] = [
  "codex",
  "claude",
  "kimi",
  "grok",
  "opencode",
  "gemini",
];

export function TaskCenterView({
  runs,
  workspaceId = null,
  onOpenConversation,
  onRetryRun,
  onResumeRun,
  onCancelRun,
  onForkRun,
}: TaskCenterViewProps) {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<TaskRunStatus | "all">("all");
  const [engineFilter, setEngineFilter] = useState<TaskRunRecord["engine"] | "all">("all");
  const [openedFromRunLink, setOpenedFromRunLink] = useState(false);
  const workspaceRuns = useMemo(
    () =>
      runs
        .filter((run) => !workspaceId || run.task.workspaceId === workspaceId)
        .sort(compareTaskRunSurfacePriority),
    [runs, workspaceId],
  );
  const filteredRuns = workspaceRuns.filter(
    (run) =>
      (statusFilter === "all" || run.status === statusFilter) &&
      (engineFilter === "all" || run.engine === engineFilter),
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const selectedRun =
    filteredRuns.find((run) => run.runId === selectedRunId) ?? filteredRuns[0] ?? null;
  useEffect(() => {
    const handleOpenTaskRun = (event: Event) => {
      const runId = readOpenTaskRunEvent(event);
      if (!runId || !workspaceRuns.some((run) => run.runId === runId)) {
        return;
      }
      setSelectedRunId(runId);
      setOpenedFromRunLink(true);
    };

    window.addEventListener(OPEN_TASK_RUN_EVENT, handleOpenTaskRun);
    return () => {
      window.removeEventListener(OPEN_TASK_RUN_EVENT, handleOpenTaskRun);
    };
  }, [workspaceRuns]);
  const highlightedRuns = filteredRuns.filter((run) => describeTaskRunSurface(run).needsAttention).length;

  return (
    <section className="task-center" aria-label={t("taskCenter.title")}>
      <header className="task-center__header">
        <div>
          <p className="task-center__eyebrow">{t("taskCenter.eyebrow")}</p>
          <h2>{t("taskCenter.title")}</h2>
          <p className="task-center__summary">
            {t("taskCenter.summary", {
              total: filteredRuns.length,
              attention: highlightedRuns,
            })}
          </p>
        </div>
        <div className="task-center__filters">
          <label>
            {t("taskCenter.statusFilter")}
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as TaskRunStatus | "all")}
            >
              <option value="all">{t("taskCenter.filterAll")}</option>
              {STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {t(`taskCenter.status.${status}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("taskCenter.engineFilter")}
            <select
              value={engineFilter}
              onChange={(event) =>
                setEngineFilter(event.target.value as TaskRunRecord["engine"] | "all")
              }
            >
              <option value="all">{t("taskCenter.filterAll")}</option>
              {ENGINE_FILTERS.map((engine) => (
                <option key={engine} value={engine}>
                  {getEngineRegistryEntry(engine)?.displayName ?? engine}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {openedFromRunLink && selectedRun ? (
        <p className="task-center__context-banner" role="status">
          {t("taskCenter.openedFromProjectMap")}
        </p>
      ) : null}

      <div className="task-center__body">
        <div className="task-center__list">
          {filteredRuns.length === 0 ? (
            <p className="task-center__empty">{t("taskCenter.empty")}</p>
          ) : (
            filteredRuns.map((run) => (
              (() => {
                const surface = describeTaskRunSurface(run);
                const runSummary = surface.summary || t("taskCenter.unavailable");
                return (
                  <button
                    key={run.runId}
                    type="button"
                    className={`task-center__run task-center__run--${surface.severity} ${selectedRun?.runId === run.runId ? "is-selected" : ""}`}
                    onClick={() => {
                      setSelectedRunId(run.runId);
                      setOpenedFromRunLink(false);
                    }}
                  >
                    <span className="task-center__run-topline">
                      <span className="task-center__run-title">{run.task.title || run.task.taskId}</span>
                      <span className={`task-center__badge task-center__badge--${surface.severity}`}>
                        {t(`taskCenter.status.${run.status}`)}
                      </span>
                    </span>
                    <span className="task-center__run-meta">
                      {run.engine} · {formatTaskRunTime(run.updatedAt)}
                    </span>
                    <span className="task-center__run-summary">{runSummary}</span>
                    <span className="task-center__run-hint">{t(surface.hintKey)}</span>
                  </button>
                );
              })()
            ))
          )}
        </div>

        {selectedRun ? (
          <RunDetailSurface
            run={selectedRun}
            comparisonRuns={workspaceRuns}
            onOpenConversation={onOpenConversation}
            onRetryRun={onRetryRun}
            onResumeRun={onResumeRun}
            onCancelRun={onCancelRun}
            onForkRun={onForkRun}
          />
        ) : null}
      </div>
    </section>
  );
}
