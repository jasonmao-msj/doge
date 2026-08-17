import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RuntimePoolRow, RuntimePoolSnapshot, WorkspaceInfo } from "../../../types";
import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";
import {
  getStartupTraceSnapshot,
  subscribeStartupTrace,
  type StartupTraceEvent,
  type StartupWorkspaceScope,
} from "../../startup-orchestration/utils/startupTrace";
import {
  clearGlobalRuntimeNotices,
  filterVisibleGlobalRuntimeNoticeDockItems,
  pushGlobalRuntimeNotice,
  subscribeGlobalRuntimeNotices,
  type GlobalRuntimeNotice,
  type GlobalRuntimeNoticeSeverity,
} from "../../../services/globalRuntimeNotices";
import { getRuntimePoolSnapshot } from "../../../services/tauri";
import { subscribeRuntimePoolChanged } from "../../../services/events";
import { setVisibilityGatedInterval } from "../../../services/visibilityGatedInterval";

const GLOBAL_RUNTIME_NOTICE_DOCK_VISIBILITY_KEY = "globalRuntimeNoticeDock.visibility";
// 慢速兜底：主通道是 Rust 差量 emit 的 runtime-pool-changed 事件；
// 60s 门控轮询只用于防事件丢失后的漂移收敛。
const GLOBAL_RUNTIME_NOTICE_RUNTIME_BACKSTOP_MS = 60_000;
let lastMirroredStartupTraceSequence = 0;

export type GlobalRuntimeNoticeDockVisibility = "minimized" | "expanded";
export type GlobalRuntimeNoticeDockStatus = "idle" | "has-error";

type RuntimeSignalToken =
  | "startup-pending"
  | "resume-pending"
  | "ready"
  | "suspect-stale"
  | "cooldown"
  | "quarantined"
  | null;

type StartupNoticePayload = {
  severity: GlobalRuntimeNoticeSeverity;
  messageKey: string;
};

type WorkspaceLabelResolver = (workspaceId: string) => string;

function resolveWorkspaceLabel(
  row: Pick<RuntimePoolRow, "workspaceId" | "workspaceName" | "workspacePath">,
) {
  const trimmedName = row.workspaceName.trim();
  if (trimmedName.length > 0) {
    return trimmedName;
  }
  const trimmedPath = row.workspacePath.trim();
  const segments = trimmedPath
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? (trimmedPath || row.workspaceId.trim());
}

function resolveRuntimeEngineLabel(engine: string) {
  switch (engine.trim().toLowerCase()) {
    case "claude":
      return "Claude";
    case "gemini":
      return "Gemini";
    case "grok":
      return "Grok";
    case "kimi":
      return "Kimi";
    case "opencode":
      return "OpenCode";
    case "codex":
      return "Codex";
    default:
      return engine.trim() || "Runtime";
  }
}

function resolveRuntimeSignalToken(row: RuntimePoolRow): RuntimeSignalToken {
  if (row.foregroundWorkState === "startup-pending") {
    return "startup-pending";
  }
  if (row.foregroundWorkState === "resume-pending") {
    return "resume-pending";
  }
  if (row.startupState === "starting") {
    return "startup-pending";
  }
  if (
    row.startupState === "ready" ||
    row.startupState === "suspect-stale" ||
    row.startupState === "cooldown" ||
    row.startupState === "quarantined"
  ) {
    return row.startupState;
  }
  return null;
}

function shouldPushRuntimeSignal(
  previousToken: RuntimeSignalToken,
  nextToken: RuntimeSignalToken,
) {
  if (!nextToken) {
    return false;
  }
  if (!previousToken) {
    return true;
  }
  if (nextToken === "ready") {
    return previousToken !== "ready";
  }
  return previousToken !== nextToken;
}

