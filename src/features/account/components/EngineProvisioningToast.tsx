import { useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  dismissProductEngineProvisioningV1,
  readProductEngineProvisioningSnapshotV1,
  retryProductEngineProvisioningV1,
  subscribeProductEngineProvisioningV1,
  type ProductEngineProvisioningPhaseV1,
  type ProductProvisioningEngineIdV1,
} from "../runtime/productEngineProvisioning";

export function EngineProvisioningToast() {
  const { t } = useTranslation();
  const state = useSyncExternalStore(
    subscribeProductEngineProvisioningV1,
    readProductEngineProvisioningSnapshotV1,
    readProductEngineProvisioningSnapshotV1,
  );

  useEffect(() => {
    if (state.phase !== "ready") return;
    const timer = window.setTimeout(dismissProductEngineProvisioningV1, 2_000);
    return () => window.clearTimeout(timer);
  }, [state.phase]);

  if (state.phase === "idle" || !state.engine) return null;
  const busy = state.phase === "installing";
  const engineLabel = productEngineLabel(state.engine);
  const label = phaseLabel(state.phase, t);

  return (
    <div
      className="update-toast engine-provisioning-toast"
      data-phase={state.phase}
      role={state.phase === "error" ? "alert" : "status"}
    >
      <div className="update-toast-header">
        <div className="update-toast-title" translate="no">
          {engineLabel}
        </div>
        {state.phase === "error" ? (
          <button
            type="button"
            className="update-toast-dismiss"
            onClick={dismissProductEngineProvisioningV1}
            aria-label={t("common.dismiss")}
            title={t("common.dismiss")}
          >
            ×
          </button>
        ) : null}
      </div>
      <div className="update-toast-body">{label}</div>
      {busy ? (
        <div className="update-toast-progress" aria-hidden="true">
          <div className="update-toast-progress-bar">
            <span className="update-toast-progress-fill engine-provisioning-progress-indeterminate" />
          </div>
        </div>
      ) : state.phase === "error" && state.retryable ? (
        <div className="update-toast-actions">
          <button
            className="primary"
            onClick={() =>
              void retryProductEngineProvisioningV1().catch(() => undefined)
            }
          >
            {t("common.retry")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function productEngineLabel(engine: ProductProvisioningEngineIdV1): string {
  if (engine === "claude") return "Claude Code";
  if (engine === "kimi") return "Kimi CLI";
  return "Codex";
}

function phaseLabel(
  phase: ProductEngineProvisioningPhaseV1,
  t: (key: string) => string,
): string {
  if (phase === "installing") {
    return t("update.engineProvisioning.installing");
  }
  if (phase === "ready") {
    return t("update.engineProvisioning.ready");
  }
  return t("update.engineProvisioning.failed");
}
