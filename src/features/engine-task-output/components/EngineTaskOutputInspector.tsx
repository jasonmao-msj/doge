import { memo } from "react";
import { useTranslation } from "react-i18next";
import Bot from "lucide-react/dist/esm/icons/bot";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import CircleCheck from "lucide-react/dist/esm/icons/circle-check";
import Clock3 from "lucide-react/dist/esm/icons/clock-3";
import X from "lucide-react/dist/esm/icons/x";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatTokenCount as formatGlobalTokenCount } from "@/utils/tokenFormat";
import type {
  EngineTaskOutputArtifactRefreshState,
  EngineTaskOutputSnapshot,
  EngineTaskOutputStatus,
} from "../types";

type EngineTaskOutputInspectorProps = {
  snapshot: EngineTaskOutputSnapshot;
  refreshState?: EngineTaskOutputArtifactRefreshState;
  onRefresh?: () => void;
  onClose?: () => void;
  className?: string;
};

const STATUS_ICON = {
  running: Clock3,
  completed: CircleCheck,
  error: CircleAlert,
  unavailable: CircleAlert,
} as const;

const STATUS_BADGE_VARIANT = {
  running: "info",
  completed: "success",
  error: "error",
  unavailable: "secondary",
} as const satisfies Record<
  EngineTaskOutputStatus,
  "info" | "success" | "error" | "secondary"
>;

function formatTokenCount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return formatGlobalTokenCount(value);
}

function resolveStatusKey(status: EngineTaskOutputStatus) {
  switch (status) {
    case "completed":
      return "engineTaskOutput.status.completed";
    case "error":
      return "engineTaskOutput.status.error";
    case "unavailable":
      return "engineTaskOutput.status.unavailable";
    case "running":
    default:
      return "engineTaskOutput.status.running";
  }
}

export const EngineTaskOutputInspector = memo(function EngineTaskOutputInspector({
  snapshot,
  refreshState,
  onRefresh,
  onClose,
  className,
}: EngineTaskOutputInspectorProps) {
  const { t } = useTranslation();
  const StatusIcon = STATUS_ICON[snapshot.status] ?? Clock3;
  const usage = snapshot.tokenUsage;
  const usageRows = usage
    ? [
        ["engineTaskOutput.tokens.input", usage.last.inputTokens],
        ["engineTaskOutput.tokens.cached", usage.last.cachedInputTokens],
        ["engineTaskOutput.tokens.output", usage.last.outputTokens],
        ["engineTaskOutput.tokens.total", usage.last.totalTokens],
      ] as const
    : [];

  return (
    <Card
      aria-label={t("engineTaskOutput.label")}
      className={cn("gap-4 rounded-[8px] p-4 before:rounded-[7px]", className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2.5">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
            aria-hidden
          >
            <Bot size={16} />
          </span>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {t("engineTaskOutput.engine", { engine: snapshot.engine })}
            </div>
            <h3 className="mt-0.5 truncate text-sm font-semibold leading-tight text-foreground">
              {snapshot.title}
            </h3>
            {snapshot.description ? (
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                {snapshot.description}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant={STATUS_BADGE_VARIANT[snapshot.status]} className="gap-1">
            <StatusIcon size={13} aria-hidden />
            {t(resolveStatusKey(snapshot.status))}
          </Badge>
          {onClose ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={onClose}
              aria-label={t("engineTaskOutput.close")}
              title={t("engineTaskOutput.close")}
            >
              <X size={14} aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="grid min-w-0 gap-2">
          <h4 className="text-[11px] font-bold text-muted-foreground">
            {t("engineTaskOutput.identity")}
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {snapshot.taskId ? (
              <Badge variant="secondary" className="max-w-full truncate font-normal">
                task {snapshot.taskId}
              </Badge>
            ) : null}
            {snapshot.toolUseId ? (
              <Badge variant="secondary" className="max-w-full truncate font-normal">
                tool {snapshot.toolUseId}
              </Badge>
            ) : null}
            {snapshot.threadId ? (
              <Badge variant="secondary" className="max-w-full truncate font-normal">
                thread {snapshot.threadId}
              </Badge>
            ) : null}
            {snapshot.outputFileName ? (
              <Badge variant="secondary" className="max-w-full truncate font-normal">
                {snapshot.outputFileName}
              </Badge>
            ) : null}
          </div>
        </section>

        <section className="grid min-w-0 gap-2">
          <h4 className="text-[11px] font-bold text-muted-foreground">
            {t("engineTaskOutput.telemetry")}
          </h4>
          {usage ? (
            <div className="grid grid-cols-2 gap-1.5">
              {usageRows.map(([labelKey, value]) => (
                <div
                  key={labelKey}
                  className="grid gap-0.5 rounded-md bg-muted/50 p-1.5"
                >
                  <span className="text-[11px] text-muted-foreground">
                    {t(labelKey)}
                  </span>
                  <strong className="text-xs text-foreground">
                    {formatTokenCount(value) ?? t("engineTaskOutput.pending")}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {t("engineTaskOutput.telemetryPending")}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {t(`engineTaskOutput.telemetryStatus.${snapshot.telemetryStatus}`)}
          </p>
        </section>
      </div>

      <section className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-bold text-muted-foreground">
            {t("engineTaskOutput.recentOutput")}
          </h4>
          {onRefresh && snapshot.outputFilePath ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={onRefresh}
              disabled={refreshState?.isRefreshing ?? false}
            >
              {refreshState?.isRefreshing
                ? t("engineTaskOutput.refreshing")
                : t("engineTaskOutput.refresh")}
            </Button>
          ) : null}
        </div>
        {snapshot.recentOutput ? (
          <pre className="scrollable m-0 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
            {snapshot.recentOutput}
          </pre>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {t("engineTaskOutput.outputUnavailable")}
          </p>
        )}
        {refreshState?.error ? (
          <p className="text-[11px] text-muted-foreground">
            {t("engineTaskOutput.artifactUnavailable")}
          </p>
        ) : refreshState?.truncated ? (
          <p className="text-[11px] text-muted-foreground">
            {t("engineTaskOutput.artifactTruncated")}
          </p>
        ) : refreshState?.source === "artifact" ? (
          <p className="text-[11px] text-muted-foreground">
            {t("engineTaskOutput.artifactLive")}
          </p>
        ) : null}
      </section>
    </Card>
  );
});
