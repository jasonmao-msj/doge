import { useEffect, useRef, useState, type FormEvent } from "react";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import Github from "lucide-react/dist/esm/icons/github";
import KeyRound from "lucide-react/dist/esm/icons/key-round";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import X from "lucide-react/dist/esm/icons/x";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../../../components/ui/tabs";
import type {
  SafePresentedValueV1,
  StaticRedactedSafePresentedValueV1,
} from "../contracts";
import {
  useAccountExperienceControllerV1,
  type AccountExperienceControllerV1,
} from "../hooks/useAccountExperienceController";
import {
  useAccountExperienceCopyV1,
} from "../hooks/useAccountExperienceCopy";
import { openTokenMatrixApiKeysV1 } from "../runtime/tokenMatrixLinks";
import { AccountHelpTooltip } from "./AccountHelpTooltip";
import { AccountCenter } from "./AccountCenter";
import "./account-experience.css";
import "./account-configuration-dialog.css";

export type AccountExperienceProps = {
  /** Test/migration-only access to the superseded manual API-key configuration flow. */
  readonly showLegacyConfiguration?: boolean;
};

export function AccountExperience({ showLegacyConfiguration = false }: AccountExperienceProps) {
  const controller = useAccountExperienceControllerV1({
    loadLegacyConfigurationExtras: showLegacyConfiguration,
  });
  const copy = useAccountExperienceCopyV1();

  if (controller.loading) {
    return (
      <div className="account-experience" data-testid="account-experience">
        <div className="account-experience-state" role="status">{copy.loading}</div>
      </div>
    );
  }

  if (controller.bootstrap === null) {
    return (
      <div className="account-experience" data-testid="account-experience">
        <AccountUnavailableState controller={controller} />
      </div>
    );
  }

  const signedIn = controller.bootstrap.session.status === "authenticated";
  return (
    <div
      className={`account-experience${signedIn ? " account-experience--authenticated" : ""}`}
      data-testid="account-experience"
    >
      {signedIn
        ? <AccountCenter controller={controller} showLegacyConfiguration={showLegacyConfiguration} />
        : <AccountAuthPanel controller={controller} />}

      {controller.securityNotice === "passwordChanged" ? (
        <p className="account-form-notice account-form-notice--standalone" role="status">
          {copy.passwordChanged}
        </p>
      ) : null}

      {controller.failure ? (
        <div className="account-safe-failure" role="alert">
          <CircleAlert size={16} aria-hidden />
          <span>{copy.safeFailure}</span>
        </div>
      ) : null}

      {showLegacyConfiguration ? <ConfigurationAssistant controller={controller} /> : null}
    </div>
  );
}

function AccountUnavailableState({
  controller,
}: {
  readonly controller: AccountExperienceControllerV1;
}) {
  const copy = useAccountExperienceCopyV1();
  const retryLabel = controller.bootstrapRetrying
    ? copy.retrying
    : controller.bootstrapRetryCompleted
      ? copy.retryAgain
      : copy.retry;

  return (
    <div
      className="account-experience-state account-experience-state--warning"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <CircleAlert className="account-unavailable-icon" aria-hidden />
      <div className="account-title-with-help account-unavailable-heading">
        <span className="account-unavailable-title">{copy.unavailableTitle}</span>
        <AccountHelpTooltip label={`${copy.help}：${copy.unavailableTitle}`}>
          {copy.unavailableBody}
        </AccountHelpTooltip>
      </div>
      <button
        type="button"
        className="account-retry-button"
        onClick={() => void controller.retry()}
        disabled={controller.bootstrapRetrying}
        aria-busy={controller.bootstrapRetrying}
      >
        {controller.bootstrapRetrying ? (
          <RefreshCw className="account-spin" size={14} aria-hidden />
        ) : null}
        <span>{retryLabel}</span>
      </button>
    </div>
  );
}

