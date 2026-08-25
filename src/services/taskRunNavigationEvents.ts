export const OPEN_TASK_RUN_EVENT = "doge:open-task-run";

export function dispatchOpenTaskRunEvent(runId: string): void {
  if (typeof window === "undefined" || !runId.trim()) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(OPEN_TASK_RUN_EVENT, {
      detail: { runId },
    }),
  );
}

export function readOpenTaskRunEvent(event: Event): string | null {
  const detail = (event as CustomEvent<{ runId?: unknown }>).detail;
  const runId = typeof detail?.runId === "string" ? detail.runId.trim() : "";
  return runId || null;
}
