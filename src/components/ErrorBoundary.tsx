import {
  Component,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from "react";
import i18n from "../i18n";
import { appendRendererDiagnostic } from "../services/rendererDiagnostics";
import { recoverFromReactScanUpdateDepthError } from "../services/reactScanController";
import {
  ERROR_BOUNDARY_FEEDBACK_URL,
  buildErrorBoundaryReportText,
  classifyErrorBoundaryError,
  copyTextWithDownloadFallback,
  decodeMinifiedReactError,
  getAppVersionForReport,
  getPlatformForReport,
} from "./errorBoundaryReport";

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode;
};

type CopyStatus = "idle" | "copied" | "downloaded" | "failed";

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copyStatus: CopyStatus;
};

const shellStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "#0d0f14",
  color: "#e2e8f0",
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  fontSize: 14,
  padding: 32,
  overflow: "auto",
  zIndex: 99999,
};

const primaryButtonStyle: CSSProperties = {
  padding: "8px 14px",
  background: "#2563eb",
  color: "#f8fafc",
  border: "1px solid #1d4ed8",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
};

const secondaryButtonStyle: CSSProperties = {
  padding: "8px 14px",
  background: "#1e293b",
  color: "#e2e8f0",
  border: "1px solid #334155",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
};

const preStyle: CSSProperties = {
  margin: "8px 0 0",
  padding: 12,
  background: "#1e1e2e",
  borderRadius: 6,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: 12,
  lineHeight: 1.5,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};

