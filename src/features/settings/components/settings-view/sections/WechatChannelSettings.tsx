import { useCallback, useEffect, useMemo, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { TFunction } from "i18next";
import QRCode from "qrcode";
import QrCodeIcon from "lucide-react/dist/esm/icons/qr-code";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check";
import { Switch } from "@/components/ui/switch";
import type { AppSettings, WechatChannelSettings } from "@/types";
import {
  getWechatChannel,
  getWechatLoginQrCode,
  getWechatLoginStatus,
  submitWechatLoginVerify,
  testWechatConnection,
  updateWechatChannel,
} from "@/services/tauri";

type Props = {
  t: TFunction;
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
};

const DEFAULT_SETTINGS: WechatChannelSettings = {
  enabled: false,
  bridgeBaseUrl: "",
  webhookHost: "127.0.0.1",
  webhookPort: 18790,
  webhookPath: "/webhook/wechat",
  deviceType: "ipad",
  riskAcknowledged: false,
  workspaceId: null,
  engine: null,
  model: null,
  modelCatalogEntryId: null,
  providerProfileId: null,
};

function statusLabel(t: TFunction, state: string): string {
  const labels: Record<string, string> = {
    unconfigured: t("settings.wechatStatusUnconfigured"),
    loggedout: t("settings.wechatStatusLoggedOut"),
    awaitingconfirmation: t("settings.wechatStatusAwaitingConfirmation"),
    needverification: t("settings.wechatStatusNeedVerification"),
    loggedin: t("settings.wechatStatusLoggedIn"),
    disconnected: t("settings.wechatStatusDisconnected"),
    error: t("settings.wechatStatusError"),
  };
  return labels[state] ?? state;
}

async function createQrImage(value: string): Promise<string> {
  const normalized = value.trim();
  if (!normalized) throw new Error("WeChat QR payload is empty");
  if (normalized.startsWith("data:image/")) return normalized;
  return QRCode.toDataURL(normalized, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
  });
}

