import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import type { AppMode } from "../../../types";
import { pushErrorToast } from "../../../services/toasts";
import { installPlugin, uninstallPlugin } from "../../../services/tauri/plugins";
import {
  refreshInstalledPlugins,
  useInstalledPlugins,
} from "../installedPluginsStore";
import { OFFICIAL_PLUGINS } from "../officialPlugins";
import type { InstalledPlugin } from "../types";
import "../../../styles/plugins-page.css";

type PluginsViewProps = {
  onAppModeChange: (mode: AppMode) => void;
};

function toErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function PluginsView({ onAppModeChange }: PluginsViewProps) {
  const { t } = useTranslation();
  const installedPlugins = useInstalledPlugins();
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [customSource, setCustomSource] = useState("");

  const markPending = useCallback((id: string) => {
    setPendingIds((prev) => [...prev, id]);
  }, []);
  const clearPending = useCallback((id: string) => {
    setPendingIds((prev) => prev.filter((value) => value !== id));
  }, []);

  const handleInstall = useCallback(
    async (pendingId: string, source: string) => {
      markPending(pendingId);
      try {
        const plugin = await installPlugin(source);
        await refreshInstalledPlugins();
        pushErrorToast({
          title: t("pluginsPage.installSuccess"),
          message: plugin.manifest.name,
          variant: "success",
          durationMs: 3000,
        });
        return true;
      } catch (error) {
        pushErrorToast({
          title: t("pluginsPage.installFailed"),
          message: toErrorMessage(error),
        });
        return false;
      } finally {
        clearPending(pendingId);
      }
    },
    [clearPending, markPending, t],
  );

  const handleUninstall = useCallback(
    async (plugin: InstalledPlugin) => {
      const pluginId = plugin.manifest.id;
      markPending(pluginId);
      try {
        await uninstallPlugin(pluginId);
        await refreshInstalledPlugins();
        pushErrorToast({
          title: t("pluginsPage.uninstallSuccess"),
          message: plugin.manifest.name,
          variant: "success",
          durationMs: 3000,
        });
      } catch (error) {
        pushErrorToast({
          title: t("pluginsPage.uninstallFailed"),
          message: toErrorMessage(error),
        });
      } finally {
        clearPending(pluginId);
      }
    },
    [clearPending, markPending, t],
  );

  const handleCustomInstall = useCallback(async () => {
    const source = customSource.trim();
    if (!source) {
      return;
    }
    const success = await handleInstall("custom-install", source);
    if (success) {
      setCustomSource("");
    }
  }, [customSource, handleInstall]);

  const isCustomInstalling = pendingIds.includes("custom-install");

  return (
    <div className="plugins-page">
      <header className="plugins-page-header">
        <button
          type="button"
          className="plugins-page-back"
          onClick={() => onAppModeChange("chat")}
          title={t("settings.backToApp")}
          aria-label={t("settings.backToApp")}
          data-tauri-drag-region="false"
        >
          <ArrowLeft size={16} aria-hidden />
        </button>
        <div className="plugins-page-heading">
          <h1 className="plugins-page-title">{t("pluginsPage.title")}</h1>
          <p className="plugins-page-subtitle">{t("pluginsPage.subtitle")}</p>
        </div>
      </header>
      <div className="plugins-page-body">
        <section className="plugins-page-section">
          <h2 className="plugins-page-section-title">
            {t("pluginsPage.installedSection")}
          </h2>
          {installedPlugins.length === 0 ? (
            <div className="plugins-page-empty">
              {t("pluginsPage.emptyInstalled")}
            </div>
          ) : (
            <div className="plugins-page-grid">
              {installedPlugins.map((plugin) => (
                <InstalledPluginCard
                  key={plugin.manifest.id}
                  plugin={plugin}
                  isUninstalling={pendingIds.includes(plugin.manifest.id)}
                  onUninstall={handleUninstall}
                  t={t}
                />
              ))}
            </div>
          )}
        </section>
        <section className="plugins-page-section">
          <h2 className="plugins-page-section-title">
            {t("pluginsPage.officialSection")}
          </h2>
          <div className="plugins-page-grid">
            {OFFICIAL_PLUGINS.map((entry) => {
              const isInstalled = installedPlugins.some(
                (plugin) => plugin.manifest.id === entry.id,
              );
              const isInstalling = pendingIds.includes(entry.id);
              return (
                <div className="plugins-page-card" key={entry.id}>
                  <div className="plugins-page-card-head">
                    <span className="plugins-page-card-name">{entry.name}</span>
                    {entry.author ? (
                      <span className="plugins-page-card-author">
                        {entry.author}
                      </span>
                    ) : null}
                  </div>
                  <p className="plugins-page-card-description">
                    {entry.description}
                  </p>
                  <div className="plugins-page-card-actions">
                    {isInstalled ? (
                      <span className="plugins-page-installed-badge">
                        {t("pluginsPage.installedBadge")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="plugins-page-button plugins-page-button-primary"
                        disabled={isInstalling}
                        onClick={() =>
                          void handleInstall(
                            entry.id,
                            entry.installSource ?? entry.repository,
                          )
                        }
                      >
                        {isInstalling
                          ? t("pluginsPage.installing")
                          : t("pluginsPage.install")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="plugins-page-link"
                      onClick={() => void openUrl(entry.repository)}
                    >
                      {t("pluginsPage.openRepository")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <section className="plugins-page-section">
          <h2 className="plugins-page-section-title">
            {t("pluginsPage.customInstallTitle")}
          </h2>
          <div className="plugins-page-custom-install">
            <input
              type="text"
              className="plugins-page-custom-input"
              value={customSource}
              placeholder={t("pluginsPage.customInstallPlaceholder")}
              onChange={(event) => setCustomSource(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleCustomInstall();
                }
              }}
              disabled={isCustomInstalling}
            />
            <button
              type="button"
              className="plugins-page-button plugins-page-button-primary"
              disabled={isCustomInstalling || !customSource.trim()}
              onClick={() => void handleCustomInstall()}
            >
              {isCustomInstalling
                ? t("pluginsPage.installing")
                : t("pluginsPage.install")}
            </button>
          </div>
          <p className="plugins-page-hint">{t("pluginsPage.customInstallHint")}</p>
        </section>
      </div>
    </div>
  );
}

type InstalledPluginCardProps = {
  plugin: InstalledPlugin;
  isUninstalling: boolean;
  onUninstall: (plugin: InstalledPlugin) => Promise<void>;
  t: (key: string, params?: Record<string, unknown>) => string;
};

function InstalledPluginCard({
  plugin,
  isUninstalling,
  onUninstall,
  t,
}: InstalledPluginCardProps) {
  const { manifest } = plugin;
  return (
    <div className="plugins-page-card">
      <div className="plugins-page-card-head">
        <span className="plugins-page-card-name">{manifest.name}</span>
        <span className="plugins-page-card-version">
          {t("pluginsPage.versionLabel", { version: manifest.version })}
        </span>
      </div>
      <p className="plugins-page-card-description">{manifest.description}</p>
      <div className="plugins-page-card-badges">
        {manifest.capabilities.skill ? (
          <span className="plugins-page-badge">{t("pluginsPage.skillBadge")}</span>
        ) : null}
        {manifest.capabilities.viewer ? (
          <span className="plugins-page-badge">{t("pluginsPage.viewerBadge")}</span>
        ) : null}
        {manifest.capabilities.glossary ? (
          <span className="plugins-page-badge">{t("pluginsPage.glossaryBadge")}</span>
        ) : null}
      </div>
      {manifest.capabilities.skill ? (
        <p className="plugins-page-skill-status">
          {plugin.skillLinked
            ? t("pluginsPage.skillLinked")
            : t("pluginsPage.skillNotLinked")}
        </p>
      ) : null}
      <div className="plugins-page-card-actions">
        <button
          type="button"
          className="plugins-page-button plugins-page-button-danger"
          disabled={isUninstalling}
          onClick={() => void onUninstall(plugin)}
        >
          {isUninstalling
            ? t("pluginsPage.uninstalling")
            : t("pluginsPage.uninstall")}
        </button>
        {manifest.repository ? (
          <button
            type="button"
            className="plugins-page-link"
            onClick={() => void openUrl(manifest.repository!)}
          >
            {t("pluginsPage.openRepository")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
