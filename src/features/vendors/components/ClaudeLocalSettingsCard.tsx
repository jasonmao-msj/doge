/**
 * Claude official config row: local ~/.claude/settings.json.
 * Aligned with Codex / Grok / OpenCode — official is in use when no managed
 * third-party is active. Leave official by enabling a third-party provider.
 */
import { useTranslation } from "react-i18next";
import type { ProviderConfig } from "../types";
import { LOCAL_SETTINGS_PROVIDER_ID } from "../types";
import {
  VendorOfficialConfigCard,
  type VendorManagedConfigurationLock,
} from "./VendorOfficialConfigCard";

interface ClaudeLocalSettingsCardProps {
  localProvider: ProviderConfig | null;
  /**
   * Official (local settings) is the effective source — including the default
   * when no managed third-party is active.
   */
  inUse: boolean;
  onSwitch: (id: string) => void;
  onEdit: () => void;
  managedLock?: VendorManagedConfigurationLock;
}

export function ClaudeLocalSettingsCard({
  localProvider,
  inUse,
  onSwitch,
  onEdit,
  managedLock,
}: ClaudeLocalSettingsCardProps) {
  const { t } = useTranslation();

  if (!localProvider) {
    return null;
  }

  return (
    <VendorOfficialConfigCard
      title={t("settings.vendor.officialConfig")}
      helpContent={
        <div className="vendor-settings-row-help-stack">
          <p>{t("settings.vendor.localProviderDescription")}</p>
          <p style={{ whiteSpace: "pre-wrap" }}>
            {t("settings.vendor.localProviderHelpBody")}
          </p>
        </div>
      }
      inUse={inUse}
      mode="local"
      onUse={() => onSwitch(LOCAL_SETTINGS_PROVIDER_ID)}
      onEdit={onEdit}
      managedLock={managedLock}
    />
  );
}
