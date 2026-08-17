import { useEffect, useState, type ReactNode } from "react";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import X from "lucide-react/dist/esm/icons/x";
import QRCode from "qrcode";
import dogeMascot from "../../../assets/brand/doge-mascot-avatar.png";
import type { AccountExperienceCopyV1 } from "../locale/accountExperienceCopy";
import type {
  PaymentMethodViewV1,
  SubscriptionPlanViewV1,
} from "../runtime/engineOnboardingClient";
import { AccountHelpTooltip } from "./AccountHelpTooltip";

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
}: {
  readonly children: ReactNode;
  readonly accountExit?: GateAccountExit;
  readonly onReturnToApp?: () => void;
  readonly returnBusy?: boolean;
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
        <img className="account-gate-logo" src={dogeMascot} alt="Doge" />
        {children}
        {accountExit?.failureCode ? (
          <GateInlineFailure copy={accountExit.copy} code={accountExit.failureCode} />
        ) : null}
      </section>
    </main>
  );
}

export function GateHeading({ copy, title, help }: {
  readonly copy: AccountExperienceCopyV1;
  readonly title: string;
  readonly help: string;
}) {
  return (
    <header className="account-gate-heading">
      <h1>{title}</h1>
      <AccountHelpTooltip label={`${title}${copy.gateHelpSuffix}`} side="bottom">
        {help}
      </AccountHelpTooltip>
    </header>
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
  accountExit,
  onReturnToApp,
  returnBusy,
}: {
  readonly copy: AccountExperienceCopyV1;
  readonly code: string;
  readonly onRetry: () => void;
  readonly accountExit?: GateAccountExit;
  readonly onReturnToApp?: () => void;
  readonly returnBusy?: boolean;
}) {
  return (
    <GateFrame accountExit={accountExit} onReturnToApp={onReturnToApp} returnBusy={returnBusy}>
      <GateFailureBody copy={copy} code={code} onRetry={onRetry} />
    </GateFrame>
  );
}

export function GateFailureBody({ copy, code, onRetry }: {
  readonly copy: AccountExperienceCopyV1;
  readonly code: string;
  readonly onRetry: () => void;
}) {
  return (
    <div className="account-gate-centered" role="alert">
      <CircleAlert aria-hidden />
      <h1>{failureMessage(code, copy)}</h1>
      <button className="account-gate-primary" type="button" onClick={onRetry}>
        <RefreshCw size={16} aria-hidden />
        {copy.retry}
      </button>
    </div>
  );
}

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

export function GateStepBack({ copy, onClick }: {
  readonly copy: AccountExperienceCopyV1;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" className="account-gate-back" onClick={onClick} aria-label={copy.gateBack}>
      <ArrowLeft aria-hidden />
    </button>
  );
}

export function GateEmptyPlans({ copy, onRetry }: {
  readonly copy: AccountExperienceCopyV1;
  readonly onRetry: () => void;
}) {
  return (
    <div className="account-gate-centered">
      <CircleAlert aria-hidden />
      <h2>{copy.gateNoPlans}</h2>
      <button type="button" className="account-gate-secondary" onClick={onRetry}>
        {copy.gateRefresh}
      </button>
    </div>
  );
}

export function GateToolchainChoice({
  copy,
  engineName,
  bundledVersion,
  externalVersion,
  onUseBundled,
  onKeepExternal,
}: {
  readonly copy: AccountExperienceCopyV1;
  readonly engineName: string;
  readonly bundledVersion: string;
  readonly externalVersion: string;
  readonly onUseBundled: () => void;
  readonly onKeepExternal: () => void;
}) {
  return (
    <div className="account-gate-centered account-gate-version-choice">
      <h1>{interpolate(copy.gateEngineUpdateTitle, "engine", engineName)}</h1>
      <div className="account-gate-version-actions">
        <button className="account-gate-primary" type="button" onClick={onUseBundled}>
          {interpolate(copy.gateUseBundledVersion, "version", bundledVersion)}
        </button>
        <button className="account-gate-secondary" type="button" onClick={onKeepExternal}>
          {interpolate(copy.gateKeepExternalVersion, "version", externalVersion)}
        </button>
      </div>
    </div>
  );
}

export function PlanButton({ copy, plan, onClick }: {
  readonly copy: AccountExperienceCopyV1;
  readonly plan: SubscriptionPlanViewV1;
  readonly onClick: () => void;
}) {
  const limit = plan.monthlyLimitUsd ?? plan.weeklyLimitUsd ?? plan.dailyLimitUsd;
  return (
    <button type="button" className="account-gate-plan" onClick={onClick}>
      <span className="account-gate-plan-main">
        <strong>{plan.name}</strong>
        <small>{plan.features.slice(0, 2).join(" · ")}</small>
      </span>
      <span className="account-gate-plan-price">
        <strong>{formatMoney(plan.price, plan.currency)}</strong>
        <small>{validityLabel(plan, copy)}</small>
      </span>
      {limit !== null ? <span className="account-gate-plan-limit">${limit}</span> : null}
    </button>
  );
}

export function PaymentMethodList({ copy, methods, onSelect }: {
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

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`.trim();
  }
}

function validityLabel(plan: SubscriptionPlanViewV1, copy: AccountExperienceCopyV1) {
  if (plan.validityDays === 30) return copy.gateMonth;
  return interpolate(copy.gateDaysTemplate, "days", String(plan.validityDays));
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
    code === "engineBundleVerificationFailed") return copy.gateEngineUnavailable;
  return copy.gateServiceUnavailable;
}
