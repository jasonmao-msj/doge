import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  writeGlobalCodexAuthJson,
  writeGlobalCodexConfigToml,
} from "../../../services/tauri";
import { OfficialConfigEditDialog } from "./OfficialConfigEditDialog";
import {
  VendorOfficialConfigCard,
  type VendorManagedConfigurationLock,
} from "./VendorOfficialConfigCard";

interface CurrentCodexGlobalConfigCardProps {
  configLoading: boolean;
  configExists: boolean;
  configContent: string;
  configTruncated: boolean;
  configError: string | null;
  authLoading: boolean;
  authExists: boolean;
  authContent: string;
  authTruncated: boolean;
  authError: string | null;
  /** Whether official (global) config is the active source */
  inUse?: boolean;
  /** Switch back to official / clear managed provider */
  onUse?: () => void;
  /** Leave official active source (clear current when official is active) */
  onCancel?: () => void;
  /** Optional row-title help popover content */
  helpContent?: ReactNode;
  onSaved?: () => void | Promise<void>;
  managedLock?: VendorManagedConfigurationLock;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const SENSITIVE_KEY_PATTERN =
  /(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|password|secret)/i;

function maskSecret(raw: string): string {
  if (!raw) {
    return "";
  }
  const trimmed = raw.trim();
  if (trimmed.length <= 8) {
    return "*".repeat(trimmed.length);
  }
  return `${trimmed.slice(0, 4)}${"*".repeat(8)}${trimmed.slice(-2)}`;
}

function redactAuthValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactAuthValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const output: Record<string, unknown> = {};
  for (const [key, nested] of entries) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = typeof nested === "string" ? maskSecret(nested) : "***";
      continue;
    }
    output[key] = redactAuthValue(nested);
  }
  return output;
}

function redactAuthContent(content: string): string {
  if (!content.trim()) {
    return content;
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    const redacted = redactAuthValue(parsed);
    return JSON.stringify(redacted, null, 2);
  } catch {
    return content.replace(
      /("?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|password|secret)"?\s*:\s*)"([^"]*)"/gi,
      (_match, prefix, value) => `${prefix}"${maskSecret(String(value))}"`,
    );
  }
}