function resolveRuntimeSignalPayload(
  token: Exclude<RuntimeSignalToken, null>,
): {
  severity: GlobalRuntimeNoticeSeverity;
  messageKey: string;
} {
  switch (token) {
    case "startup-pending":
      return {
        severity: "info",
        messageKey: "runtimeNotice.runtime.startupPending",
      };
    case "resume-pending":
      return {
        severity: "warning",
        messageKey: "runtimeNotice.runtime.resumePending",
      };
    case "ready":
      return {
        severity: "info",
        messageKey: "runtimeNotice.runtime.ready",
      };
    case "suspect-stale":
      return {
        severity: "warning",
        messageKey: "runtimeNotice.runtime.suspectStale",
      };
    case "cooldown":
      return {
        severity: "warning",
        messageKey: "runtimeNotice.runtime.cooldown",
      };
    case "quarantined":
      return {
        severity: "error",
        messageKey: "runtimeNotice.runtime.quarantined",
      };
  }
}

function resolveStartupWorkspaceLabel(
  workspaceScope: StartupWorkspaceScope,
  resolveWorkspaceLabelById: WorkspaceLabelResolver,
) {
  return typeof workspaceScope === "object"
    ? resolveWorkspaceLabelById(workspaceScope.workspaceId)
    : "global";
}

function resolveStartupTaskNoticePayload(
  lifecycleState: Extract<StartupTraceEvent, { type: "task" }>["lifecycleState"],
): StartupNoticePayload | null {
  switch (lifecycleState) {
    case "failed":
      return {
        severity: "error",
        messageKey: "runtimeNotice.startup.taskFailed",
      };
    case "timed-out":
      return {
        severity: "warning",
        messageKey: "runtimeNotice.startup.taskTimedOut",
      };
    case "degraded":
      return {
        severity: "warning",
        messageKey: "runtimeNotice.startup.taskDegraded",
      };
    default:
      return null;
  }
}

function resolveStartupCommandNoticePayload(
  status: Extract<StartupTraceEvent, { type: "command" }>["status"],
): StartupNoticePayload | null {
  if (status !== "failed") {
    return null;
  }
  return {
    severity: "error",
    messageKey: "runtimeNotice.startup.commandFailed",
  };
}

function pushStartupTraceRuntimeNotice(
  event: StartupTraceEvent,
  resolveWorkspaceLabelById: WorkspaceLabelResolver,
) {
  if (event.type === "task") {
    const noticePayload = resolveStartupTaskNoticePayload(event.lifecycleState);
    if (!noticePayload) {
      return;
    }
    pushGlobalRuntimeNotice({
      severity: noticePayload.severity,
      category: "diagnostic",
      messageKey: noticePayload.messageKey,
      messageParams: {
        phase: event.phase,
        task: event.traceLabel,
        workspace: resolveStartupWorkspaceLabel(event.workspaceScope, resolveWorkspaceLabelById),
        durationMs: event.durationMs === null ? null : Math.round(event.durationMs),
        reason: event.fallbackReason,
      },
      dedupeKey: `startup:task:${event.taskId}:${event.lifecycleState}:${event.sequence}`,
    });
    return;
  }

  if (event.type === "command") {
    const noticePayload = resolveStartupCommandNoticePayload(event.status);
    if (!noticePayload) {
      return;
    }
    pushGlobalRuntimeNotice({
      severity: noticePayload.severity,
      category: "diagnostic",
      messageKey: noticePayload.messageKey,
      messageParams: {
        command: event.commandLabel,
        workspace: resolveStartupWorkspaceLabel(event.workspaceScope, resolveWorkspaceLabelById),
        durationMs: Math.round(event.durationMs),
      },
      dedupeKey: `startup:command:${event.commandLabel}:failed:${event.sequence}`,
    });
  }
}

function resetMirroredStartupTraceSequenceIfTraceWasReset(
  events: readonly StartupTraceEvent[],
) {
  const latestSequence = events[events.length - 1]?.sequence ?? 0;
  if (latestSequence < lastMirroredStartupTraceSequence) {
    lastMirroredStartupTraceSequence = 0;
  }
}