export function AccountAuthPanel({ controller }: { readonly controller: AccountExperienceControllerV1 }) {
  const copy = useAccountExperienceCopyV1();
  const setAuthSurface = controller.setAuthSurface;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMismatch, setPasswordMismatch] = useState(false);
  const [code, setCode] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [oauthEmail, setOauthEmail] = useState("");
  const [oauthInvitation, setOauthInvitation] = useState("");
  const [oauthMfaCode, setOauthMfaCode] = useState("");
  const [oauthBindConfirmed, setOauthBindConfirmed] = useState(false);
  const isCodeSurface = controller.authSurface === "verification" || controller.authSurface === "mfa";
  const capabilityEntries = controller.bootstrap?.capabilities.entries;
  const loginEnabled = capabilityEntries?.["auth.emailPasswordLogin"]?.status === "enabled";
  const registrationEnabled = capabilityEntries?.["auth.registration"]?.status === "enabled";
  const recoveryEnabled = capabilityEntries?.["auth.passwordReset"]?.status === "enabled";
  const githubEnabled = capabilityEntries?.["auth.oauth.github"]?.status === "enabled";
  const authTabs = ([
    loginEnabled || githubEnabled ? "login" : null,
    registrationEnabled ? "register" : null,
  ] as const).filter((surface): surface is "login" | "register" => surface !== null);
  const registrationPolicy = controller.bootstrap?.capabilities.registration;
  const selectedTabAvailable = authTabs.includes(
    controller.authSurface as "login" | "register",
  );
  const recoverySurfaceAvailable =
    controller.authSurface === "recover" && recoveryEnabled;

  useEffect(() => {
    if (isCodeSurface || controller.authSurface === "oauthWaiting" ||
      controller.authSurface === "oauthAccountCompletion" ||
      controller.authSurface === "resetRequested" ||
      controller.authSurface === "resetPassword" || selectedTabAvailable ||
      recoverySurfaceAvailable
    ) {
      return;
    }
    const firstAvailable = authTabs[0] ?? (recoveryEnabled ? "recover" : null);
    if (firstAvailable) setAuthSurface(firstAvailable);
  }, [
    authTabs,
    controller.authSurface,
    setAuthSurface,
    isCodeSurface,
    recoveryEnabled,
    recoverySurfaceAvailable,
    selectedTabAvailable,
  ]);

  const submitCredentials = (event: FormEvent) => {
    event.preventDefault();
    const transientPassword = password;
    setPassword("");
    if (controller.authSurface === "login") void controller.login(email, transientPassword);
    if (controller.authSurface === "register") {
      const transientInvitation = invitationCode;
      setInvitationCode("");
      void controller.register(email, transientPassword, {
        ...(transientInvitation ? { invitationCode: transientInvitation } : {}),
        ...(promoCode ? { promoCode } : {}),
        agreementAccepted: !registrationPolicy?.agreementRequired || agreementAccepted,
      });
    }
    if (controller.authSurface === "recover") void controller.requestPasswordReset(email);
  };

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    const transientCode = code;
    setCode("");
    controller.submitCode(transientCode);
  };

  const submitPasswordReset = (event: FormEvent) => {
    event.preventDefault();
    const transientPassword = newPassword;
    const matches = transientPassword === confirmPassword;
    setNewPassword("");
    setConfirmPassword("");
    setPasswordMismatch(!matches);
    if (matches) void controller.resetPassword(transientPassword);
  };

  const submitOAuthCompletion = (event: FormEvent) => {
    event.preventDefault();
    const transientInvitation = oauthInvitation;
    const transientMfa = oauthMfaCode;
    setOauthInvitation("");
    setOauthMfaCode("");
    controller.completeOAuthAccount({
      ...(oauthEmail ? { email: oauthEmail } : {}),
      ...(transientInvitation ? { invitationCode: transientInvitation } : {}),
      ...(transientMfa ? { mfaCode: transientMfa } : {}),
      ...(oauthRequirements.includes("bindConfirmation")
        ? { bindConfirmed: oauthBindConfirmed }
        : {}),
    });
  };

  const oauthRequirements = controller.authNext?.next === "oauthAccountCompletion"
    ? controller.authNext.requirements
    : [];

  return (
    <section className="account-auth-shell" aria-labelledby="account-auth-title">
      <h2 id="account-auth-title" className="sr-only">{copy.accountTitle}</h2>

      {controller.authSurface === "oauthWaiting" ? (
        <div className="account-auth-focused-state">
          <RefreshCw className="account-spin" aria-hidden />
          <div className="account-title-with-help">
            <h3>{copy.oauthWaitingTitle}</h3>
            <AccountHelpTooltip label={`${copy.help}：${copy.oauthWaitingTitle}`}>
              {copy.oauthWaitingBody}
            </AccountHelpTooltip>
          </div>
          <div className="account-inline-actions">
            <button type="button" className="account-primary-button" onClick={() => void controller.checkOAuth()} disabled={controller.busy}>
              {copy.checkOAuth}
            </button>
            <button type="button" onClick={() => void controller.cancelOAuth()}>{copy.cancel}</button>
          </div>
        </div>
      ) : controller.authSurface === "oauthAccountCompletion" ? (
        <form className="account-auth-form" onSubmit={submitOAuthCompletion}>
          <div className="account-title-with-help">
            <h3>{copy.oauthCompletionTitle}</h3>
            <AccountHelpTooltip label={`${copy.help}：${copy.oauthCompletionTitle}`}>
              {copy.oauthCompletionBody}
            </AccountHelpTooltip>
          </div>
          {oauthRequirements.includes("email") ? (
            <label>
              <span>{copy.email}</span>
              <input name="oauth-email" type="email" value={oauthEmail} onChange={(event) => setOauthEmail(event.target.value)} autoComplete="email" spellCheck={false} required />
            </label>
          ) : null}
          {oauthRequirements.includes("invitation") ? (
            <label>
              <span>{copy.invitationCode}</span>
              <input name="oauth-invitation-code" type="password" value={oauthInvitation} onChange={(event) => setOauthInvitation(event.target.value)} autoComplete="off" spellCheck={false} required />
            </label>
          ) : null}
          {oauthRequirements.includes("mfa") ? (
            <label>
              <span>{copy.code}</span>
              <input name="oauth-mfa-code" value={oauthMfaCode} onChange={(event) => setOauthMfaCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" spellCheck={false} required />
            </label>
          ) : null}
          {oauthRequirements.includes("bindConfirmation") ? (
            <label className="account-checkbox-label">
              <input type="checkbox" checked={oauthBindConfirmed} onChange={(event) => setOauthBindConfirmed(event.target.checked)} required />
              <span>{copy.oauthBindConfirmation}</span>
            </label>
          ) : null}
          <button className="account-primary-button" type="submit" disabled={controller.busy}>
            {copy.continue}
          </button>
          <button type="button" onClick={() => void controller.cancelOAuth()}>{copy.cancel}</button>
        </form>
      ) : controller.authSurface === "resetRequested" ? (
        <div className="account-auth-focused-state">
          <Check aria-hidden />
          <h3>{copy.resetRequestedTitle}</h3>
          <AccountHelpTooltip label={`${copy.help}：${copy.resetRequestedTitle}`}>
            {copy.resetRequestedBody}
          </AccountHelpTooltip>
          {controller.retryPasswordReset ? (
            <button type="button" className="account-primary-button" onClick={controller.retryPasswordReset} disabled={controller.busy}>
              {copy.retryResetLink}
            </button>
          ) : null}
          <button type="button" onClick={controller.cancelPasswordReset}>{copy.login}</button>
        </div>
      ) : controller.authSurface === "resetPassword" ? (
        <form className="account-auth-form" onSubmit={submitPasswordReset}>
          <div className="account-title-with-help">
            <h3>{copy.resetPasswordTitle}</h3>
            <AccountHelpTooltip label={`${copy.help}：${copy.resetPasswordTitle}`}>
              {copy.resetPasswordBody}
            </AccountHelpTooltip>
          </div>
          <label>
            <span>{copy.newPassword}</span>
            <input
              name="reset-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              required
              autoFocus
            />
          </label>
          <label>
            <span>{copy.confirmNewPassword}</span>
            <input
              name="reset-password-confirmation"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
          {passwordMismatch ? (
            <p className="account-form-notice" role="alert">{copy.passwordMismatch}</p>
          ) : null}
          <button className="account-primary-button" type="submit" disabled={controller.busy}>
            {copy.resetPasswordAction}
          </button>
          <button type="button" onClick={controller.cancelPasswordReset}>{copy.cancel}</button>
        </form>
      ) : isCodeSurface ? (
        <form className="account-auth-form" onSubmit={submitCode}>
          <div className="account-title-with-help">
            <h3>{controller.authSurface === "mfa" ? copy.mfaTitle : copy.verificationTitle}</h3>
            <AccountHelpTooltip label={`${copy.help}：${controller.authSurface === "mfa" ? copy.mfaTitle : copy.verificationTitle}`}>
              {controller.authSurface === "mfa" ? copy.mfaBody : copy.verificationBody}
            </AccountHelpTooltip>
          </div>
          <label>
            <span>{copy.code}</span>
            <input name="verification-code" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" spellCheck={false} required autoFocus />
          </label>
          <button className="account-primary-button" type="submit" disabled={controller.busy || code.length === 0}>{copy.verify}</button>
          {controller.authSurface === "verification" ? (
            <button type="button" onClick={controller.resendRegistrationCode} disabled={controller.busy}>{copy.resend}</button>
          ) : null}
        </form>
      ) : recoverySurfaceAvailable ? (
        <form className="account-auth-form" onSubmit={submitCredentials}>
          <h3>{copy.recover}</h3>
          <label>
            <span>{copy.email}</span>
            <input
              name="recovery-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              spellCheck={false}
              required
              autoFocus
            />
          </label>
          <button className="account-primary-button" type="submit" disabled={controller.busy}>
            {copy.sendReset}
          </button>
          <button type="button" onClick={() => controller.setAuthSurface("login")}>
            {copy.login}
          </button>
        </form>
      ) : authTabs.length === 0 ? (
        <AccountUnavailableState controller={controller} />
      ) : !selectedTabAvailable ? (
        <div className="account-experience-state" role="status">{copy.loading}</div>
      ) : (
        <>
          <Tabs value={controller.authSurface} onValueChange={(value) => {
            if (value === "login" || value === "register") controller.setAuthSurface(value);
          }}>
            <TabsList className="account-auth-tabs" aria-label={copy.accountTitle}>
              {authTabs.map((surface) => (
                <TabsTab
                  value={surface}
                  key={surface}
                  onClick={() => controller.setAuthSurface(surface)}
                >
                  {surface === "login" ? copy.login : copy.register}
                </TabsTab>
              ))}
            </TabsList>
            <TabsPanel value={controller.authSurface} forceMount className="account-auth-tab-panel">
            {controller.authSurface !== "login" || loginEnabled ? (
            <form className="account-auth-form" onSubmit={submitCredentials}>
            <label>
              <span>{copy.email}</span>
              <input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" spellCheck={false} required />
            </label>
            <label>
              <span>{copy.password}</span>
              <input name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={controller.authSurface === "register" ? "new-password" : "current-password"} required />
            </label>
            {controller.authSurface === "register" && registrationPolicy?.invitationCode !== "hidden" ? (
              <label>
                <span>{copy.invitationCode}</span>
                <input name="invitation-code" type="password" value={invitationCode} onChange={(event) => setInvitationCode(event.target.value)} autoComplete="off" spellCheck={false} required={registrationPolicy?.invitationCode === "required"} />
              </label>
            ) : null}
            {controller.authSurface === "register" && registrationPolicy?.promoCode !== "hidden" ? (
              <label>
                <span>{copy.promoCode}</span>
                <input name="promo-code" value={promoCode} onChange={(event) => setPromoCode(event.target.value)} autoComplete="off" spellCheck={false} />
              </label>
            ) : null}
            {controller.authSurface === "register" && registrationPolicy?.agreementRequired ? (
              <label className="account-checkbox-label">
                <input type="checkbox" checked={agreementAccepted} onChange={(event) => setAgreementAccepted(event.target.checked)} required />
                <span>{copy.agreement}</span>
              </label>
            ) : null}
            <button className="account-primary-button" type="submit" disabled={controller.busy}>
              {controller.authSurface === "login" ? copy.submitLogin : copy.submitRegister}
            </button>
            </form>
            ) : null}
            {controller.authSurface === "login" && recoveryEnabled ? (
              <button
                type="button"
                className="account-auth-recovery-link"
                onClick={() => controller.setAuthSurface("recover")}
              >
                {copy.recover}
              </button>
            ) : null}
            {controller.authSurface === "login" && githubEnabled ? (
              <div className="account-oauth-row">
                <span>{copy.oauthDivider}</span>
                <button type="button" onClick={() => void controller.startOAuth()} disabled={controller.busy}>
                  <Github size={16} aria-hidden />{copy.github}
                </button>
              </div>
            ) : null}
            </TabsPanel>
          </Tabs>
        </>
      )}
    </section>
  );
}

