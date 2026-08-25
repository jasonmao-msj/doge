import type { ThreadTokenUsage } from "../../../types";
import type { AgentTaskNotification } from "@/contracts/agentTaskNotification";
import type {
  EngineTaskOutputEngine,
  EngineTaskOutputSnapshot,
  EngineTaskOutputSource,
  EngineTaskOutputStatus,
  EngineTaskOutputTelemetryStatus,
} from "../types";

const MAX_RECENT_OUTPUT_CHARS = 1600;

const SUPPORTED_TASK_OUTPUT_ENGINES: readonly EngineTaskOutputEngine[] = [
  "claude",
  "codex",
  "gemini",
  "grok",
  "kimi",
  "opencode",
];

function normalizeTaskOutputEngine(
  value: EngineTaskOutputEngine | string | null | undefined,
): EngineTaskOutputEngine {
  return (SUPPORTED_TASK_OUTPUT_ENGINES as readonly string[]).includes(value ?? "")
    ? (value as EngineTaskOutputEngine)
    : "claude";
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function truncateRecentOutput(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  if (normalized.length <= MAX_RECENT_OUTPUT_CHARS) {
    return normalized;
  }
  return normalized.slice(0, MAX_RECENT_OUTPUT_CHARS).trimEnd();
}

function normalizeTelemetryStatus(
  tokenUsage: ThreadTokenUsage | null | undefined,
): EngineTaskOutputTelemetryStatus {
  if (!tokenUsage) {
    return "pending";
  }
  const freshness = tokenUsage.contextUsageFreshness?.trim().toLowerCase();
  if (freshness === "live" || freshness === "estimated" || freshness === "pending") {
    return freshness;
  }
  if (freshness === "restored") {
    return "estimated";
  }
  return "unavailable";
}

export function buildEngineTaskOutputSnapshot(
  source: EngineTaskOutputSource,
  tokenUsage: ThreadTokenUsage | null | undefined,
): EngineTaskOutputSnapshot {
  return {
    id: source.id,
    engine: source.engine,
    title: normalizeOptionalText(source.title) ?? source.engine,
    description: normalizeOptionalText(source.description) ?? "",
    status: source.status,
    taskId: normalizeOptionalText(source.taskId),
    toolUseId: normalizeOptionalText(source.toolUseId),
    threadId: normalizeOptionalText(source.threadId),
    outputFileName: normalizeOptionalText(source.outputFileName),
    outputFilePath: normalizeOptionalText(source.outputFilePath),
    recentOutput: truncateRecentOutput(source.recentOutput),
    tokenUsage: tokenUsage ?? null,
    telemetryStatus: normalizeTelemetryStatus(tokenUsage),
  };
}

export function mapSubagentStatusToTaskOutputStatus(
  status: "running" | "completed" | "error",
): EngineTaskOutputStatus {
  if (status === "error") {
    return "error";
  }
  if (status === "completed") {
    return "completed";
  }
  return "running";
}

export function buildTaskOutputSourceFromNotification(input: {
  itemId: string;
  engine?: EngineTaskOutputEngine | string | null;
  title: string;
  notification: AgentTaskNotification;
}): EngineTaskOutputSource {
  const engine = normalizeTaskOutputEngine(input.engine);
  const status = normalizeNotificationStatus(input.notification.status);
  return {
    id: input.itemId,
    engine,
    title: input.title,
    description: input.notification.summary,
    status,
    taskId: input.notification.taskId,
    toolUseId: input.notification.toolUseId,
    outputFilePath: input.notification.outputFile,
    outputFileName: input.notification.outputFile
      ? basenameFromPath(input.notification.outputFile)
      : null,
    recentOutput: input.notification.resultText,
  };
}

function normalizeNotificationStatus(value: string | null): EngineTaskOutputStatus {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return "completed";
  }
  if (/(fail|error|cancel|abort|timeout)/.test(normalized)) {
    return "error";
  }
  if (/(run|pending|progress|queued|start)/.test(normalized)) {
    return "running";
  }
  return "completed";
}

function basenameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

export const engineTaskOutputProjectionInternals = {
  truncateRecentOutput,
};
