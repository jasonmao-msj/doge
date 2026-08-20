import { useState } from "react";
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
  const [confirming, setConfirming] = useState<
    "revokeCredential" | "logoutAll" | null
  >(null);
  const capabilities = controller.bootstrap?.capabilities.entries;
  const revokeAllEnabled =
    capabilities?.["account.revokeAllSessions"]?.status === "enabled";

  return (
    <div className="account-security-panel">
      <dl className="account-security-list">
        <div>
          <dt>
            <ShieldCheck aria-hidden />
            {copy.totp}
          </dt>
          <dd>{security?.totp === "enabled" ? copy.enabled : copy.disabled}</dd>
        </div>
        <div>
          <dt>{copy.identityBindings}</dt>
          <dd>
            {formatIdentityBindingsV1(
              security?.identityBindings.map((binding) => binding.provider) ??
                [],
              copy,
            ) || "—"}
          </dd>
        </div>
        {showLegacyConfiguration ? (
          <div>
            <dt>
              <KeyRound aria-hidden />
              {copy.codexCredential}
            </dt>
            <dd>
              {controller.configuration.managedKeyReady
                ? copy.enabled
                : copy.disabled}
            </dd>
          </div>
        ) : null}
      </dl>
      {showLegacyConfiguration && controller.configuration.managedKeyReady ? (
        <div className="account-security-actions">
          <button
            type="button"
            onClick={() => void controller.changeManagedKey()}
            disabled={controller.busy}
          >
            {copy.rotateCredential}
          </button>
          <button
            type="button"
            className="account-danger-button"
            onClick={() => setConfirming("revokeCredential")}
            disabled={controller.busy}
          >
            {copy.revokeCredential}
          </button>
        </div>
      ) : null}
      {revokeAllEnabled ? (
        <button
          type="button"
          className="account-danger-button"
          onClick={() => setConfirming("logoutAll")}
          disabled={controller.busy}
        >
          {copy.logoutAll}
        </button>
      ) : null}
      <ConfirmDialog
        open={confirming !== null}
        title={
          confirming === "revokeCredential"
            ? copy.revokeCredentialConfirmTitle
            : copy.logoutAllConfirmTitle
        }
        body={
          confirming === "revokeCredential"
            ? copy.revokeCredentialConfirmBody
            : copy.logoutAllConfirmBody
        }
        confirmText={
          confirming === "revokeCredential"
            ? copy.confirmRevokeCredential
            : copy.confirmLogoutAll
        }
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
