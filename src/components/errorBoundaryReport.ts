import { DOGE_ISSUES_URL, DOGE_NAME } from "../config/brand";

/**
 * Content-safe crash report for the global ErrorBoundary.
 * Users copy this blob into GitHub Issues so maintainers can triage without a
 * non-minified stack. Never includes prompts, assistant text, or file contents.
 */

export const ERROR_BOUNDARY_FEEDBACK_URL =
  `${DOGE_ISSUES_URL}/new`;

/** Known production React minified codes we can expand for triage. */
const REACT_MINIFIED_MESSAGES: Readonly<Record<string, string>> = {
  "185":
    "Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. React limits the number of nested updates to prevent infinite loops.",
  "300":
    "Rendered more hooks than during the previous render.",
  "310":
    "Rendered fewer hooks than expected. This may be caused by an accidental early return statement.",
  "418":
    "Hydration failed because the server rendered HTML didn't match the client.",
  "423":
    "There was an error while hydrating. Because the error happened outside of a Suspense boundary, the entire root will switch to client rendering.",
  "425":
    "Text content does not match server-rendered HTML.",
};

export type ErrorBoundaryReportInput = {
  error: Error | null;
  componentStack: string | null | undefined;
  generatedAt?: Date;
  appVersion?: string;
  platform?: string;
  language?: string;
};

export type DecodedReactError = {
  code: string;
  fullMessage: string;
};

export function getAppVersionForReport(): string {
  // vite.config define 注入的构建期版本；优先于 env，避免报告长期 appVersion: unknown
  try {
    if (typeof __APP_VERSION__ === "string" && __APP_VERSION__.trim()) {
      return __APP_VERSION__.trim();
    }
  } catch {
    // non-vite test hosts may not declare the global
  }
  const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
  return env.VITE_APP_VERSION || env.PACKAGE_VERSION || "unknown";
}

export function getPlatformForReport(): string {
  if (typeof navigator === "undefined") {
    return "unknown";
  }
  return (navigator.userAgent || "unknown").slice(0, 200);
}

export function decodeMinifiedReactError(
  message: string | null | undefined,
): DecodedReactError | null {
  if (!message) {
    return null;
  }
  const match = message.match(/Minified React error #(\d+)/i);
  if (!match) {
    return null;
  }
  const code = match[1] ?? "";
  const known = REACT_MINIFIED_MESSAGES[code];
  if (known) {
    return { code, fullMessage: known };
  }
  return {
    code,
    fullMessage: `See https://react.dev/errors/${code} for the full message.`,
  };
}

export function classifyErrorBoundaryError(error: Error | null): string {
  if (!error) {
    return "unknown";
  }
  const message = error.message || "";
  if (
    message.includes("Maximum update depth exceeded") ||
    message.includes("Minified React error #185")
  ) {
    return "react-maximum-update-depth";
  }
  const minified = decodeMinifiedReactError(message);
  if (minified) {
    return `react-minified-${minified.code}`;
  }
  return error.name || "Error";
}

export function buildErrorBoundaryReportText(
  input: ErrorBoundaryReportInput,
): string {
  const error = input.error;
  const message = error ? `${error.name}: ${error.message}` : "(no error object)";
  const decoded = decodeMinifiedReactError(error?.message);
  const errorClass = classifyErrorBoundaryError(error);
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  const appVersion = input.appVersion ?? getAppVersionForReport();
  const platform = input.platform ?? getPlatformForReport();
  const language = input.language ?? "unknown";
  const componentStack = (input.componentStack ?? "").trim() || "(empty)";
  const jsStack = (error?.stack ?? "").trim() || "(empty)";

  const lines = [
    `=== ${DOGE_NAME} Application Error Report ===`,
    `generatedAt: ${generatedAt}`,
    `appVersion: ${appVersion}`,
    `platform: ${platform}`,
    `language: ${language}`,
    `errorClass: ${errorClass}`,
    "",
    "--- error ---",
    message,
  ];

  if (decoded) {
    lines.push(
      "",
      `--- decoded React #${decoded.code} ---`,
      decoded.fullMessage,
      `docs: https://react.dev/errors/${decoded.code}`,
    );
  }

  lines.push(
    "",
    "--- componentStack ---",
    componentStack,
    "",
    "--- stack ---",
    jsStack,
    "",
    "--- feedback ---",
    `Please open ${ERROR_BOUNDARY_FEEDBACK_URL}`,
    "Paste this entire report, then add: what you were doing, whether it is cold start / streaming / switching workspace, and whether reload recovers it.",
    "",
  );

  return lines.join("\n");
}

export async function copyTextWithDownloadFallback(
  text: string,
  downloadFileName: string,
): Promise<"copied" | "downloaded" | "failed"> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return "copied";
    }
  } catch {
    // WKWebView may reject clipboard writes; fall through to download.
  }

  try {
    if (typeof document === "undefined") {
      return "failed";
    }
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = downloadFileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return "downloaded";
  } catch {
    return "failed";
  }
}
