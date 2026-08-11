import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import AlertCircle from "lucide-react/dist/esm/icons/alert-circle";
import Globe from "lucide-react/dist/esm/icons/globe";
import Info from "lucide-react/dist/esm/icons/info";
import Plus from "lucide-react/dist/esm/icons/plus";
import X from "lucide-react/dist/esm/icons/x";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { loadBrowserAgentStyles } from "../../../styles/featureStyleLoaders";
import type {
  BrowserSession,
  BrowserWebviewEvent,
} from "../types";
import {
  clearActiveBrowserContextSession,
  setActiveBrowserContextSession,
} from "../state/activeBrowserContext";
import {
  closeBrowserAgentSession,
  createBrowserAgentSession,
  getAppSettings,
  getBrowserAgentStatus,
  listBrowserAgentSessions,
  openBrowserAgentWindow,
  updateBrowserAgentSession,
  updateAppSettings,
  validateBrowserAgentUrl,
} from "@/services/tauri";

const BROWSER_WEBVIEW_EVENT = "browser-agent://webview-event";
const BROWSER_OPEN_URL_EVENT = "browser-agent:open-url";
const PENDING_BROWSER_URL_KEY = "doge.browserAgent.pendingUrl";

type BrowserDockProps = {
  workspaceId: string;
  ownerSurface?: string;
  enabled?: boolean;
  className?: string;
  onSessionChange?: (session: BrowserSession | null) => void;
};

type BrowserDockNotice = {
  kind: "info" | "warning" | "error";
  message: string;
};

type TauriInternalsWindow = Window & {
  __TAURI_INTERNALS__?: {
    transformCallback?: unknown;
  };
};

