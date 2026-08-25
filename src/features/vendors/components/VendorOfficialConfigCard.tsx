import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Info from "lucide-react/dist/esm/icons/info";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import LockKeyhole from "lucide-react/dist/esm/icons/lock-keyhole";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SettingsRowHelp } from "./SettingsRowHelp";

export type VendorOfficialConfigMode = "auth" | "local" | "global";

export type VendorManagedConfigurationLock = {
  readonly label: string;
  readonly description: string;
};

interface VendorOfficialConfigCardProps {
  title: string;
  /** Optional secondary line; omit for a compact title-only row. */
  description?: ReactNode;
  /** 是否当前正在使用官方配置 */
  inUse?: boolean;
  /**
   * auth: 授权并启用 / 取消授权
   * local | global: 使用 / 取消使用
   */
  mode?: VendorOfficialConfigMode;
  /** 使用 / 授权并启用（未使用时显示） */
  onUse?: () => void;
  /** 取消使用 / 取消授权（使用中时显示；省略则不渲染取消） */
  onCancel?: () => void;
  /** 修改官方配置；省略则不渲染编辑入口 */
  onEdit?: () => void;
  /**
   * Popover help next to the title (preferred for short explanations).
   * Takes precedence over `onHelp`.
   */
  helpContent?: ReactNode;
  /** Legacy help click handler (e.g. open a dedicated help dialog). */
  onHelp?: () => void;
  /** 追加在标准动作之后的额外节点（少用） */
  extraActions?: ReactNode;
  className?: string;
  /** Product-ready surfaces force the isolated Doge profile while preserving local-file editing. */
  managedLock?: VendorManagedConfigurationLock;
}

export function VendorOfficialConfigCard({
  title,
  description,
  inUse = false,
  mode = "local",
  onUse,
  onCancel,
  onEdit,
  helpContent,
  onHelp,
  extraActions,
  className,
  managedLock,
}: VendorOfficialConfigCardProps) {
  const { t } = useTranslation();

  const useLabel =
    mode === "auth"
      ? t("settings.vendor.authorizeAndEnable")
      : t("settings.vendor.useOfficialConfig", {
          defaultValue: "使用",
        });
  const cancelLabel =
    mode === "auth"
      ? t("settings.vendor.revokeAuthorization")
      : t("settings.vendor.cancelOfficialConfig", {
          defaultValue: "取消使用",
        });

  return (
    <div
      className={cn(
        "vendor-current-config vendor-official-config",
        className,
      )}
      data-managed-locked={managedLock ? "true" : "false"}
    >
      <div className="vendor-official-config-row">
        <div className="vendor-official-config-main">
          <div className="vendor-official-config-copy">
            <div className="vendor-current-config-title">
              {title}
              {managedLock || helpContent ? (
                <SettingsRowHelp>
                  {managedLock ? <p>{managedLock.description}</p> : helpContent}
                </SettingsRowHelp>
              ) : onHelp ? (
                <button
                  type="button"
                  className="vendor-btn-icon vendor-settings-row-help"
                  onClick={onHelp}
                  title={t("settings.vendor.whatIsThis")}
                  aria-label={t("settings.vendor.whatIsThis")}
                >
                  <Info aria-hidden />
                </button>
              ) : null}
            </div>
            {description ? (
              <div className="settings-help">{description}</div>
            ) : null}
          </div>
        </div>
        <div className="vendor-official-config-actions">
          {managedLock ? (
            <>
              <span className="vendor-official-status vendor-official-status-locked">
                <LockKeyhole aria-hidden />
                {managedLock.label}
              </span>
              {onEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  title={t("settings.vendor.edit")}
                  aria-label={t("settings.vendor.edit")}
                  onClick={onEdit}
                >
                  <Pencil aria-hidden />
                </Button>
              ) : null}
            </>
          ) : inUse ? (
            <>
              <span className="vendor-official-status">
                <span
                  aria-hidden
                  className="vendor-official-status-dot"
                />
                {t("settings.vendor.inUse")}
              </span>
              {onCancel ? (
                <>
                  <span
                    className="vendor-official-actions-divider"
                    aria-hidden
                  />
                  <button
                    type="button"
                    className="vendor-official-text-btn vendor-official-text-btn-danger"
                    onClick={onCancel}
                  >
                    {cancelLabel}
                  </button>
                </>
              ) : null}
              {onEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  title={t("settings.vendor.edit")}
                  aria-label={t("settings.vendor.edit")}
                  onClick={onEdit}
                >
                  <Pencil aria-hidden />
                </Button>
              ) : null}
            </>
          ) : (
            <>
              {onUse ? (
                <button
                  type="button"
                  className="vendor-official-use-btn"
                  onClick={onUse}
                >
                  {useLabel}
                </button>
              ) : null}
              {onEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  title={t("settings.vendor.edit")}
                  aria-label={t("settings.vendor.edit")}
                  onClick={onEdit}
                >
                  {t("settings.vendor.edit")}
                </Button>
              ) : null}
            </>
          )}
          {extraActions}
        </div>
      </div>
    </div>
  );
}
