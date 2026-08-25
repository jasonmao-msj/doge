import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { dispatchOpenTaskRunEvent } from "@/services/taskRunNavigationEvents";
import {
  compareTaskRunSurfacePriority,
  describeTaskRunSurface,
} from "../../../tasks/utils/taskRunSurface";
import type { MessagesProps } from "../../types/messagesTypes";

type MessagesLinkedRunBannerProps = {
  taskRuns: NonNullable<MessagesProps["taskRuns"]>;
  threadId: string | null | undefined;
  workspaceId: string | null | undefined;
};

export function MessagesLinkedRunBanner({
  taskRuns,
  threadId,
  workspaceId,
}: MessagesLinkedRunBannerProps) {
  const { t } = useTranslation();
  const linkedRun = useMemo(() => {
    if (!threadId) {
      return null;
    }
    return taskRuns
      .filter((run) =>
        run.linkedThreadId === threadId &&
        (!workspaceId || run.task.workspaceId === workspaceId),
      )
      .sort(compareTaskRunSurfacePriority)[0] ?? null;
  }, [taskRuns, threadId, workspaceId]);
  const surface = linkedRun ? describeTaskRunSurface(linkedRun) : null;

  if (!linkedRun || !surface) {
    return null;
  }

  return (
    <div className={`messages-linked-run messages-linked-run--${surface.severity}`}>
      <div>
        <span className="messages-linked-run-eyebrow">
          {t("messages.linkedRunEyebrow", "Linked run")}
        </span>
        <strong>{linkedRun.task.title || linkedRun.task.taskId}</strong>
        <span>
          {t(`taskCenter.status.${linkedRun.status}`, linkedRun.status)}
          {" · "}
          {surface.summary || t("taskCenter.unavailable", "Unavailable")}
        </span>
      </div>
      <button type="button" onClick={() => dispatchOpenTaskRunEvent(linkedRun.runId)}>
        {t("messages.openLinkedRun", "Open run detail")}
      </button>
    </div>
  );
}
