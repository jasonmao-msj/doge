import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TurnPlan } from "../../../../types";
import type { SubagentInfo, TodoItem } from "../../../status-panel/types";
import {
  fileChangeSignature,
  filterTurnFileChangesSummary,
  type FileChangeSignatureMap,
  type TurnFileChangesSummary,
} from "../../../messages/utils/turnFileChanges";
import { resolvePlanStepStatusForDisplay } from "../../../threads/utils/threadNormalize";
import type { RunStatusSection } from "./types";

export type ComposerRunStatusInput = {
  todos: TodoItem[];
  subagents: SubagentInfo[];
  plan: TurnPlan | null;
  isPlanMode: boolean;
  isProcessing: boolean;
  /** Codex + collaboration：plan 步骤并入任务 pill，不单独显示 Plan */
  mergePlanIntoTodos: boolean;
  /**
   * 全会话文件变更汇总（含 live 段）。
   * 撤销隐藏由本 hook 维护，不直接改会话 tool 历史。
   */
  sessionFileChanges: TurnFileChangesSummary | null;
  /** 切换会话时清空撤销隐藏态 */
  sessionScopeKey?: string | null;
};

export function useComposerRunStatus(input: ComposerRunStatusInput) {
  const {
    todos,
    subagents,
    plan,
    isPlanMode,
    isProcessing,
    mergePlanIntoTodos,
    sessionFileChanges,
    sessionScopeKey = null,
  } = input;

  const displayTodos = useMemo(() => {
    if (mergePlanIntoTodos && plan && plan.steps.length > 0) {
      return plan.steps.map((step) => {
        const statusForDisplay = resolvePlanStepStatusForDisplay(
          step.status,
          isProcessing,
        );
        return {
          content: step.step,
          status:
            statusForDisplay === "completed"
              ? ("completed" as const)
              : statusForDisplay === "inProgress"
                ? ("in_progress" as const)
                : ("pending" as const),
        };
      });
    }
    return todos;
  }, [isProcessing, mergePlanIntoTodos, plan, todos]);

  const todoCompleted = displayTodos.filter((t) => t.status === "completed").length;
  const todoTotal = displayTodos.length;
  const todoRunning = displayTodos.some((t) => t.status === "in_progress");

  const subagentCompleted = subagents.filter((s) => s.status === "completed").length;
  const subagentTotal = subagents.length;
  const subagentRunning = subagents.some((s) => s.status === "running");
  const runningSubagentLabel =
    subagents.find((s) => s.status === "running")?.description?.trim() || null;

  const planSteps = plan?.steps ?? [];
  const planCompleted = planSteps.filter((s) => s.status === "completed").length;
  const planTotal = planSteps.length;
  const showPlanSection =
    !mergePlanIntoTodos && (isPlanMode || planTotal > 0);

  // 撤销成功后按 path+增删签名隐藏；同 path 统计变化视为再编辑并自动恢复展示。
  const [revertedSignatures, setRevertedSignatures] = useState<FileChangeSignatureMap>(
    () => new Map(),
  );

  useEffect(() => {
    setRevertedSignatures(new Map());
  }, [sessionScopeKey]);

  const rawSessionFileChanges = sessionFileChanges;
  const visibleSessionFileChanges = useMemo(
    () => filterTurnFileChangesSummary(rawSessionFileChanges, revertedSignatures),
    [rawSessionFileChanges, revertedSignatures],
  );

  const markFilesReverted = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      const source = rawSessionFileChanges;
      if (!source) return;
      const sigByPath = new Map<string, string>();
      for (const file of source.files) {
        sigByPath.set(file.path, fileChangeSignature(file));
      }
      setRevertedSignatures((prev) => {
        const next = new Map(prev);
        for (const path of paths) {
          const sig = sigByPath.get(path);
          if (sig != null) {
            next.set(path, sig);
          }
        }
        return next;
      });
    },
    [rawSessionFileChanges],
  );

  const editFileCount = visibleSessionFileChanges?.files.length ?? 0;
  const totalAdditions = visibleSessionFileChanges?.totalAdditions ?? 0;
  const totalDeletions = visibleSessionFileChanges?.totalDeletions ?? 0;
  const showEditSection = editFileCount > 0;
  const editRunning =
    isProcessing &&
    Boolean(
      visibleSessionFileChanges?.files.some((file) => file.status === "processing"),
    );

  const showTodoSection = todoTotal > 0;
  const showSubagentSection = subagentTotal > 0;

  const visible =
    showTodoSection || showSubagentSection || showPlanSection || showEditSection;

  const [expandedSection, setExpandedSection] = useState<RunStatusSection | null>(
    null,
  );
  const userCollapsedRef = useRef(false);
  const autoExpandedSubagentRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      setExpandedSection(null);
      userCollapsedRef.current = false;
      autoExpandedSubagentRef.current = false;
      return;
    }
    setExpandedSection((current) => {
      if (current === "todo" && !showTodoSection) return null;
      if (current === "subagent" && !showSubagentSection) return null;
      if (current === "plan" && !showPlanSection) return null;
      if (current === "edit" && !showEditSection) return null;
      return current;
    });
  }, [
    showEditSection,
    showPlanSection,
    showSubagentSection,
    showTodoSection,
    visible,
  ]);

  useEffect(() => {
    if (!subagentRunning || !showSubagentSection) return;
    if (userCollapsedRef.current || autoExpandedSubagentRef.current) return;
    autoExpandedSubagentRef.current = true;
    setExpandedSection("subagent");
  }, [showSubagentSection, subagentRunning]);

  const toggleSection = useCallback((section: RunStatusSection) => {
    setExpandedSection((current) => {
      if (current === section) {
        userCollapsedRef.current = true;
        return null;
      }
      userCollapsedRef.current = false;
      return section;
    });
  }, []);

  const collapse = useCallback(() => {
    userCollapsedRef.current = true;
    setExpandedSection(null);
  }, []);

  return {
    visible,
    expandedSection,
    toggleSection,
    collapse,
    displayTodos,
    todoCompleted,
    todoTotal,
    todoRunning,
    subagents,
    subagentCompleted,
    subagentTotal,
    subagentRunning,
    runningSubagentLabel,
    showTodoSection,
    showSubagentSection,
    showPlanSection,
    showEditSection,
    plan,
    planCompleted,
    planTotal,
    sessionFileChanges: visibleSessionFileChanges,
    editFileCount,
    totalAdditions,
    totalDeletions,
    editRunning,
    markFilesReverted,
  };
}

export type ComposerRunStatusModel = ReturnType<typeof useComposerRunStatus>;