function reconcileRuntimeSnapshot(
  snapshot: RuntimePoolSnapshot,
  previousStateByWorkspace: Map<string, RuntimeSignalToken>,
) {
  const nextStateByWorkspace = new Map<string, RuntimeSignalToken>();

  for (const row of snapshot.rows) {
    const nextToken = resolveRuntimeSignalToken(row);
    const previousToken = previousStateByWorkspace.get(row.workspaceId) ?? null;
    if (nextToken) {
      nextStateByWorkspace.set(row.workspaceId, nextToken);
    }
    if (!shouldPushRuntimeSignal(previousToken, nextToken)) {
      continue;
    }
    if (!nextToken) {
      continue;
    }
    const signal = resolveRuntimeSignalPayload(nextToken);
    pushGlobalRuntimeNotice({
      severity: signal.severity,
      category: "runtime",
      messageKey: signal.messageKey,
      messageParams: {
        workspace: resolveWorkspaceLabel(row),
        engine: resolveRuntimeEngineLabel(row.engine),
      },
      dedupeKey: `runtime:${row.workspaceId}:${nextToken}`,
    });
  }

  return nextStateByWorkspace;
}

function areRuntimeRowsSignalEquivalent(
  previousRows: readonly RuntimePoolRow[],
  nextRows: readonly RuntimePoolRow[],
) {
  if (previousRows.length !== nextRows.length) {
    return false;
  }
  const previousRowByKey = new Map(
    previousRows.map((row) => [`${row.workspaceId}\u0000${row.engine}`, row]),
  );
  return nextRows.every((nextRow) => {
    const previousRow = previousRowByKey.get(`${nextRow.workspaceId}\u0000${nextRow.engine}`);
    return (
      previousRow !== undefined &&
      previousRow.workspaceName === nextRow.workspaceName &&
      previousRow.workspacePath === nextRow.workspacePath &&
      previousRow.state === nextRow.state &&
      previousRow.lifecycleState === nextRow.lifecycleState &&
      previousRow.foregroundWorkState === nextRow.foregroundWorkState &&
      previousRow.startupState === nextRow.startupState &&
      previousRow.reasonCode === nextRow.reasonCode &&
      previousRow.recoverySource === nextRow.recoverySource &&
      previousRow.retryable === nextRow.retryable &&
      previousRow.userAction === nextRow.userAction
    );
  });
}

function areNoticeMessageParamsEqual(
  previousParams: GlobalRuntimeNotice["messageParams"],
  nextParams: GlobalRuntimeNotice["messageParams"],
) {
  if (Object.is(previousParams, nextParams)) {
    return true;
  }
  const previousKeys = Object.keys(previousParams ?? {});
  const nextKeys = Object.keys(nextParams ?? {});
  if (previousKeys.length !== nextKeys.length) {
    return false;
  }
  return previousKeys.every((key) =>
    Object.is(previousParams?.[key], nextParams?.[key]),
  );
}

function areGlobalRuntimeNoticesEqual(
  previousNotices: readonly GlobalRuntimeNotice[],
  nextNotices: readonly GlobalRuntimeNotice[],
) {
  if (previousNotices.length !== nextNotices.length) {
    return false;
  }
  return nextNotices.every((nextNotice, index) => {
    const previousNotice = previousNotices[index];
    return (
      previousNotice !== undefined &&
      previousNotice.id === nextNotice.id &&
      previousNotice.severity === nextNotice.severity &&
      previousNotice.category === nextNotice.category &&
      previousNotice.messageKey === nextNotice.messageKey &&
      previousNotice.timestampMs === nextNotice.timestampMs &&
      previousNotice.repeatCount === nextNotice.repeatCount &&
      previousNotice.dedupeKey === nextNotice.dedupeKey &&
      areNoticeMessageParamsEqual(
        previousNotice.messageParams,
        nextNotice.messageParams,
      )
    );
  });
}

export function sanitizeGlobalRuntimeNoticeDockVisibility(
  value: unknown,
): GlobalRuntimeNoticeDockVisibility {
  return value === "expanded" ? "expanded" : "minimized";
}

