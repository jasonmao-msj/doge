import {
  createContext,
  use,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import type { CliInstallEngine } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCliVersionStatus } from "../hooks/useCliVersionStatus";
import { useCliInstallLifecycle } from "@/features/settings/hooks/useCliInstallLifecycle";
import { CliInstallerPanel } from "@/features/settings/components/CliInstallerPanel";
import { resolveCliLifecycleButtons } from "./cliLifecycleButtons";
import { resolveManagedToolchainEngineIdV1 } from "@/features/account/runtime/managedEngineToolchain";

type CliLifecycleContextValue = {
  engine: CliInstallEngine;
  /** Null until the first successful status fetch (or cache hit) for this engine. */
  hasStatus: boolean;
  installed: boolean;
  localVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  loading: boolean;
  error: string | null;
  details: string | null;
  disableActions: boolean;
  isBusy: boolean;
  showInstall: boolean;
  showUpgrade: boolean;
  requestInstall: () => void;
  requestUpdate: () => void;
  refresh: () => void;
  installerState: ReturnType<typeof useCliInstallLifecycle>["installerState"];
  installerNowMs: number;
  confirmInstallRun: () => void;
  cancelInstaller: () => void;
};

const CliLifecycleContext = createContext<CliLifecycleContextValue | null>(
  null,
);

function normalizeLocalVersion(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function useCliLifecycleContext(): CliLifecycleContextValue {
  const value = use(CliLifecycleContext);
  if (!value) {
    throw new Error("CliLifecycle components require CliLifecycleProvider");
  }
  return value;
}

type CliLifecycleProviderProps = {
  engine: CliInstallEngine;
  active: boolean;
  children: ReactNode;
};

export function CliLifecycleProvider({
  engine,
  active,
  children,
}: CliLifecycleProviderProps) {
  const { status, loading, error, refresh } = useCliVersionStatus({
    engine,
    enabled: active,
  });
  const {
    installerState,
    installerNowMs,
    isBusy,
    requestInstallPlan,
    confirmInstallRun,
    cancelInstaller,
  } = useCliInstallLifecycle({
    onFinished: () => {
      void refresh();
    },
  });

  const installed = status?.installed ?? false;
  const localVersion = normalizeLocalVersion(status?.localVersion);
  const latestVersion = normalizeLocalVersion(status?.latestVersion);
  const updateAvailable = status?.updateAvailable === true;
  const nodeOk = status?.nodeOk !== false;
  const isManagedEngine = resolveManagedToolchainEngineIdV1(engine) !== null;
  const visibility = status
    ? isManagedEngine
      ? {
          // Managed engines are provisioned from the verified toolchain. The
          // legacy npm installer must not mutate that managed runtime.
          showInstall: false,
          showUpgrade: false,
          showUninstall: false,
        }
      : resolveCliLifecycleButtons({
        installed: status.installed,
        updateAvailable: status.updateAvailable,
        })
    : {
        showInstall: false,
        showUpgrade: false,
        showUninstall: false,
      };

  const value: CliLifecycleContextValue = {
    engine,
    hasStatus: status != null,
    installed,
    localVersion,
    latestVersion,
    updateAvailable,
    loading,
    error,
    details: status?.details ?? null,
    // Keep install/update actions disabled until we have a definitive status.
    disableActions: isBusy || loading || !status || !nodeOk,
    isBusy,
    showInstall: visibility.showInstall,
    showUpgrade: visibility.showUpgrade,
    requestInstall: () => {
      void requestInstallPlan(engine, "installLatest");
    },
    requestUpdate: () => {
      void requestInstallPlan(engine, "updateLatest");
    },
    refresh: () => {
      void refresh();
    },
    installerState,
    installerNowMs,
    confirmInstallRun: () => {
      void confirmInstallRun();
    },
    cancelInstaller,
  };

  return (
    <CliLifecycleContext value={value}>{children}</CliLifecycleContext>
  );
}

export function CliLifecycleHeaderActions() {
  const { t } = useTranslation();
  const {
    hasStatus,
    installed,
    localVersion,
    latestVersion,
    updateAvailable,
    loading,
    error,
    details,
    disableActions,
    isBusy,
    showInstall,
    showUpgrade,
    requestInstall,
    requestUpdate,
    refresh,
  } = useCliLifecycleContext();

  // Only treat "not installed" as definitive once we have a status payload.
  // While loading / cold, show a checking placeholder — never a wrong state.
  const showChecking = !hasStatus || (loading && !localVersion && !installed);
  const showInstalled = hasStatus && installed && Boolean(localVersion);
  const showNotInstalled = hasStatus && !installed && !loading;

  return (
    <>
      <div
        className="vendor-cli-version"
        title={error ?? details ?? undefined}
      >
        {showChecking ? (
          <Badge variant="outline">{t("settings.cliVersionChecking")}</Badge>
        ) : showInstalled ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">
              {t("settings.cliVersionLabel", { version: localVersion })}
            </Badge>
            {updateAvailable && latestVersion ? (
              <Badge variant="warning">→ {latestVersion}</Badge>
            ) : latestVersion ? (
              <Badge variant="success">
                {t("settings.cliVersionUpToDate", {
                  defaultValue: "Up to date",
                })}
              </Badge>
            ) : null}
          </div>
        ) : showNotInstalled ? (
          <Badge variant="outline">{t("settings.cliVersionNotInstalled")}</Badge>
        ) : (
          <Badge variant="outline">{t("settings.cliVersionChecking")}</Badge>
        )}
      </div>
      <div className="vendor-cli-lifecycle-buttons">
        {showInstall ? (
          <Button
            type="button"
            variant="default"
            size="xs"
            disabled={disableActions}
            onClick={requestInstall}
          >
            {t("settings.cliInstallLatest")}
          </Button>
        ) : null}
        {showUpgrade ? (
          <Button
            type="button"
            variant="default"
            size="xs"
            disabled={disableActions}
            onClick={requestUpdate}
          >
            {t("settings.cliUpdateLatest")}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={loading || isBusy}
          onClick={refresh}
          aria-label={t("settings.cliVersionRefresh")}
          title={t("settings.cliVersionRefresh")}
        >
          <RefreshCw aria-hidden />
        </Button>
      </div>
    </>
  );
}

export function CliLifecycleInstallerPanel() {
  const { t } = useTranslation();
  const {
    installerState,
    installerNowMs,
    confirmInstallRun,
    cancelInstaller,
  } = useCliLifecycleContext();

  return (
    <CliInstallerPanel
      t={t}
      installerState={installerState}
      installerNowMs={installerNowMs}
      onConfirm={confirmInstallRun}
      onCancel={cancelInstaller}
    />
  );
}
