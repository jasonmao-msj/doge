import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Check from "lucide-react/dist/esm/icons/check";
import KeyRound from "lucide-react/dist/esm/icons/key-round";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import LogOut from "lucide-react/dist/esm/icons/log-out";
import MoreHorizontal from "lucide-react/dist/esm/icons/more-horizontal";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import X from "lucide-react/dist/esm/icons/x";
import dogeMascotAvatar from "../../../assets/brand/doge-mascot-avatar.png";
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
import type { AccountExperienceControllerV1 } from "../hooks/useAccountExperienceController";
import { useAccountExperienceCopyV1 } from "../hooks/useAccountExperienceCopy";
import type { ProductEntitlementSnapshotV1 } from "../runtime/productEntitlementStore";
import { AccountSecurityPanel } from "./AccountSecurityPanel";

export type AccountCenterHeaderProps = {
  readonly controller: AccountExperienceControllerV1;
  readonly showLegacyConfiguration: boolean;
  readonly product: ProductEntitlementSnapshotV1;
  readonly refreshing: boolean;
  readonly lastUpdatedAt: string | null;
  readonly onRefresh: () => Promise<void>;
};

export function AccountCenterHeader({
  controller,
  showLegacyConfiguration,
  product,
  refreshing,
  lastUpdatedAt,
  onRefresh,
}: AccountCenterHeaderProps) {
  const copy = useAccountExperienceCopyV1();
  const session = controller.bootstrap?.session;
  const [editingProfile, setEditingProfile] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const profileLabel =
    controller.profile?.profile.displayName ??
    (session?.status === "authenticated" ? session.profileLabel : "");
  const profileEditable =
    controller.bootstrap?.capabilities.entries["account.profile"]?.status ===
    "enabled";
  const passwordEditable =
    controller.bootstrap?.capabilities.entries["account.passwordChange"]
      ?.status === "enabled";
  const revokeAllSessionsEnabled =
    controller.bootstrap?.capabilities.entries["account.revokeAllSessions"]
      ?.status === "enabled";
  const securityOverflowAvailable =
    revokeAllSessionsEnabled ||
    (showLegacyConfiguration && controller.configuration.managedKeyReady);

  useEffect(() => {
    if (!editingProfile) setDisplayName(profileLabel);
  }, [editingProfile, profileLabel]);

  useEffect(() => {
    if (controller.securityNotice === "profileUpdated")
      setEditingProfile(false);
  }, [controller.securityNotice]);

  const submitProfile = (event: FormEvent) => {
    event.preventDefault();
    void controller.updateProfile(displayName);
  };

  if (!session || session.status !== "authenticated") return null;

  return (
    <>
      <header className="account-center-header">
        <div>
          <h1 id="account-center-title">{copy.accountDetailsTitle}</h1>
          <p>{copy.accountDetailsDescription}</p>
        </div>
      <div className="account-center-header-actions">
        {lastUpdatedAt ? (
          <time
            className="account-header-fetched-at"
            dateTime={lastUpdatedAt}
          >
            {formatShortDateTimeV1(lastUpdatedAt)}
          </time>
        ) : null}
        {product.status === "ready" ? (
          <AccountHeaderIconAction
            label={copy.accountDetailsRefresh}
            busy={refreshing}
            disabled={refreshing}
            onClick={() => void onRefresh()}
          >
            <RefreshCw
              size={18}
              className={refreshing ? "account-spin" : ""}
              aria-hidden
            />
          </AccountHeaderIconAction>
        ) : null}
        {passwordEditable ? (
          <AccountPasswordAction controller={controller} />
        ) : null}
        {securityOverflowAvailable ? (
          <AccountSecurityOverflowAction
            controller={controller}
            showLegacyConfiguration={showLegacyConfiguration}
          />
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
      <section className="account-profile-card" aria-label={copy.profile}>
        <img className="account-profile-avatar" src={dogeMascotAvatar} alt="" aria-hidden />
        <div className="account-profile-identity">
          {editingProfile ? (
            <form
              className="account-header-profile-editor"
              onSubmit={submitProfile}
            >
              <input
                aria-label={copy.displayName}
                name="display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="off"
                maxLength={80}
                required
                autoFocus
              />
              <AccountHeaderIconAction
                label={copy.saveProfile}
                busy={controller.busy}
                disabled={controller.busy}
                onClick={() => undefined}
                submit
              >
                <Check size={17} aria-hidden />
              </AccountHeaderIconAction>
              <AccountHeaderIconAction
                label={copy.cancel}
                busy={false}
                disabled={controller.busy}
                onClick={() => {
                  setDisplayName(profileLabel);
                  setEditingProfile(false);
                }}
              >
                <X size={17} aria-hidden />
              </AccountHeaderIconAction>
            </form>
          ) : (
            <div className="account-header-profile-line">
              <h2>{profileLabel}</h2>
              {profileEditable ? (
                <AccountHeaderIconAction
                  label={copy.editProfile}
                  busy={false}
                  disabled={controller.busy}
                  onClick={() => setEditingProfile(true)}
                >
                  <Pencil size={15} aria-hidden />
                </AccountHeaderIconAction>
              ) : null}
            </div>
          )}
          <p>{session.primaryEmailLabel}</p>
          <span className="sr-only">{copy.signedInAs}</span>
        </div>
        {product.status === "ready" && product.entitlement ? (
          <span className="account-product-status-badge">
            <i aria-hidden />
            <span>{product.entitlement.planName ?? copy.subscription}</span>
            <span aria-hidden>·</span>
            <span>{copy.accountSubscriptionActive}</span>
          </span>
        ) : (
          <span className="account-product-status-badge" data-status="loading">
            <LoaderCircle className="account-spin" aria-hidden />
            <span>{copy.loading}</span>
          </span>
        )}
      </section>
    </>
  );
}

function AccountSecurityOverflowAction({
  controller,
  showLegacyConfiguration,
}: {
  readonly controller: AccountExperienceControllerV1;
  readonly showLegacyConfiguration: boolean;
}) {
  const copy = useAccountExperienceCopyV1();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="account-header-icon-button"
              aria-label={copy.security}
              title={copy.security}
              aria-haspopup="dialog"
              aria-expanded={open}
              disabled={controller.busy}
            >
              <MoreHorizontal size={18} aria-hidden />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent
          className="account-header-action-tooltip"
          side="bottom"
          sideOffset={8}
        >
          {copy.security}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="account-header-popover account-security-overflow-popover"
        align="end"
        sideOffset={8}
      >
        <AccountSecurityPanel
          controller={controller}
          showLegacyConfiguration={showLegacyConfiguration}
        />
      </PopoverContent>
    </Popover>
  );
}

function AccountPasswordAction({
  controller,
}: {
  readonly controller: AccountExperienceControllerV1;
}) {
  const copy = useAccountExperienceCopyV1();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMismatch, setPasswordMismatch] = useState(false);

  useEffect(() => {
    if (open) return;
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordMismatch(false);
  }, [open]);

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordMismatch(true);
      return;
    }
    const current = currentPassword;
    const next = newPassword;
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordMismatch(false);
    void controller.changePassword(current, next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="account-header-icon-button"
              aria-label={copy.passwordChange}
              aria-busy={controller.busy}
              disabled={controller.busy}
            >
              <KeyRound size={18} aria-hidden />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent
          className="account-header-action-tooltip"
          side="bottom"
          sideOffset={8}
        >
          {copy.passwordChange}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="account-header-popover"
        align="end"
        sideOffset={8}
      >
        <form
          className="account-security-form account-security-form--popover"
          onSubmit={submitPassword}
        >
          <label>
            <span>{copy.currentPassword}</span>
            <input
              name="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            <span>{copy.newPassword}</span>
            <input
              name="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>
          <label>
            <span>{copy.confirmNewPassword}</span>
            <input
              name="new-password-confirmation"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>
          {passwordMismatch ? (
            <p className="account-form-error" role="alert">
              {copy.passwordMismatch}
            </p>
          ) : null}
          <button
            type="submit"
            className="account-primary-button"
            disabled={controller.busy}
          >
            {copy.changePasswordAction}
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function AccountHeaderIconAction({
  label,
  busy,
  disabled,
  onClick,
  submit = false,
  children,
}: {
  readonly label: string;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly submit?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type={submit ? "submit" : "button"}
          className="account-header-icon-button"
          aria-label={label}
          aria-busy={busy}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent
        className="account-header-action-tooltip"
        side="bottom"
        sideOffset={8}
      >
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
