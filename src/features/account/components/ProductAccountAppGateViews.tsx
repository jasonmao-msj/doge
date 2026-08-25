import { useEffect, useState, type ReactNode } from "react";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import X from "lucide-react/dist/esm/icons/x";
import QRCode from "qrcode";
import dogeMascot from "../../../assets/brand/doge-mascot-avatar.png";
import type { AccountExperienceCopyV1 } from "../locale/accountExperienceCopy";
import type { PaymentMethodViewV1 } from "../runtime/onboardingTypes";
import "./product-account-app-gate.css";

export type GateAccountExit = {
  readonly copy: AccountExperienceCopyV1;
  readonly busy: boolean;
  readonly failureCode: string | null;
  readonly onLogout: () => void;
};

export function CheckoutQrCode({
  copy,
  value,
}: {
  readonly copy: AccountExperienceCopyV1;
  readonly value: string;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    setImageUrl(null);
    void QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
      color: { dark: "#111111", light: "#ffffff" },
    }).then((url) => {
      if (!disposed) setImageUrl(url);
    }).catch(() => {
      if (!disposed) setImageUrl("");
    });
    return () => { disposed = true; };
  }, [value]);
  if (imageUrl === null) {
    return <LoaderCircle className="account-gate-spin" aria-label={copy.gateQrGenerating} />;
  }
  if (imageUrl === "") {
    return <GateInlineFailure copy={copy} code="checkoutQrUnavailable" />;
  }
  return <img className="account-gate-qr" src={imageUrl} alt={copy.gateQrAlt} />;
}

export function GateFrame({
  children,
  accountExit,
  onReturnToApp,
  returnBusy = false,
  brandLabel,
}: {
  readonly children: ReactNode;
  readonly accountExit?: GateAccountExit;
  readonly onReturnToApp?: () => void;
  readonly returnBusy?: boolean;
  readonly brandLabel?: string;
}) {
  return (
    <main className="account-app-gate">
      <div className="account-gate-window-drag" data-tauri-drag-region />
      <section className="account-gate-card">
        {onReturnToApp && accountExit ? (
          <button
            className="account-gate-dismiss"
            type="button"
            disabled={returnBusy}
            aria-label={accountExit.copy.gateReturnToApp}
            onClick={onReturnToApp}
          >
            <X aria-hidden />
          </button>
        ) : null}
        {accountExit ? (
          <button
            className="account-gate-logout"
            type="button"
            disabled={accountExit.busy}
            aria-busy={accountExit.busy}
            onClick={accountExit.onLogout}
          >
            {accountExit.copy.logout}
          </button>
        ) : null}
        <div className="account-gate-brand">
          <img
            className="account-gate-logo"
            src={dogeMascot}
            alt={brandLabel ? "" : "Doge"}
            aria-hidden={brandLabel ? true : undefined}
            width={54}
            height={54}
          />
          {brandLabel ? <span>{brandLabel}</span> : null}
        </div>
        {children}
        {accountExit?.failureCode ? (
          <GateInlineFailure copy={accountExit.copy} code={accountExit.failureCode} />
        ) : null}
      </section>
    </main>
  );
}

export function GateLoading({
  label,
  accountExit,
  onReturnToApp,
  returnBusy,
}: {
  readonly label: string;
  readonly accountExit?: GateAccountExit;
  readonly onReturnToApp?: () => void;
  readonly returnBusy?: boolean;
}) {
  return (
    <GateFrame accountExit={accountExit} onReturnToApp={onReturnToApp} returnBusy={returnBusy}>
      <div className="account-gate-centered" role="status">
        <LoaderCircle className="account-gate-spin" aria-hidden />
        <h1>{label}</h1>
      </div>
    </GateFrame>
  );
}

export function GateFailure({
  copy,
  code,
  onRetry,
  retryAfterSeconds,
  accountExit,
  onReturnToApp,
  returnBusy,
}: {
  readonly copy: AccountExperienceCopyV1;
  readonly code: string;
  readonly onRetry: () => void;
  readonly retryAfterSeconds?: number;
  readonly accountExit?: GateAccountExit;
  readonly onReturnToApp?: () => void;
  readonly returnBusy?: boolean;
}) {
  return (
    <GateFrame accountExit={accountExit} onReturnToApp={onReturnToApp} returnBusy={returnBusy}>
      <GateFailureBody
        copy={copy}
        code={code}
        onRetry={onRetry}
        retryAfterSeconds={retryAfterSeconds}
      />
    </GateFrame>
  );
}

function GateFailureBody({
  copy,
  code,
  onRetry,
  retryAfterSeconds = 0,
}: {
  readonly copy: AccountExperienceCopyV1;
  readonly code: string;
  readonly onRetry: () => void;
  readonly retryAfterSeconds?: number;
}) {
  const waiting = retryAfterSeconds > 0;
  return (
    <div className="account-gate-centered" role="alert">
      <CircleAlert aria-hidden />
      <h1>{failureMessage(code, copy)}</h1>
      <button
        className="account-gate-primary"
        type="button"
        disabled={waiting}
        onClick={onRetry}
      >
        <RefreshCw size={16} aria-hidden />
        {waiting
          ? interpolate(copy.gateRetryAfterSecondsTemplate, "seconds", String(retryAfterSeconds))
          : copy.retry}
      </button>
    </div>
  );
}

export { failureMessage as gateFailureMessage };

export function GateInlineFailure({ copy, code }: {
  readonly copy: AccountExperienceCopyV1;
  readonly code: string;
}) {
  return (
    <div className="account-gate-inline-error" role="alert">
      <CircleAlert size={16} aria-hidden />
      {failureMessage(code, copy)}
    </div>
  );
}

export function PaymentMethodList({
  copy,
  methods,
  onSelect,
}: {
  readonly copy: AccountExperienceCopyV1;
  readonly methods: readonly PaymentMethodViewV1[];
  readonly onSelect: (method: PaymentMethodViewV1) => void;
}) {
  if (methods.length === 0) {
    return <GateInlineFailure copy={copy} code="paymentUnavailable" />;
  }
  return (
    <div className="account-gate-methods">
      {methods.map((method) => (
        <button type="button" key={method.id} onClick={() => onSelect(method)}>
          {method.displayName}
        </button>
      ))}
    </div>
  );
}

export function interpolate(template: string, key: string, value: string): string {
  return template.replace(`{${key}}`, value);
}

function failureMessage(code: string, copy: AccountExperienceCopyV1) {
  if (code === "subscriptionRequired") return copy.gateSubscriptionRequired;
  if (code === "planUnavailable") return copy.gatePlanUnavailable;
  if (code === "vaultUnavailable" || code === "vaultLocked") return copy.gateVaultUnavailable;
  if (code === "credentialsRejected") return copy.gateCredentialsRejected;
  if (code === "rateLimited") return copy.gateRateLimited;
  if (code === "checkoutOpenFailed") return copy.gateCheckoutOpenFailed;
  if (code === "paymentUnavailable") return copy.gatePaymentUnavailable;
  if (["configurationRejected", "configurationAccessDenied", "configurationBusy",
    "configurationUnsafeTarget", "concurrentEdit"].includes(code)) {
    return copy.gateConfigurationRejected;
  }
  if (code === "engineUnavailable" || code === "engineBundleUnavailable" ||
    code === "engineBundleVerificationFailed" || code === "engineInstallerUnavailable" ||
    code === "engineInstallFailed" || code === "engineInstallVerificationFailed") {
    return copy.gateEngineUnavailable;
  }
  return copy.gateServiceUnavailable;
}