export function CurrentCodexGlobalConfigCard({
  configLoading,
  configExists,
  configContent,
  configTruncated,
  configError,
  authLoading,
  authExists,
  authContent,
  authTruncated,
  authError,
  inUse = true,
  onUse,
  onCancel,
  helpContent,
  onSaved,
  managedLock,
}: CurrentCodexGlobalConfigCardProps) {
  const { t } = useTranslation();
  const [editOpen, setEditOpen] = useState(false);
  const [configDraft, setConfigDraft] = useState(configContent);
  const [authDraft, setAuthDraft] = useState(authContent);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [authSensitiveVisible, setAuthSensitiveVisible] = useState(false);

  useEffect(() => {
    if (!editOpen) {
      return;
    }
    setConfigDraft(configContent);
    setAuthDraft(authContent);
    setSaveError("");
    setAuthSensitiveVisible(false);
  }, [authContent, configContent, editOpen]);

  const loading = configLoading || authLoading;
  const truncated = configTruncated || authTruncated;
  // Healthy summary is shown in the engine-settings help popover; keep only
  // operational status (loading / error / truncated / empty) inline.
  const firstStatus =
    loading
      ? t("settings.loading")
      : configError
        ? `${t("settings.vendor.codexGlobalConfigReadFailed")}: ${configError}`
        : authError
          ? `${t("settings.vendor.codexAuthConfigReadFailed")}: ${authError}`
          : truncated
            ? [
                configTruncated
                  ? t("settings.vendor.codexGlobalConfigTruncated")
                  : null,
                authTruncated ? t("settings.vendor.codexAuthConfigTruncated") : null,
              ]
                .filter(Boolean)
                .join(" ")
            : !configExists && !authExists
              ? `${t("settings.vendor.codexGlobalConfigEmpty")} ${t(
                  "settings.vendor.codexAuthConfigEmpty",
                )}`
              : null;

  const handleSave = async () => {
    if (authDraft.trim()) {
      try {
        const parsed = JSON.parse(authDraft);
        if (!isJsonObject(parsed)) {
          setSaveError(t("settings.vendor.dialog.jsonError"));
          return;
        }
      } catch {
        setSaveError(t("settings.vendor.dialog.jsonError"));
        return;
      }
    }

    const configChanged = configDraft !== configContent;
    // Never write auth.json with an empty draft: that would wipe credentials.
    const authChanged = authDraft !== authContent && authDraft.trim() !== "";

    if (!configChanged && !authChanged) {
      setEditOpen(false);
      return;
    }

    setSaving(true);
    setSaveError("");
    try {
      const writes: Array<{ label: string; run: () => Promise<void> }> = [];
      if (configChanged) {
        writes.push({
          label: t("settings.vendor.codexGlobalConfigWriteFailed"),
          run: () => writeGlobalCodexConfigToml(configDraft),
        });
      }
      if (authChanged) {
        writes.push({
          label: t("settings.vendor.codexAuthConfigWriteFailed"),
          run: () => writeGlobalCodexAuthJson(authDraft),
        });
      }

      const results = await Promise.allSettled(writes.map((write) => write.run()));
      const failures = results
        .map((result, index) =>
          result.status === "rejected"
            ? `${writes[index].label}: ${errorMessage(result.reason)}`
            : null,
        )
        .filter((message): message is string => Boolean(message));

      if (failures.length > 0) {
        // Partial success still refreshes the on-disk snapshot upstream.
        if (failures.length < writes.length) {
          await onSaved?.();
        }
        setSaveError(failures.join(" · "));
        return;
      }

      await onSaved?.();
      setEditOpen(false);
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const dialogError = (
    <>
      {truncated ? (
        <div>
          {[
            configTruncated
              ? t("settings.vendor.codexGlobalConfigTruncated")
              : null,
            authTruncated
              ? t("settings.vendor.codexAuthConfigTruncated")
              : null,
          ]
            .filter(Boolean)
            .join(" ")}
        </div>
      ) : null}
      {configError ? (
        <div>
          {t("settings.vendor.codexGlobalConfigReadFailed")}: {configError}
        </div>
      ) : null}
      {authError ? (
        <div>
          {t("settings.vendor.codexAuthConfigReadFailed")}: {authError}
        </div>
      ) : null}
      {saveError ? <div>{saveError}</div> : null}
    </>
  );

  const hasDialogError = Boolean(
    truncated || configError || authError || saveError,
  );

  return (
    <>
      <VendorOfficialConfigCard
        title={t("settings.vendor.officialConfig")}
        description={firstStatus}
        inUse={inUse}
        mode="global"
        helpContent={helpContent}
        onUse={onUse}
        onCancel={onCancel}
        onEdit={() => setEditOpen(true)}
        managedLock={managedLock}
      />

      <OfficialConfigEditDialog
        isOpen={editOpen}
        title={t("settings.vendor.officialConfig")}
        onClose={() => setEditOpen(false)}
        onSave={handleSave}
        loading={loading}
        saving={saving}
        saveDisabled={truncated}
        error={hasDialogError ? dialogError : null}
        panes={[
          {
            id: "config-toml",
            title: t("settings.vendor.currentCodexGlobalConfig"),
            pathLabel: t("settings.vendor.codexGlobalConfigPath"),
            value: configDraft,
            onChange: (value) => {
              setConfigDraft(value);
              setSaveError("");
            },
            ariaLabel: t("settings.vendor.currentCodexGlobalConfig"),
            format: "toml",
            dataAttributes: { "codex-editor": "config" },
          },
          {
            id: "auth-json",
            title: t("settings.vendor.currentCodexAuthConfig"),
            pathLabel: t("settings.vendor.codexAuthConfigPath"),
            value: authSensitiveVisible
              ? authDraft
              : redactAuthContent(authDraft),
            onChange: (value) => {
              if (!authSensitiveVisible) {
                return;
              }
              setAuthDraft(value);
              setSaveError("");
            },
            ariaLabel: t("settings.vendor.currentCodexAuthConfig"),
            format: "json",
            dataAttributes: { "codex-editor": "auth" },
            sensitive: true,
            sensitiveVisible: authSensitiveVisible,
            onSensitiveVisibleChange: setAuthSensitiveVisible,
            readOnly: !authSensitiveVisible,
          },
        ]}
      />
    </>
  );
}