function t(key: string, options?: Record<string, unknown>): string {
  try {
    return i18n.t(key, options);
  } catch {
    return key;
  }
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copyStatus: "idle",
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error, copyStatus: "idle" };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const reactScanRecoveryStatus = recoverFromReactScanUpdateDepthError(error);
    if (reactScanRecoveryStatus === "recovered") {
      appendRendererDiagnostic("react/error-boundary-react-scan-recovery", {
        errorClass: "maximum-update-depth",
        componentStack: errorInfo.componentStack || null,
      });
      return;
    }
    if (reactScanRecoveryStatus === "failed") {
      appendRendererDiagnostic("react/error-boundary-react-scan-recovery-failed", {
        errorClass: "maximum-update-depth",
        componentStack: errorInfo.componentStack || null,
      });
    }
    this.setState({ errorInfo, copyStatus: "idle" });
    appendRendererDiagnostic("react/error-boundary", {
      error: `${error.name}: ${error.message}`,
      errorClass: classifyErrorBoundaryError(error),
      componentStack: errorInfo.componentStack || null,
    });
    console.error("[ErrorBoundary] Uncaught rendering error:", error, errorInfo);
  }

  private buildReportText(): string {
    return buildErrorBoundaryReportText({
      error: this.state.error,
      componentStack: this.state.errorInfo?.componentStack,
      appVersion: getAppVersionForReport(),
      platform: getPlatformForReport(),
      language: i18n.language || "unknown",
    });
  }

  private handleCopyReport = async () => {
    const report = this.buildReportText();
    const status = await copyTextWithDownloadFallback(
      report,
      `doge-error-report-${Date.now()}.txt`,
    );
    this.setState({ copyStatus: status });
  };

  private handleOpenFeedback = () => {
    try {
      window.open(ERROR_BOUNDARY_FEEDBACK_URL, "_blank", "noopener,noreferrer");
    } catch {
      // Ignore popup blockers; the URL is still shown in the report.
    }
  };

  private copyStatusMessage(): string | null {
    switch (this.state.copyStatus) {
      case "copied":
        return t("errors.applicationErrorCopyDone");
      case "downloaded":
        return t("errors.applicationErrorCopyDownloaded");
      case "failed":
        return t("errors.applicationErrorCopyFailed");
      default:
        return null;
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const error = this.state.error;
      const errorText = error
        ? `${error.name}: ${error.message}`
        : t("errors.unexpectedError");
      const decoded = decodeMinifiedReactError(error?.message);
      const componentStack = this.state.errorInfo?.componentStack?.trim() || "";
      const jsStack = error?.stack?.trim() || "";
      const errorClass = classifyErrorBoundaryError(error);
      const appVersion = getAppVersionForReport();
      const platform = getPlatformForReport();
      const statusMessage = this.copyStatusMessage();

      return (
        <div style={shellStyle} role="alert" data-testid="application-error-boundary">
          <h2 style={{ color: "#f87171", margin: "0 0 12px", fontSize: 20 }}>
            {t("errors.applicationErrorTitle")}
          </h2>
          <p style={{ color: "#94a3b8", margin: "0 0 12px", maxWidth: 720, lineHeight: 1.55 }}>
            {t("errors.applicationErrorDescription")}
          </p>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 12,
              alignItems: "center",
            }}
          >
            <button
              type="button"
              onClick={() => {
                void this.handleCopyReport();
              }}
              style={primaryButtonStyle}
              data-testid="application-error-copy"
            >
              {t("errors.applicationErrorCopyReport")}
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={secondaryButtonStyle}
              data-testid="application-error-reload"
            >
              {t("errors.applicationErrorReload")}
            </button>
            <button
              type="button"
              onClick={this.handleOpenFeedback}
              style={secondaryButtonStyle}
              data-testid="application-error-feedback"
            >
              {t("errors.applicationErrorOpenFeedback")}
            </button>
          </div>

          {statusMessage ? (
            <p
              style={{ color: "#86efac", margin: "0 0 12px", fontSize: 13 }}
              data-testid="application-error-copy-status"
            >
              {statusMessage}
            </p>
          ) : null}

          <section
            style={{
              marginBottom: 16,
              padding: 12,
              background: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 8,
              maxWidth: 860,
            }}
          >
            <div style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 6 }}>
              {t("errors.applicationErrorFeedbackTitle")}
            </div>
            <ol
              style={{
                margin: 0,
                paddingLeft: 18,
                color: "#94a3b8",
                lineHeight: 1.6,
              }}
            >
              <li>{t("errors.applicationErrorFeedbackStep1")}</li>
              <li>{t("errors.applicationErrorFeedbackStep2")}</li>
              <li>{t("errors.applicationErrorFeedbackStep3")}</li>
            </ol>
          </section>

          <details open style={{ marginTop: 8, maxWidth: 960 }}>
            <summary style={{ cursor: "pointer", color: "#94a3b8", marginBottom: 8 }}>
              {t("errors.applicationErrorDetails")}
            </summary>

            <div style={{ color: "#64748b", fontSize: 12, marginBottom: 8 }}>
              {t("errors.applicationErrorMeta", {
                version: appVersion,
                errorClass,
                platform,
              })}
            </div>

            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 8 }}>
              {t("errors.applicationErrorMessageLabel")}
            </div>
            <pre style={{ ...preStyle, color: "#f87171" }} data-testid="application-error-message">
              {errorText}
            </pre>

            {decoded ? (
              <>
                <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 12 }}>
                  {t("errors.applicationErrorDecodedLabel", { code: decoded.code })}
                </div>
                <pre
                  style={{ ...preStyle, color: "#fbbf24" }}
                  data-testid="application-error-decoded"
                >
                  {decoded.fullMessage}
                  {"\n"}
                  docs: https://react.dev/errors/{decoded.code}
                </pre>
              </>
            ) : null}

            {componentStack ? (
              <>
                <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 12 }}>
                  {t("errors.applicationErrorComponentStackLabel")}
                </div>
                <pre
                  style={{ ...preStyle, color: "#94a3b8" }}
                  data-testid="application-error-component-stack"
                >
                  {componentStack}
                </pre>
              </>
            ) : null}

            {jsStack ? (
              <>
                <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 12 }}>
                  {t("errors.applicationErrorStackLabel")}
                </div>
                <pre
                  style={{ ...preStyle, color: "#64748b" }}
                  data-testid="application-error-stack"
                >
                  {jsStack}
                </pre>
              </>
            ) : null}
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