export function useGlobalRuntimeNoticeDock(workspaces: readonly WorkspaceInfo[] = []) {
  const [notices, setNotices] = useState<GlobalRuntimeNotice[]>([]);
  const [runtimeRows, setRuntimeRows] = useState<RuntimePoolRow[]>([]);
  const [visibility, setVisibility] = useState<GlobalRuntimeNoticeDockVisibility>(() =>
    sanitizeGlobalRuntimeNoticeDockVisibility(
      getClientStoreSync("app", GLOBAL_RUNTIME_NOTICE_DOCK_VISIBILITY_KEY),
    ),
  );
  const runtimeStateByWorkspaceRef = useRef(new Map<string, RuntimeSignalToken>());
  const workspaceLabelById = useMemo(() => {
    const labelById = new Map<string, string>();
    for (const workspace of workspaces) {
      labelById.set(workspace.id, workspace.name.trim() || workspace.id);
    }
    return labelById;
  }, [workspaces]);
  const workspaceLabelByIdRef = useRef(workspaceLabelById);

  useEffect(() => {
    workspaceLabelByIdRef.current = workspaceLabelById;
  }, [workspaceLabelById]);

  useEffect(() => {
    return subscribeGlobalRuntimeNotices((snapshot) => {
      const nextVisibleNotices = filterVisibleGlobalRuntimeNoticeDockItems(snapshot);
      setNotices((previousNotices) =>
        areGlobalRuntimeNoticesEqual(previousNotices, nextVisibleNotices)
          ? previousNotices
          : nextVisibleNotices,
      );
    });
  }, []);

  useEffect(() => {
    const mirrorAbnormalStartupEvents = () => {
      const snapshot = getStartupTraceSnapshot();
      resetMirroredStartupTraceSequenceIfTraceWasReset(snapshot.events);
      for (const event of snapshot.events) {
        if (event.sequence <= lastMirroredStartupTraceSequence) {
          continue;
        }
        lastMirroredStartupTraceSequence = event.sequence;
        pushStartupTraceRuntimeNotice(
          event,
          (workspaceId) => workspaceLabelByIdRef.current.get(workspaceId) ?? workspaceId,
        );
      }
    };

    mirrorAbnormalStartupEvents();
    return subscribeStartupTrace(mirrorAbnormalStartupEvents);
  }, []);

  useEffect(() => {
    writeClientStoreValue("app", GLOBAL_RUNTIME_NOTICE_DOCK_VISIBILITY_KEY, visibility);
  }, [visibility]);

  const visibleNotices = notices;

  useEffect(() => {
    let disposed = false;

    const applyRuntimeSnapshot = (snapshot: RuntimePoolSnapshot) => {
      setRuntimeRows((previousRows) =>
        areRuntimeRowsSignalEquivalent(previousRows, snapshot.rows)
          ? previousRows
          : snapshot.rows,
      );
      runtimeStateByWorkspaceRef.current = reconcileRuntimeSnapshot(
        snapshot,
        runtimeStateByWorkspaceRef.current,
      );
    };

    const loadRuntimeSnapshot = async () => {
      try {
        const snapshot = await getRuntimePoolSnapshot();
        if (disposed) {
          return;
        }
        applyRuntimeSnapshot(snapshot);
      } catch (error) {
        if (!disposed) {
          console.error("[runtimeNoticeDock] failed to load runtime snapshot", error);
        }
      }
    };

    void loadRuntimeSnapshot();
    // 主通道：Rust reconcile/mutation 后的差量事件，变化即刷新。
    const unsubscribeRuntimePool = subscribeRuntimePoolChanged((snapshot) => {
      if (!disposed) {
        applyRuntimeSnapshot(snapshot);
      }
    });
    // 兜底：隐藏时暂停轮询，恢复可见时立即补一次快照，防事件丢失漂移。
    const cleanupInterval = setVisibilityGatedInterval(() => {
      void loadRuntimeSnapshot();
    }, GLOBAL_RUNTIME_NOTICE_RUNTIME_BACKSTOP_MS);

    return () => {
      disposed = true;
      unsubscribeRuntimePool();
      cleanupInterval();
    };
  }, []);

  const status = useMemo<GlobalRuntimeNoticeDockStatus>(
    () => (visibleNotices.length > 0 ? "has-error" : "idle"),
    [visibleNotices],
  );

  const expand = useCallback(() => {
    setVisibility("expanded");
  }, []);

  const minimize = useCallback(() => {
    setVisibility("minimized");
  }, []);

  const clear = useCallback(() => {
    clearGlobalRuntimeNotices();
  }, []);

  return {
    notices: visibleNotices,
    visibility,
    status,
    runtimeRows,
    expand,
    minimize,
    clear,
  };
}
