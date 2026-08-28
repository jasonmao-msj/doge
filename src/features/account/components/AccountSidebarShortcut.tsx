import { useState } from "react";
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
import { useProductEntitlementSnapshotV1 } from "../runtime/productEntitlementStore";

export type AccountSidebarShortcutProps = {
  /** Open Settings > account in the host Sidebar integration. */
  readonly onOpenAccount: () => void;
  readonly accountLabel?: string | null;
  readonly enabled?: boolean;
};

/** Compact account entry point backed by the already-ready product snapshot. */
export function AccountSidebarShortcut({
  onOpenAccount,
  accountLabel,
  enabled = true,
}: AccountSidebarShortcutProps) {
  const copy = useAccountExperienceCopyV1();
  const [open, setOpen] = useState(false);
  const product = useProductEntitlementSnapshotV1();
  const dailyPercentage = Math.round(
    product.entitlement?.usage?.daily.percentage ?? 0,
  );

  const triggerLabel = accountLabel
    ? `${copy.accountCenter}: ${accountLabel}`
    : copy.accountCenter;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <span className="account-sidebar-shortcut-trigger-wrapper">
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
          </span>
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
        <div
          className="account-subscription-panel account-subscription-panel--compact"
          data-summary-status={product.status}
        >
          {accountLabel ? (
            <div className="account-summary-identity">
              <strong>{accountLabel}</strong>
            </div>
          ) : null}
          {product.status === "ready" ? (
            <div className="account-product-shortcut-summary">
              <strong>{product.entitlement?.planName ?? "Doge"}</strong>
              <span>{dailyPercentage}%</span>
            </div>
          ) : (
            <div className="account-summary-state" role="status">
              <span>{copy.loading}</span>
            </div>
          )}
          <button
            type="button"
            className="account-summary-open-account"
            disabled={!enabled}
            onClick={() => {
              setOpen(false);
              onOpenAccount();
            }}
          >
            {copy.accountCenter}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
