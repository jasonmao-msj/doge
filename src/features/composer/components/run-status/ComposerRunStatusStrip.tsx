import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ListChecks from "lucide-react/dist/esm/icons/list-checks";
import Bot from "lucide-react/dist/esm/icons/bot";
import ListTodo from "lucide-react/dist/esm/icons/list-todo";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import PanelTop from "lucide-react/dist/esm/icons/panel-top";
import PanelTopClose from "lucide-react/dist/esm/icons/panel-top-close";
import type { LucideIcon } from "lucide-react";
import type { TurnPlan } from "../../../../types";
import type { SubagentInfo, TodoItem } from "../../../status-panel/types";
import type { TurnFileChangesSummary } from "../../../messages/utils/turnFileChanges";
import { TodoList } from "../../../status-panel/components/TodoList";
import { PlanList } from "../../../status-panel/components/PlanList";
import { TurnFilesChangedCard } from "../../../messages/components/conversation/TurnFilesChangedCard";
import { RunStatusSubagentRows } from "./RunStatusSubagentRows";
import { RollingStat } from "./RollingStat";
import {
  useComposerRunStatus,
  type ComposerRunStatusInput,
} from "./useComposerRunStatus";
import type { RunStatusSection } from "./types";

export type ComposerRunStatusStripProps = ComposerRunStatusInput & {
  isCodexEngine?: boolean;
  onOpenDiffPath?: (path: string) => void;
  onInspectSubagent?: (agent: SubagentInfo) => void;
  /** 撤销已编辑列表中的单个文件 */
  onRevertFile?: (path: string) => void | Promise<void>;
  /** 撤销已编辑列表中的多个文件（撤销全部） */
  onRevertAllFiles?: (paths: string[]) => void | Promise<void>;
};

type PillDef = {
  id: RunStatusSection;
  label: string;
  Icon: LucideIcon;
  countLabel: string;
  running: boolean;
  hint?: string | null;
};

function buildPills(
  model: ReturnType<typeof useComposerRunStatus>,
  t: (key: string, opts?: Record<string, unknown>) => string,
  isCodexEngine: boolean,
): PillDef[] {
  const pills: PillDef[] = [];
  if (model.showTodoSection) {
    pills.push({
      id: "todo",
      label: t("statusPanel.tabTodos"),
      Icon: ListChecks,
      countLabel: `${model.todoCompleted}/${model.todoTotal}`,
      running: model.todoRunning,
    });
  }
  if (model.showSubagentSection) {
    pills.push({
      id: "subagent",
      label: isCodexEngine
        ? t("statusPanel.tabAgents")
        : t("statusPanel.tabSubagents"),
      Icon: Bot,
      countLabel: `${model.subagentCompleted}/${model.subagentTotal}`,
      running: model.subagentRunning,
      hint: model.subagentRunning ? model.runningSubagentLabel : null,
    });
  }
  if (model.showPlanSection) {
    pills.push({
      id: "plan",
      label: t("statusPanel.tabPlan"),
      Icon: ListTodo,
      countLabel:
        model.planTotal > 0
          ? `${model.planCompleted}/${model.planTotal}`
          : "…",
      running: false,
    });
  }
  if (model.showEditSection) {
    pills.push({
      id: "edit",
      label: t("composer.runStatus.edited"),
      Icon: Pencil,
      // pill 展示行级 diff 汇总，文件数放在 title / 展开面板
      countLabel: `+${model.totalAdditions} -${model.totalDeletions}`,
      running: model.editRunning,
      hint: t("messages.turnFilesChanged.title", {
        count: model.editFileCount,
      }),
    });
  }
  return pills;
}

const CHROME_OPEN_STORAGE_KEY = "ccgui.composer.runStatusChromeOpen";

function readChromeOpenPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(CHROME_OPEN_STORAGE_KEY);
    if (raw === "0" || raw === "false") return false;
    if (raw === "1" || raw === "true") return true;
  } catch {
    // ignore
  }
  return true;
}

function writeChromeOpenPreference(open: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHROME_OPEN_STORAGE_KEY, open ? "1" : "0");
  } catch {
    // ignore
  }
}

