/**
 * Shared official-config row for Kimi / Grok / OpenCode local config.toml|json.
 * Pulls Local out of the third-party table into the unified official slot.
 *
 * Matches Codex: official is the default when no managed third-party is active.
 * There is no "cancel official" — leave official by enabling a third-party row.
 */
import { useTranslation } from "react-i18next";
import {
  VendorOfficialConfigCard,
  type VendorManagedConfigurationLock,
} from "./VendorOfficialConfigCard";

export type LocalOfficialConfigCardProps = {
  /** Whether the local/official provider is currently active (incl. default fallback) */
  inUse: boolean;
  /** Local provider id to switch to on "使用" */
  localProviderId: string;
  /** Explanation shown in the row title help popover (not inline). */
  description: string;
  onSwitch: (id: string) => void;
  /** Optional: open raw config editor if available */
  onEdit?: () => void;
  managedLock?: VendorManagedConfigurationLock;
};

export function LocalOfficialConfigCard({
  inUse,
  localProviderId,
  description,
  onSwitch,
  onEdit,
  managedLock,
}: LocalOfficialConfigCardProps) {
  const { t } = useTranslation();

  return (
    <VendorOfficialConfigCard
      title={t("settings.vendor.officialConfig")}
      helpContent={
        <div className="vendor-settings-row-help-stack">
          <p>{description}</p>
        </div>
      }
      inUse={inUse}
      mode="local"
      onUse={() => onSwitch(localProviderId)}
      onEdit={onEdit}
      managedLock={managedLock}
    />
  );
}
