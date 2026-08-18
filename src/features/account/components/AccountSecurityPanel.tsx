import { useEffect, useState, type FormEvent } from "react";
import KeyRound from "lucide-react/dist/esm/icons/key-round";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import type { AccountExperienceControllerV1 } from "../hooks/useAccountExperienceController";
import { useAccountExperienceCopyV1 } from "../hooks/useAccountExperienceCopy";
import type { AccountExperienceCopyV1 } from "../locale/accountExperienceCopy";

export type AccountSecurityPanelProps = {
  readonly controller: AccountExperienceControllerV1;
  readonly showLegacyConfiguration: boolean;
};

export function AccountSecurityPanel({
  controller,
  showLegacyConfiguration,
}: AccountSecurityPanelProps) {
  const copy = useAccountExperienceCopyV1();
  const security = controller.profile?.security;
  const [displayName, setDisplayName] = useState(controller.profile?.profile.displayName ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMismatch, setPasswordMismatch] = useState(false);
  const [editor, setEditor] = useState<"profile" | "password" | null>(null);
  const [confirming, setConfirming] = useState<"revokeCredential" | "logoutAll" | null>(null);
  const capabilities = controller.bootstrap?.capabilities.entries;
  const profileEditable = capabilities?.["account.profile"]?.status === "enabled";
  const passwordEditable = capabilities?.["account.passwordChange"]?.status === "enabled";
  const revokeAllEnabled = capabilities?.["account.revokeAllSessions"]?.status === "enabled";
  const profileDisplayName = controller.profile?.profile.displayName ?? null;

  useEffect(() => {
    if (editor === null && profileDisplayName) setDisplayName(profileDisplayName);
  }, [editor, profileDisplayName]);

  const submitProfile = (event: FormEvent) => {
    event.preventDefault();
    void controller.updateProfile(displayName);
  };
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
    <div className="account-security-panel">
      <dl className="account-security-list">
        <div><dt><ShieldCheck aria-hidden />{copy.totp}</dt><dd>{security?.totp === "enabled" ? copy.enabled : copy.disabled}</dd></div>
        <div><dt><KeyRound aria-hidden />{copy.passwordChange}</dt><dd>{security?.passwordChange === "available" ? copy.available : "—"}</dd></div>
        <div><dt>{copy.identityBindings}</dt><dd>{formatIdentityBindingsV1(security?.identityBindings.map((binding) => binding.provider) ?? [], copy) || "—"}</dd></div>
        {showLegacyConfiguration ? <div><dt><KeyRound aria-hidden />{copy.codexCredential}</dt><dd>{controller.configuration.managedKeyReady ? copy.enabled : copy.disabled}</dd></div> : null}
      </dl>
      {showLegacyConfiguration && controller.configuration.managedKeyReady ? (
        <div className="account-security-actions">
          <button type="button" onClick={() => void controller.changeManagedKey()} disabled={controller.busy}>{copy.rotateCredential}</button>
          <button type="button" className="account-danger-button" onClick={() => setConfirming("revokeCredential")} disabled={controller.busy}>{copy.revokeCredential}</button>
        </div>
      ) : null}
      <div className="account-security-editor-actions">
        {profileEditable ? (
          <button type="button" onClick={() => setEditor(editor === "profile" ? null : "profile")} aria-expanded={editor === "profile"}>
            {copy.editProfile}
          </button>
        ) : null}
        {passwordEditable ? (
          <button type="button" onClick={() => setEditor(editor === "password" ? null : "password")} aria-expanded={editor === "password"}>
            {copy.passwordChange}
          </button>
        ) : null}
      </div>
      {profileEditable && editor === "profile" ? (
        <form className="account-security-form" onSubmit={submitProfile}>
          <h4>{copy.profile}</h4>
          <label><span>{copy.displayName}</span><input name="display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="off" maxLength={80} required /></label>
          <button type="submit" disabled={controller.busy}>{copy.saveProfile}</button>
        </form>
      ) : null}
      {passwordEditable && editor === "password" ? (
        <form className="account-security-form" onSubmit={submitPassword}>
          <h4>{copy.passwordChange}</h4>
          <label><span>{copy.currentPassword}</span><input name="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></label>
          <label><span>{copy.newPassword}</span><input name="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={6} required /></label>
          <label><span>{copy.confirmNewPassword}</span><input name="new-password-confirmation" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={6} required /></label>
          {passwordMismatch ? <p className="account-form-error" role="alert">{copy.passwordMismatch}</p> : null}
          <button type="submit" disabled={controller.busy}>{copy.changePasswordAction}</button>
        </form>
      ) : null}
      {controller.securityNotice === "profileUpdated" ? <p className="account-form-notice" role="status">{copy.profileUpdated}</p> : null}
      {revokeAllEnabled ? (
        <button type="button" className="account-danger-button" onClick={() => setConfirming("logoutAll")}>{copy.logoutAll}</button>
      ) : null}
      <ConfirmDialog
        open={confirming !== null}
        title={confirming === "revokeCredential" ? copy.revokeCredentialConfirmTitle : copy.logoutAllConfirmTitle}
        body={confirming === "revokeCredential" ? copy.revokeCredentialConfirmBody : copy.logoutAllConfirmBody}
        confirmText={confirming === "revokeCredential" ? copy.confirmRevokeCredential : copy.confirmLogoutAll}
        cancelText={copy.cancel}
        danger
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const action = confirming;
          setConfirming(null);
          if (action === "revokeCredential") void controller.revokeManagedKey();
          if (action === "logoutAll") void controller.logout("allSessions");
        }}
      />
    </div>
  );
}

function formatIdentityBindingsV1(
  providers: readonly string[],
  copy: AccountExperienceCopyV1,
): string {
  const labels: Readonly<Record<string, string>> = {
    github: copy.identityProviderGithub,
    google: copy.identityProviderGoogle,
    linuxdo: copy.identityProviderLinuxDo,
    wechat: copy.identityProviderWechat,
    oidc: copy.identityProviderOidc,
    dingtalk: copy.identityProviderDingtalk,
  };
  return providers
    .map((provider) => provider.replace("auth.oauth.", ""))
    .map((provider) => labels[provider] ?? provider)
    .join(copy.identityBindingsSeparator);
}
