import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { useWindowLabel } from "./features/layout/hooks/useWindowLabel";
import { isDetachedFileExplorerWindowLabel } from "./features/files/detachedFileExplorer";
import { isBrowserAgentDockWindowLabel } from "./features/browser-agent/browserAgentDockWindow";
import { AppShell } from "./app-shell";
import { AccountAppGate } from "./features/account/components/AccountAppGate";
import { createRealAccountGatewayV1 } from "./services/accountGateway";
import { StartupGateOverlay } from "./features/app/components/StartupGateOverlay";
import { isStartupGateOverlayTestEnabled } from "./features/startup-orchestration/utils/startupGateOverlayTestFlag";

const AboutView = lazy(() =>
  import("./features/about/components/AboutView").then((module) => ({
    default: module.AboutView,
  })),
);

const DetachedFileExplorerWindow = lazy(() =>
  import("./features/files/components/DetachedFileExplorerWindow").then((module) => ({
    default: module.DetachedFileExplorerWindow,
  })),
);

const DetachedSpecHubWindow = lazy(() =>
  import("./features/spec/components/DetachedSpecHubWindow").then((module) => ({
    default: module.DetachedSpecHubWindow,
  })),
);

const ClientDocumentationWindow = lazy(() =>
  import("./features/client-documentation/components/ClientDocumentationWindow").then((module) => ({
    default: module.ClientDocumentationWindow,
  })),
);

const DetachedBrowserAgentWindow = lazy(() =>
  import("./features/browser-agent/components/DetachedBrowserAgentWindow").then((module) => ({
    default: module.DetachedBrowserAgentWindow,
  })),
);

export function AppRouter() {
  const windowLabel = useWindowLabel();
  const [startupGateOverlayEnabledAtMount] = useState(
    isStartupGateOverlayTestEnabled,
  );
  const accountGateway = useMemo(() => createRealAccountGatewayV1(), []);
  let readyContent: ReactNode = <AppShell />;
  if (windowLabel === "about") {
    readyContent = (
      <Suspense fallback={null}>
        <AboutView />
      </Suspense>
    );
  } else if (isDetachedFileExplorerWindowLabel(windowLabel)) {
    readyContent = (
      <Suspense fallback={null}>
        <DetachedFileExplorerWindow />
      </Suspense>
    );
  } else if (windowLabel === "spec-hub") {
    readyContent = (
      <Suspense fallback={null}>
        <DetachedSpecHubWindow />
      </Suspense>
    );
  } else if (windowLabel === "client-documentation") {
    readyContent = (
      <Suspense fallback={null}>
        <ClientDocumentationWindow />
      </Suspense>
    );
  } else if (isBrowserAgentDockWindowLabel(windowLabel)) {
    readyContent = (
      <Suspense fallback={null}>
        <DetachedBrowserAgentWindow />
      </Suspense>
    );
  }
  return (
    <>
      <AccountAppGate gateway={accountGateway} readyContent={readyContent} />
      {windowLabel === "main" && startupGateOverlayEnabledAtMount ? (
        <StartupGateOverlay />
      ) : null}
    </>
  );
}

export default AppRouter;