function normalizeUrlDraft(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  // Keep absolute schemes as-is (including local file:// HTML previews).
  if (/^(https?|file):\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function sessionStatusKey(session: BrowserSession | null): string {
  if (!session) {
    return "browserAgent.dock.statusDisconnected";
  }
  if (session.status === "loading") {
    return "browserAgent.dock.statusLoading";
  }
  if (session.status === "ready") {
    return "browserAgent.dock.statusReady";
  }
  if (session.status === "closed") {
    return "browserAgent.dock.statusClosed";
  }
  if (session.status === "failed" || session.status === "blocked") {
    return "browserAgent.dock.statusNeedsAttention";
  }
  return "browserAgent.dock.statusPreparing";
}

function hasTauriEventBridge(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return typeof (window as TauriInternalsWindow).__TAURI_INTERNALS__?.transformCallback === "function";
}

export function BrowserDock({
  workspaceId,
  ownerSurface = "vibecoding",
  enabled,
  className,
  onSessionChange,
}: BrowserDockProps) {
  useEffect(() => {
    void loadBrowserAgentStyles();
  }, []);
  const { t, i18n } = useTranslation();
  const [statusEnabled, setStatusEnabled] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [sessions, setSessions] = useState<BrowserSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<BrowserDockNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const activeSessionRef = useRef<BrowserSession | null>(null);
  const onSessionChangeRef = useRef(onSessionChange);

  const openSessions = useMemo(
    () => sessions.filter((session) => session.status !== "closed"),
    [sessions],
  );
  const activeSession = useMemo(() => {
    if (!activeSessionId) {
      return null;
    }
    return openSessions.find((session) => session.browserSessionId === activeSessionId) ?? null;
  }, [activeSessionId, openSessions]);
  activeSessionRef.current = activeSession;
  onSessionChangeRef.current = onSessionChange;

  const statusLabel = useMemo(
    () => t(sessionStatusKey(activeSession)),
    [activeSession, t],
  );
  const resolvedEnabled = enabled ?? statusEnabled;
  const infoMessage = notice?.message
    ? `${notice.message}\n${t("browserAgent.dock.footnote")}`
    : t("browserAgent.dock.footnote");

  useEffect(() => {
    if (enabled !== undefined) {
      setStatusEnabled(enabled);
      return;
    }
    let mounted = true;
    void (async () => {
      try {
        const status = await getBrowserAgentStatus();
        if (mounted) {
          setStatusEnabled(status.settings.enabled);
        }
      } catch (error) {
        if (mounted) {
          setStatusEnabled(false);
          setNotice({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [enabled]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const nextSessions = await listBrowserAgentSessions(workspaceId);
        if (!mounted) {
          return;
        }
        setSessions(nextSessions);
        const nextActive = nextSessions.find((session) => session.status !== "closed") ?? null;
        setActiveSessionId(nextActive?.browserSessionId ?? null);
        if (nextActive) {
          setActiveBrowserContextSession(nextActive, { rendererBound: false });
        } else {
          clearActiveBrowserContextSession();
        }
        onSessionChangeRef.current?.(nextActive);
      } catch (error) {
        if (mounted) {
          setNotice({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!hasTauriEventBridge()) {
      return;
    }
    let disposed = false;
    let cleanup: (() => void) | null = null;
    void listen<BrowserWebviewEvent>(BROWSER_WEBVIEW_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event.payload;
      setSessions((current) =>
        current.map((session) =>
          session.browserSessionId === payload.browserSessionId
            ? {
                ...session,
                url: payload.url ?? session.url,
                normalizedUrl: payload.url ?? session.normalizedUrl,
                title: payload.title ?? session.title,
                status: payload.status,
                errorCode: payload.errorCode ?? session.errorCode,
                diagnosticMessage:
                  payload.diagnosticMessage ?? session.diagnosticMessage,
                updatedAt: payload.occurredAt,
                lastActivatedAt: payload.occurredAt,
              }
            : session,
        ),
      );
      setActiveSessionId((current) => {
        if (current !== payload.browserSessionId) {
          return current;
        }
        if (payload.url) {
          setUrlDraft(payload.url);
        }
        const currentActiveSession = activeSessionRef.current;
        if (currentActiveSession) {
          const nextActiveSession = {
            ...currentActiveSession,
            url: payload.url ?? currentActiveSession.url,
            normalizedUrl: payload.url ?? currentActiveSession.normalizedUrl,
            title: payload.title ?? currentActiveSession.title,
            status: payload.status,
            errorCode: payload.errorCode ?? currentActiveSession.errorCode,
            diagnosticMessage:
              payload.diagnosticMessage ?? currentActiveSession.diagnosticMessage,
            updatedAt: payload.occurredAt,
            lastActivatedAt: payload.occurredAt,
          };
          setActiveBrowserContextSession(nextActiveSession, { rendererBound: true });
          onSessionChangeRef.current?.({ ...nextActiveSession });
        }
        return current;
      });
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      cleanup = unlisten;
    }).catch((error: unknown) => {
      if (disposed) {
        return;
      }
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  const openSessionWindow = useCallback(async (session: BrowserSession) => {
    try {
      const openedSession = await openBrowserAgentWindow(session.browserSessionId, i18n.language);
      setActiveBrowserContextSession(openedSession, { rendererBound: true });
      return openedSession;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedSession = await updateBrowserAgentSession({
        browserSessionId: session.browserSessionId,
        status: "failed",
        errorCode: "browser_window_open_failed",
        diagnosticMessage: message,
      });
      setActiveBrowserContextSession(failedSession, { rendererBound: false });
      throw error;
    }
  }, [i18n.language]);

  const handleOpen = useCallback(async (nextUrl?: string) => {
    if (!resolvedEnabled || busy) {
      return;
    }
    const normalizedDraft = normalizeUrlDraft(nextUrl ?? urlDraft);
    if (!normalizedDraft) {
      setNotice({ kind: "warning", message: t("browserAgent.dock.emptyUrl") });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const validation = await validateBrowserAgentUrl(normalizedDraft, workspaceId);
      if (!validation.allowed || !validation.normalizedUrl) {
        setNotice({
          kind: "warning",
          message:
            validation.diagnostic?.message ?? t("browserAgent.dock.blockedUrl"),
        });
        return;
      }
      if (activeSession && nextUrl === undefined) {
        const preparedSession = await updateBrowserAgentSession({
          browserSessionId: activeSession.browserSessionId,
          workspaceId,
          url: validation.normalizedUrl,
          status: "loading",
          diagnosticMessage: null,
          errorCode: null,
        });
        const openedSession = await openSessionWindow(preparedSession);
        setActiveSessionId(openedSession.browserSessionId);
        setUrlDraft(validation.normalizedUrl);
        setSessions((current) =>
          current.map((item) =>
            item.browserSessionId === openedSession.browserSessionId
              ? openedSession
              : item,
          ),
        );
        setNotice({ kind: "info", message: t("browserAgent.dock.opened") });
        return;
      }
      const preparedSession = await createBrowserAgentSession({
        workspaceId,
        url: validation.normalizedUrl,
        ownerSurface,
      });
      const openedSession = await openSessionWindow(preparedSession);
      setActiveSessionId(openedSession.browserSessionId);
      setUrlDraft(validation.normalizedUrl);
      setSessions((current) => [
        openedSession,
        ...current.filter((item) => item.browserSessionId !== openedSession.browserSessionId),
      ]);
      setNotice({ kind: "info", message: t("browserAgent.dock.opened") });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [
    activeSession,
    busy,
    ownerSurface,
    openSessionWindow,
    resolvedEnabled,
    t,
    urlDraft,
    workspaceId,
  ]);

  useEffect(() => {
    const consumePendingUrl = () => {
      if (!resolvedEnabled) {
        return;
      }
      const pendingUrl = window.sessionStorage.getItem(PENDING_BROWSER_URL_KEY);
      if (!pendingUrl) {
        return;
      }
      window.sessionStorage.removeItem(PENDING_BROWSER_URL_KEY);
      void handleOpen(pendingUrl);
    };
    consumePendingUrl();
    const handleOpenUrl = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string }>).detail;
      if (detail?.url) {
        if (!resolvedEnabled) {
          return;
        }
        window.sessionStorage.removeItem(PENDING_BROWSER_URL_KEY);
        void handleOpen(detail.url);
        return;
      }
      consumePendingUrl();
    };
    window.addEventListener(BROWSER_OPEN_URL_EVENT, handleOpenUrl);
    return () => {
      window.removeEventListener(BROWSER_OPEN_URL_EVENT, handleOpenUrl);
    };
  }, [handleOpen, resolvedEnabled]);

  const handleEnableBrowserAgent = useCallback(async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const settings = await getAppSettings();
      await updateAppSettings({
        ...settings,
        browserAgentEnabled: true,
        browserAgentPreferBuiltIn: true,
      });
      setStatusEnabled(true);
      setNotice({ kind: "info", message: t("browserAgent.dock.enabled") });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [busy, t]);

  const handleActivateSession = useCallback(
    (session: BrowserSession) => {
      setActiveSessionId(session.browserSessionId);
      setUrlDraft(session.normalizedUrl);
      setNotice(null);
      setActiveBrowserContextSession(session, {
        rendererBound: false,
      });
      onSessionChangeRef.current?.(session);
      if (resolvedEnabled && session.status !== "closed") {
        void openSessionWindow(session)
          .then((openedSession) => {
            setSessions((current) =>
              current.map((item) =>
                item.browserSessionId === openedSession.browserSessionId
                  ? openedSession
                  : item,
              ),
            );
            onSessionChangeRef.current?.(openedSession);
          })
          .catch((error) => {
            setNotice({
              kind: "error",
              message: error instanceof Error ? error.message : String(error),
            });
          });
      }
    },
    [openSessionWindow, resolvedEnabled],
  );

  const handleCloseSession = useCallback(async (sessionId: string) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const closed = await closeBrowserAgentSession(sessionId);
      clearActiveBrowserContextSession(sessionId);
      setSessions((current) =>
        current.map((session) =>
          session.browserSessionId === closed.browserSessionId ? closed : session,
        ),
      );
      const nextActive = openSessions.find(
        (session) => session.browserSessionId !== sessionId,
      ) ?? null;
      const shouldOpenNextSession = activeSessionId === sessionId && nextActive !== null;
      setActiveSessionId((current) => {
        if (current !== sessionId) {
          return current;
        }
        setUrlDraft(nextActive?.normalizedUrl ?? "");
        if (nextActive) {
          setActiveBrowserContextSession(nextActive, {
            rendererBound: false,
          });
        }
        onSessionChangeRef.current?.(nextActive);
        return nextActive?.browserSessionId ?? null;
      });
      if (shouldOpenNextSession) {
        void openSessionWindow(nextActive)
          .then((openedSession) => {
            setSessions((current) =>
              current.map((session) =>
                session.browserSessionId === openedSession.browserSessionId
                  ? openedSession
                  : session,
              ),
            );
            onSessionChangeRef.current?.(openedSession);
          })
          .catch((error) => {
            setNotice({
              kind: "error",
              message: error instanceof Error ? error.message : String(error),
            });
          });
      }
      setNotice({ kind: "info", message: t("browserAgent.dock.closed") });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [activeSessionId, busy, openSessionWindow, openSessions, t]);

  const handleCloseActiveSession = useCallback(async () => {
    if (!activeSession) {
      return;
    }
    await handleCloseSession(activeSession.browserSessionId);
  }, [activeSession, handleCloseSession]);

  return (
    <Card className={className} data-browser-agent-dock="true">
      <CardContent className="browser-agent-dock-content">
        <div className="browser-agent-tab-strip" role="tablist" aria-label={t("browserAgent.dock.tabs")}>
          <div className="browser-agent-tab-track">
            {openSessions.map((session) => (
            <div
              key={session.browserSessionId}
              className={`browser-agent-tab${session.browserSessionId === activeSessionId ? " is-active" : ""}`}
              role="presentation"
            >
              <button
                type="button"
                role="tab"
                aria-selected={session.browserSessionId === activeSessionId}
                className="browser-agent-tab-main"
                onClick={() => handleActivateSession(session)}
                title={session.title || session.normalizedUrl}
              >
                <span className="browser-agent-tab-main-content">
                  <Globe size={12} aria-hidden />
                  <span className="browser-agent-tab-label">
                    {session.title || session.normalizedUrl}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="browser-agent-tab-close"
                aria-label={t("browserAgent.dock.close")}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleCloseSession(session.browserSessionId);
                }}
                disabled={busy}
              >
                <X size={11} aria-hidden />
              </button>
            </div>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="browser-agent-tab-new"
            onClick={() => {
              setActiveSessionId(null);
              setUrlDraft("");
              onSessionChange?.(null);
            }}
            aria-label={t("browserAgent.dock.newTab")}
          >
            <Plus size={14} aria-hidden />
              </Button>
          <Badge className="browser-agent-dock-status" variant={resolvedEnabled ? "default" : "outline"}>
            {resolvedEnabled ? statusLabel : t("browserAgent.dock.disabled")}
          </Badge>
        </div>
        <div className="browser-agent-dock-url-row">
          {!resolvedEnabled ? (
            <Button type="button" onClick={() => void handleEnableBrowserAgent()} disabled={busy}>
              {busy ? t("browserAgent.dock.busy") : t("browserAgent.dock.enable")}
            </Button>
          ) : null}
          <Input
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void handleOpen();
              }
            }}
            placeholder="https://example.com"
            disabled={!resolvedEnabled || busy}
            aria-label="Browser Agent URL"
          />
          <Button type="button" onClick={() => void handleOpen()} disabled={!resolvedEnabled || busy}>
            {busy ? t("browserAgent.dock.busy") : t("browserAgent.dock.open")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleCloseActiveSession()}
            disabled={!activeSession || busy}
            aria-label={t("browserAgent.dock.close")}
          >
            <X size={14} aria-hidden />
          </Button>
        </div>
        {activeSession && resolvedEnabled ? (
          <div className="browser-agent-webview-frame" data-browser-agent-window-status="true">
            <div className="browser-agent-webview-placeholder">
              <Globe size={18} aria-hidden />
              <span>{t("browserAgent.dock.windowOpened")}</span>
            </div>
          </div>
        ) : (
          <div className="browser-agent-webview-empty">
            {t("browserAgent.dock.noPage")}
          </div>
        )}
        <div className="browser-agent-dock-footer">
          <button
            type="button"
            className={`browser-agent-dock-info${notice ? ` is-${notice.kind}` : ""}`}
            aria-label={t("browserAgent.dock.info")}
            aria-expanded={infoOpen}
            onClick={() => setInfoOpen((current) => !current)}
          >
            {notice ? <AlertCircle size={14} aria-hidden /> : <Info size={14} aria-hidden />}
          </button>
          {infoOpen ? (
            <div className={`browser-agent-dock-popover${notice ? ` is-${notice.kind}` : ""}`} role="status">
              {infoMessage.split("\n").map((line, index) => (
                <p key={`${index}-${line}`}>{line}</p>
              ))}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
