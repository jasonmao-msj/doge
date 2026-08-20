import { useEffect, useState } from "react";
import UserRound from "lucide-react/dist/esm/icons/user-round";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import { useAccountExperienceCopyV1 } from "../hooks/useAccountExperienceCopy";
import { useAccountSubscriptionSummaryV1 } from "../hooks/useAccountSubscriptionSummaryV1";
import { AccountSubscriptionSummarySurface } from "./AccountSubscriptionPanel";

export type AccountSidebarShortcutProps = {
  /** Open Settings > account in the host Sidebar integration. */
  readonly onOpenAccount: () => void;
  readonly accountLabel?: string | null;
  readonly enabled?: boolean;
};

/**
 * Compact account entry point. The summary read is deliberately deferred
 * until the user opens the popover.
 */
export function AccountSidebarShortcut({
  onOpenAccount,
  accountLabel,
  enabled = true,
}: AccountSidebarShortcutProps) {
  const copy = useAccountExperienceCopyV1();
  const [open, setOpen] = useState(false);
  const summaryState = useAccountSubscriptionSummaryV1({
    autoLoad: false,
    enabled,
  });
  const {
    failure,
    hasLoaded,
    load,
    loading,
    summary,
  } = summaryState;

  useEffect(() => {
    if (!open || !enabled || hasLoaded || loading) return;
    void load();
  }, [enabled, hasLoaded, load, loading, open]);

  const triggerLabel = accountLabel
    ? `${copy.accountCenter}: ${accountLabel}`
    : copy.accountCenter;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="account-sidebar-shortcut"
              aria-label={triggerLabel}
              title={triggerLabel}
            >
              <UserRound size={18} aria-hidden />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {triggerLabel}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="account-sidebar-shortcut-popover"
        side="right"
        align="end"
        sideOffset={10}
      >
        <AccountSubscriptionSummarySurface
          summary={summary}
          loading={loading}
          failure={failure}
          compact
          accountLabel={accountLabel}
          onRetry={enabled ? load : undefined}
          onOpenAccount={() => {
            setOpen(false);
            onOpenAccount();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
