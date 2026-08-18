import type { ReactNode } from "react";
import LogOut from "lucide-react/dist/esm/icons/log-out";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import type { AccountExperienceControllerV1 } from "../hooks/useAccountExperienceController";
import { useAccountExperienceCopyV1 } from "../hooks/useAccountExperienceCopy";

export type AccountCenterHeaderProps = {
  readonly controller: AccountExperienceControllerV1;
};

export function AccountCenterHeader({ controller }: AccountCenterHeaderProps) {
  const copy = useAccountExperienceCopyV1();
  const session = controller.bootstrap?.session;
  if (!session || session.status !== "authenticated") return null;
  const usageFetchedAt = controller.centerTab === "usage"
    ? controller.usage?.fetchedAt ?? null
    : null;
  const displayName = controller.profile?.profile.displayName ?? session.profileLabel;

  return (
    <header className="account-center-header">
      <div>
        <h2 id="account-center-title">{displayName}</h2>
        <p className="account-connection-status">
          <span className="account-connection-dot" aria-hidden />
          <span>{copy.signedInAs}</span>
          <span aria-hidden>·</span>
          <span>{session.primaryEmailLabel}</span>
        </p>
      </div>
      <div className="account-center-header-actions">
        {usageFetchedAt ? (
          <time
            className="account-header-fetched-at"
            dateTime={usageFetchedAt}
            data-freshness={controller.usage?.freshness ?? "fresh"}
          >
            {formatShortDateTimeV1(usageFetchedAt)}
          </time>
        ) : null}
        {controller.centerTab === "usage" ? (
          <AccountHeaderIconAction
            label={copy.refreshUsage}
            busy={controller.usageLoading}
            disabled={controller.usageLoading}
            onClick={() => void controller.loadUsage()}
          >
            <RefreshCw
              size={18}
              className={controller.usageLoading ? "account-spin" : ""}
              aria-hidden
            />
          </AccountHeaderIconAction>
        ) : null}
        <AccountHeaderIconAction
          label={copy.logout}
          busy={controller.busy}
          disabled={controller.busy}
          onClick={() => void controller.logout("thisDevice")}
        >
          <LogOut size={18} aria-hidden />
        </AccountHeaderIconAction>
      </div>
    </header>
  );
}

function AccountHeaderIconAction({
  label,
  busy,
  disabled,
  onClick,
  children,
}: {
  readonly label: string;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="account-header-icon-button"
          aria-label={label}
          aria-busy={busy}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent className="account-header-action-tooltip" side="bottom" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function formatShortDateTimeV1(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