export const ComposerRunStatusStrip = memo(function ComposerRunStatusStrip(
  props: ComposerRunStatusStripProps,
) {
  const { t } = useTranslation();
  const {
    isCodexEngine = false,
    onOpenDiffPath,
    onInspectSubagent,
    onRevertFile,
    onRevertAllFiles,
    isPlanMode,
    isProcessing,
    ...statusInput
  } = props;

  const model = useComposerRunStatus({
    ...statusInput,
    isPlanMode,
    isProcessing,
  });

  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const stripRef = useRef<HTMLDivElement>(null);
  const [chromeOpen, setChromeOpen] = useState(readChromeOpenPreference);

  const { markFilesReverted, collapse, expandedSection } = model;

  const toggleChrome = useCallback(() => {
    setChromeOpen((prev) => {
      const next = !prev;
      writeChromeOpenPreference(next);
      if (!next) {
        collapse();
      }
      return next;
    });
  }, [collapse]);

  // 撤销成功后写入 hook 级签名隐藏，pill 与列表共用过滤后的 summary
  const handleRevertFile = useCallback(
    async (path: string) => {
      await onRevertFile?.(path);
      markFilesReverted([path]);
    },
    [markFilesReverted, onRevertFile],
  );

  const handleRevertAllFiles = useCallback(
    async (paths: string[]) => {
      await onRevertAllFiles?.(paths);
      markFilesReverted(paths);
    },
    [markFilesReverted, onRevertAllFiles],
  );

  useEffect(() => {
    if (!expandedSection || !chromeOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        collapse();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chromeOpen, collapse, expandedSection]);

  if (!model.visible) {
    return null;
  }

  const pills = buildPills(model, t, isCodexEngine);
  const sectionExpanded = chromeOpen ? model.expandedSection : null;
  const hasLive =
    model.todoRunning || model.subagentRunning || model.editRunning;
  const ToggleIcon = chromeOpen ? PanelTopClose : PanelTop;

  return (
    <div
      ref={stripRef}
      className={`composer-run-status${sectionExpanded ? " is-expanded" : ""}${
        chromeOpen ? " is-chrome-open" : " is-chrome-collapsed"
      }${hasLive ? " is-live" : ""}`}
      data-testid="composer-run-status"
      data-chrome-open={chromeOpen ? "true" : "false"}
    >
      {chromeOpen ? (
        <div
          className={`composer-run-status-panel-shell${
            sectionExpanded ? " is-open" : ""
          }`}
          aria-hidden={!sectionExpanded}
        >
          <div className="composer-run-status-panel-clip">
            {sectionExpanded ? (
              <div
                id={panelId}
                className="composer-run-status-panel scrollable"
                role="tabpanel"
                aria-label={
                  pills.find((p) => p.id === sectionExpanded)?.label ??
                  t("composer.runStatus.panel")
                }
              >
                <ExpandedBody
                  section={sectionExpanded}
                  todos={model.displayTodos}
                  subagents={model.subagents}
                  plan={model.plan}
                  isPlanMode={isPlanMode}
                  isProcessing={isProcessing}
                  isCodexEngine={isCodexEngine}
                  sessionFileChanges={model.sessionFileChanges}
                  onOpenDiffPath={onOpenDiffPath}
                  onInspectSubagent={onInspectSubagent}
                  onRevertFile={onRevertFile ? handleRevertFile : undefined}
                  onRevertAllFiles={
                    onRevertAllFiles ? handleRevertAllFiles : undefined
                  }
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className={`composer-run-status-toolbar${
          chromeOpen ? "" : " is-collapsed"
        }`}
      >
        {chromeOpen ? (
          <div
            className="composer-run-status-pills"
            role="tablist"
            aria-label={t("composer.runStatus.label")}
          >
            {pills.map((pill) => {
              const selected = sectionExpanded === pill.id;
              const Icon = pill.Icon;
              return (
                <button
                  key={pill.id}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${pill.id}`}
                  data-section={pill.id}
                  className={`composer-run-status-pill${selected ? " is-selected" : ""}${
                    pill.running ? " is-running" : ""
                  }`}
                  aria-selected={selected}
                  aria-expanded={selected}
                  aria-controls={selected ? panelId : undefined}
                  title={
                    pill.hint
                      ? `${pill.label} ${pill.countLabel} · ${pill.hint}`
                      : `${pill.label} ${pill.countLabel}`
                  }
                  onClick={() => model.toggleSection(pill.id)}
                >
                  {pill.running ? (
                    <span className="composer-run-status-live-dot" aria-hidden />
                  ) : null}
                  <Icon
                    size={14}
                    strokeWidth={2.1}
                    aria-hidden
                    className="composer-run-status-pill-icon"
                  />
                  <span className="composer-run-status-pill-label">
                    {pill.label}
                  </span>
                  {pill.id === "edit" ? (
                    <span className="composer-run-status-pill-count composer-run-status-pill-count--edit">
                      <RollingStat
                        className="is-add"
                        prefix="+"
                        value={model.totalAdditions}
                        data-testid="composer-run-status-edit-additions"
                      />
                      <RollingStat
                        className="is-del"
                        prefix="-"
                        value={model.totalDeletions}
                        data-testid="composer-run-status-edit-deletions"
                      />
                    </span>
                  ) : (
                    <span className="composer-run-status-pill-count">
                      {pill.countLabel}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="composer-run-status-toolbar-spacer" aria-hidden />
        )}

        <button
          type="button"
          className={`composer-run-status-chrome-toggle${
            hasLive ? " is-live" : ""
          }`}
          data-testid="composer-run-status-chrome-toggle"
          aria-expanded={chromeOpen}
          aria-controls={chromeOpen ? panelId : undefined}
          title={
            chromeOpen
              ? t("composer.runStatus.collapseChrome")
              : t("composer.runStatus.expandChrome")
          }
          aria-label={
            chromeOpen
              ? t("composer.runStatus.collapseChrome")
              : t("composer.runStatus.expandChrome")
          }
          onClick={toggleChrome}
        >
          {hasLive && !chromeOpen ? (
            <span className="composer-run-status-live-dot" aria-hidden />
          ) : null}
          <ToggleIcon size={15} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  );
});

function ExpandedBody({
  section,
  todos,
  subagents,
  plan,
  isPlanMode,
  isProcessing,
  isCodexEngine,
  sessionFileChanges,
  onOpenDiffPath,
  onInspectSubagent,
  onRevertFile,
  onRevertAllFiles,
}: {
  section: RunStatusSection;
  todos: TodoItem[];
  subagents: SubagentInfo[];
  plan: TurnPlan | null;
  isPlanMode: boolean;
  isProcessing: boolean;
  isCodexEngine: boolean;
  sessionFileChanges: TurnFileChangesSummary | null;
  onOpenDiffPath?: (path: string) => void;
  onInspectSubagent?: (agent: SubagentInfo) => void;
  onRevertFile?: (path: string) => void | Promise<void>;
  onRevertAllFiles?: (paths: string[]) => void | Promise<void>;
}) {
  if (section === "todo") {
    return (
      <div className="composer-run-status-body">
        <TodoList todos={todos} />
      </div>
    );
  }
  if (section === "subagent") {
    return (
      <div className="composer-run-status-body composer-run-status-body--subagents">
        <RunStatusSubagentRows
          subagents={subagents}
          onInspectSubagent={onInspectSubagent}
        />
      </div>
    );
  }
  if (section === "plan") {
    return (
      <div className="composer-run-status-body">
        <PlanList
          plan={plan}
          isPlanMode={isPlanMode}
          isProcessing={isProcessing}
          isCodexEngine={isCodexEngine}
        />
      </div>
    );
  }
  if (!sessionFileChanges || sessionFileChanges.files.length === 0) {
    return (
      <div className="composer-run-status-body">
        <div className="sp-empty">{/* empty */}</div>
      </div>
    );
  }
  return (
    <div className="composer-run-status-body composer-run-status-body--files">
      <TurnFilesChangedCard
        summary={sessionFileChanges}
        onPreviewFileDiff={onOpenDiffPath}
        onRevertFile={onRevertFile}
        onRevertAll={onRevertAllFiles}
      />
    </div>
  );
}