function ConfigurationAssistant({ controller }: { readonly controller: AccountExperienceControllerV1 }) {
  const copy = useAccountExperienceCopyV1();
  const state = controller.configuration;
  const ordinaryCloseRef = useRef<HTMLButtonElement>(null);
  if (!state.open && !state.bubbleVisible) return null;
  const title = state.result
    ? resultTitleV1(state.result.overall, copy)
    : state.plan
      ? copy.configureTitle
      : copy.selectApiKeyTitle;
  return (
    <Dialog open={state.open} onOpenChange={(open) => { if (!open) controller.closeConfiguration(); }}>
      <DialogContent
        className="account-config-dialog"
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          ordinaryCloseRef.current?.focus();
        }}
      >
        <DialogHeader className="account-config-header">
          <div className="account-config-heading">
            <DialogTitle>
              {title}
            </DialogTitle>
            <AccountHelpTooltip label={`${copy.help}：${title}`} side="bottom">
              {state.result
                ? resultHelpV1(state.result.overall, copy)
                : state.plan
                  ? copy.configureBody
                  : copy.selectApiKeyHelp}
            </AccountHelpTooltip>
          </div>
          <button type="button" className="account-icon-button" onClick={controller.closeConfiguration} aria-label={copy.close}>
            <X aria-hidden />
          </button>
        </DialogHeader>
        <div className="account-config-body">
          {state.result
            ? <ConfigurationResult controller={controller} />
            : state.plan
              ? <ConfigurationPlan controller={controller} />
              : <ApiKeySelection controller={controller} />}
        </div>
        <DialogFooter className="account-config-footer">
          <button ref={ordinaryCloseRef} type="button" onClick={controller.closeConfiguration}>{copy.ordinaryClose}</button>
          {state.result ? (
            <button type="button" className="account-primary-button" onClick={() => void controller.acknowledgeConfiguration()}>{copy.acknowledged}</button>
          ) : state.plan ? (
            <button type="button" className="account-primary-button" disabled={state.applying || state.plan.summary !== "changesPlanned"} onClick={() => void controller.applyConfiguration()}>{state.applying ? copy.configuring : copy.agreeAndConfigure}</button>
          ) : state.selectedKey ? (
            <button
              type="button"
              className="account-primary-button"
              disabled={controller.busy || state.selectingKey}
              onClick={() => void controller.selectConfigurationKey(state.selectedKey!)}
            >
              {state.selectingKey ? copy.selectingApiKey : copy.useSelectedApiKey}
            </button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApiKeySelection({ controller }: { readonly controller: AccountExperienceControllerV1 }) {
  const copy = useAccountExperienceCopyV1();
  const state = controller.configuration;
  const candidates = state.keyCandidates?.keys ?? [];
  const hasSelectableCandidate = candidates.some((candidate) =>
    candidate.status === "active" && candidate.availability === "selectable");

  if (state.loadingKeys && state.keyCandidates === null) {
    return (
      <div className="account-api-key-loading" role="status">
        <RefreshCw className="account-spin" aria-hidden />
        <span>{copy.loadingApiKeys}</span>
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="account-api-key-empty">
        <KeyRound aria-hidden />
        <div className="account-inline-actions">
          <button
            type="button"
            className="account-primary-button"
            onClick={() => void openTokenMatrixApiKeysV1()}
          >
            {copy.openTokenMatrix}<ExternalLink size={14} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => void controller.loadApiKeyCandidates()}
            disabled={state.loadingKeys}
          >
            <RefreshCw size={14} className={state.loadingKeys ? "account-spin" : ""} aria-hidden />
            {copy.refreshApiKeys}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="account-api-key-selection">
      <div className="account-api-key-toolbar">
        <span>API Key</span>
        <button
          type="button"
          onClick={() => void controller.loadApiKeyCandidates()}
          disabled={state.loadingKeys || state.selectingKey}
          aria-label={copy.refreshApiKeys}
        >
          <RefreshCw size={14} className={state.loadingKeys ? "account-spin" : ""} aria-hidden />
        </button>
      </div>
      <div className="account-api-key-list" role="radiogroup" aria-label={copy.selectApiKeyTitle}>
        {candidates.map((candidate) => {
          const selectable = candidate.status === "active" &&
            candidate.availability === "selectable";
          const selected = state.selectedKey === candidate.key;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              className={selected ? "is-selected" : undefined}
              key={candidate.key}
              disabled={!selectable || state.selectingKey}
              onClick={() => controller.chooseConfigurationKey(candidate.key)}
            >
              <span className="account-api-key-radio" aria-hidden />
              <span>
                <strong>{candidate.name}</strong>
                <small>{candidate.maskedPrefix}</small>
              </span>
              {!selectable ? <small>{copy.apiKeyUnavailable}</small> : null}
            </button>
          );
        })}
      </div>
      {!hasSelectableCandidate ? (
        <div className="account-inline-actions account-api-key-unavailable-actions">
          <button
            type="button"
            className="account-primary-button"
            onClick={() => void openTokenMatrixApiKeysV1()}
          >
            {copy.openTokenMatrix}<ExternalLink size={14} aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ConfigurationPlan({ controller }: { readonly controller: AccountExperienceControllerV1 }) {
  const copy = useAccountExperienceCopyV1();
  const plan = controller.configuration.plan;
  if (!plan) return null;
  if (plan.summary === "noop") return <p className="account-empty-state">{copy.noChanges}</p>;
  return (
    <div className="account-config-plan">
      <div className="account-title-with-help">
        <h3>{copy.changedFiles}</h3>
        <AccountHelpTooltip label={`${copy.help}：${copy.changedFiles}`}>
          {copy.configureBody}
        </AccountHelpTooltip>
      </div>
      <ul>
        {plan.files.map((file) => {
          const expanded = controller.configuration.expandedFile === file.file;
          return (
            <li key={file.file}>
              <button type="button" onClick={() => void controller.toggleFileDetail(file.file)}>
                <span>
                  <Check aria-hidden />
                  <strong>{semanticLabelV1(file.targetLabel, copy)}</strong>
                  {file.outcome === "unchanged" ? <small>{copy.fileUnchanged}</small> : null}
                </span>
                <span>{expanded ? copy.collapseDiff : copy.expandDiff}{expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}</span>
              </button>
              {expanded ? <SafeFileDetail controller={controller} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SafeFileDetail({ controller }: { readonly controller: AccountExperienceControllerV1 }) {
  const copy = useAccountExperienceCopyV1();
  const detail = controller.configuration.fileDetail;
  if (controller.configuration.loadingDetail) return <div className="account-file-detail">{copy.loadingDiff}</div>;
  if (!detail) return null;
  return (
    <div className="account-file-detail">
      {detail.sections.map((section) => (
        <section key={section.label}>
          <h4>{semanticLabelV1(section.label, copy)}</h4>
          {section.entries.map((entry) => (
            <div className="account-diff-entry" key={`${entry.fieldLabel}-${entry.kind}`}>
              <strong>{semanticLabelV1(entry.fieldLabel, copy)}</strong>
              <dl><div><dt>{copy.before}</dt><dd>{presentSafeValueV1(entry.before, copy)}</dd></div><div><dt>{copy.after}</dt><dd>{presentSafeValueV1(entry.after, copy)}</dd></div></dl>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function ConfigurationResult({ controller }: { readonly controller: AccountExperienceControllerV1 }) {
  const copy = useAccountExperienceCopyV1();
  const result = controller.configuration.result;
  if (!result) return null;
  return (
    <div className="account-config-result">
      <ul>{result.files.map((file) => <li key={file.targetLabel}><span>{semanticLabelV1(file.targetLabel, copy)}</span><strong>{fileOutcomeV1(file.outcome, copy)}</strong></li>)}</ul>
    </div>
  );
}

function presentSafeValueV1(
  value: SafePresentedValueV1 | StaticRedactedSafePresentedValueV1,
  copy: ReturnType<typeof useAccountExperienceCopyV1>,
): string {
  switch (value.kind) {
    case "absent": return "—";
    case "boolean": return value.value ? "true" : "false";
    case "number": return String(value.value);
    case "enum": return value.label;
    case "safeText": return value.text;
    case "redacted": return value.label === "managedCredential" ? copy.storedInVault : copy.redacted;
  }
}

function semanticLabelV1(
  value: string,
  copy: ReturnType<typeof useAccountExperienceCopyV1>,
): string {
  const labels: Readonly<Record<string, string>> = {
    "Planned changes": copy.plannedChanges,
    Provider: copy.providerField,
    Selection: copy.selectionField,
    "Managed credential": copy.managedCredentialField,
    Endpoint: copy.endpointField,
    Protocol: copy.protocolField,
    Model: copy.modelField,
    "Codex settings": copy.codexSettingsFile,
    "Doge provider registry": copy.dogeProviderRegistryFile,
  };
  return labels[value] ?? value;
}

function resultTitleV1(overall: string, copy: ReturnType<typeof useAccountExperienceCopyV1>): string {
  if (overall === "applied" || overall === "unchanged") return copy.configuredTitle;
  if (overall === "rollbackIncomplete") return copy.attentionTitle;
  return copy.rollbackTitle;
}

function resultHelpV1(overall: string, copy: ReturnType<typeof useAccountExperienceCopyV1>): string {
  if (overall === "applied" || overall === "unchanged") return copy.configuredBody;
  if (overall === "rollbackIncomplete") return copy.attentionBody;
  return copy.rollbackBody;
}

function fileOutcomeV1(outcome: string, copy: ReturnType<typeof useAccountExperienceCopyV1>): string {
  if (outcome === "applied") return copy.fileApplied;
  if (outcome === "unchanged") return copy.fileUnchanged;
  if (outcome === "rolledBack") return copy.fileRolledBack;
  return copy.fileFailed;
}