export function WechatChannelSettings({
  t,
  appSettings,
  onUpdateAppSettings,
}: Props) {
  const [draft, setDraft] = useState<WechatChannelSettings>(
    appSettings.wechatChannel ?? DEFAULT_SETTINGS,
  );
  const [status, setStatus] = useState(draft.enabled ? null : {
    state: "unconfigured",
    message: t("settings.wechatStatusUnconfigured"),
    listenerRunning: false,
  });
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    return getWechatChannel();
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const view = await refresh();
        if (!active) return;
        setDraft(view.settings);
        setStatus(view.status);

        if (view.settings.enabled && view.status.state !== "loggedin") {
          const qr = await getWechatLoginQrCode();
          const image = await createQrImage(qr.value);
          if (active) setQrCode(image);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    })();
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!draft.enabled) return undefined;
    let active = true;
    const timer = window.setInterval(() => {
      void getWechatLoginStatus()
        .then((nextStatus) => {
          if (active) {
            setStatus(nextStatus);
            if (nextStatus.state === "loggedin") {
              setQrCode(null);
              setVerificationCode("");
            }
          }
        })
        .catch((pollError) => {
          if (active) {
            setError(pollError instanceof Error ? pollError.message : String(pollError));
          }
        });
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [draft.enabled]);

  const save = useCallback(async (
    settings: WechatChannelSettings,
    options: { refreshQr?: boolean } = {},
  ) => {
    setBusy("save");
    setNotice(null);
    setError(null);
    try {
      const view = await updateWechatChannel({ settings });
      setDraft(view.settings);
      setStatus(view.status);
      await onUpdateAppSettings({ ...appSettings, wechatChannel: view.settings });
      if (
        options.refreshQr &&
        settings.enabled &&
        view.status.state !== "loggedin"
      ) {
        const qr = await getWechatLoginQrCode();
        setQrCode(await createQrImage(qr.value));
      } else if (!settings.enabled) {
        setQrCode(null);
        setVerificationCode("");
      }
      setNotice(t("settings.wechatSaved"));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(null);
    }
  }, [appSettings, onUpdateAppSettings, t]);

  const handleEnabledChange = useCallback(async (enabled: boolean) => {
    if (!enabled) {
      const next = { ...draft, enabled: false };
      setDraft(next);
      void save(next);
      return;
    }
    let acknowledged = draft.riskAcknowledged;
    if (!acknowledged) {
      acknowledged = await ask(t("settings.wechatRiskBody"), {
        title: t("settings.wechatRiskTitle"),
        kind: "warning",
        okLabel: t("settings.wechatRiskConfirm"),
        cancelLabel: t("common.cancel"),
      });
    }
    if (!acknowledged) return;
    const next = { ...draft, enabled: true, riskAcknowledged: true };
    setDraft(next);
    void save(next, { refreshQr: true });
  }, [draft, save, t]);

  const handleQr = useCallback(async () => {
    setBusy("qr");
    setError(null);
    try {
      const qr = await getWechatLoginQrCode();
      setQrCode(await createQrImage(qr.value));
      setNotice(t("settings.wechatQrUpdated"));
    } catch (qrError) {
      setError(qrError instanceof Error ? qrError.message : String(qrError));
    } finally {
      setBusy(null);
    }
  }, [t]);

  const handleVerify = useCallback(async () => {
    const code = verificationCode.trim();
    if (!code) return;
    setBusy("verify");
    setNotice(null);
    setError(null);
    try {
      const nextStatus = await submitWechatLoginVerify(code);
      setStatus(nextStatus);
      setVerificationCode("");
      setNotice(t("settings.wechatVerifySubmitted"));
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : String(verifyError));
    } finally {
      setBusy(null);
    }
  }, [t, verificationCode]);

  const handleTest = useCallback(async () => {
    setBusy("test");
    setError(null);
    try {
      setNotice(await testWechatConnection());
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : String(testError));
    } finally {
      setBusy(null);
    }
  }, []);

  const statusText = useMemo(() => {
    if (!status) return t("settings.wechatStatusLoading");
    return `${statusLabel(t, status.state)}: ${status.message}`;
  }, [status, t]);

  return (
    <div className="settings-basic-email settings-basic-surface settings-email-section">
      <div className="settings-pref-card-head settings-email-section-head">
        <div className="settings-pref-title">{t("settings.wechatTitle")}</div>
        <div className="settings-pref-desc">{t("settings.wechatDescription")}</div>
      </div>

      <div className="settings-basic-group-card settings-basic-group-card--list settings-pref-card settings-email-form-card">
        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">{t("settings.wechatEnableTitle")}</div>
            <div className="settings-pref-desc">{t("settings.wechatEnableDescription")}</div>
          </div>
          <Switch
            id="wechat-channel-enabled"
            checked={draft.enabled}
            onCheckedChange={(enabled) => void handleEnabledChange(enabled)}
            disabled={busy !== null}
            aria-label={t("settings.wechatEnableTitle")}
          />
        </div>

        <div className="settings-email-status-banner">{statusText}</div>
        <div className="settings-pref-hint settings-email-action-hint">
          <span className="settings-pref-hint-copy">{t("settings.wechatManagedDescription")}</span>
        </div>

        <div className="settings-email-actions">
          <button type="button" className="settings-web-btn" onClick={() => void handleTest()} disabled={busy !== null || !draft.enabled}>
            {t("settings.wechatTestConnection")}
          </button>
          <button type="button" className="settings-web-btn" onClick={() => void handleQr()} disabled={busy !== null || !draft.enabled}>
            {busy === "qr" ? <RefreshCw size={14} aria-hidden /> : <QrCodeIcon size={14} aria-hidden />}
            {t("settings.wechatRefreshQr")}
          </button>
        </div>

        {qrCode ? <div className="settings-wechat-qr"><img src={qrCode} alt={t("settings.wechatQrAlt")} /></div> : null}
        {status?.state === "needverification" ? (
          <div className="settings-wechat-verify">
            <label htmlFor="wechat-login-verification" className="settings-pref-title">
              {t("settings.wechatVerifyLabel")}
            </label>
            <div className="settings-wechat-verify-controls">
              <input
                id="wechat-login-verification"
                className="settings-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={8}
                value={verificationCode}
                placeholder={t("settings.wechatVerifyPlaceholder")}
                onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ""))}
                disabled={busy !== null}
              />
              <button
                type="button"
                className="settings-web-btn settings-web-btn--primary"
                onClick={() => void handleVerify()}
                disabled={busy !== null || verificationCode.length === 0}
              >
                {busy === "verify" ? t("settings.wechatVerifySubmitting") : t("settings.wechatVerifySubmit")}
              </button>
            </div>
            <div className="settings-pref-desc">{t("settings.wechatVerifyDescription")}</div>
          </div>
        ) : null}
        <div className="settings-pref-hint settings-email-action-hint">
          <ShieldCheck size={15} aria-hidden />
          <span className="settings-pref-hint-copy">{t("settings.wechatRiskHint")}</span>
        </div>
        {notice ? <div className="settings-email-status-banner">{notice}</div> : null}
        {error ? <div className="settings-email-status-banner is-error">{error}</div> : null}
      </div>
    </div>
  );
}
