import { memo } from "react";
import CheckIcon from "lucide-react/dist/esm/icons/check";
import Loader2Icon from "lucide-react/dist/esm/icons/loader-2";
import XIcon from "lucide-react/dist/esm/icons/x";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ToolStatusIndicatorTone =
  | "completed"
  | "processing"
  | "pending"
  | "failed"
  | "error";

type ToolStatusIndicatorProps = {
  tone: ToolStatusIndicatorTone;
  className?: string;
  compact?: boolean;
};

function normalizeTone(tone: ToolStatusIndicatorTone) {
  if (tone === "error") {
    return "failed";
  }
  if (tone === "pending") {
    return "processing";
  }
  return tone;
}

export const ToolStatusIndicator = memo(function ToolStatusIndicator({
  tone,
  className,
  compact = false,
}: ToolStatusIndicatorProps) {
  const { t } = useTranslation();
  const normalizedTone = normalizeTone(tone);
  const label =
    normalizedTone === "completed"
      ? t("tools.statusCompleted", { defaultValue: "Completed" })
      : normalizedTone === "failed"
        ? t("tools.statusFailed", { defaultValue: "Failed" })
        : t("tools.statusRunning", { defaultValue: "Running" });
  const Icon =
    normalizedTone === "completed"
      ? CheckIcon
      : normalizedTone === "failed"
        ? XIcon
        : Loader2Icon;

  return (
    <Badge
      className={cn(
        "tool-status-indicator",
        tone,
        `is-${normalizedTone}`,
        compact && "is-compact",
        className,
      )}
      data-tool-status={normalizedTone}
      aria-label={compact ? label : undefined}
      size="sm"
      title={compact ? label : undefined}
      variant={
        normalizedTone === "failed"
          ? "error"
          : normalizedTone === "completed"
            ? "secondary"
            : "outline"
      }
    >
      <Icon
        aria-hidden="true"
        className={cn(normalizedTone === "processing" && "animate-spin")}
      />
      {compact ? null : (
        <span className="tool-status-indicator-label">{label}</span>
      )}
    </Badge>
  );
});
