// @vitest-environment jsdom
import type { ErrorInfo, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const {
  appendRendererDiagnosticMock,
  recoverFromReactScanUpdateDepthErrorMock,
} = vi.hoisted(() => ({
  appendRendererDiagnosticMock: vi.fn(),
  recoverFromReactScanUpdateDepthErrorMock: vi.fn(),
}));

vi.mock("../services/rendererDiagnostics", () => ({
  appendRendererDiagnostic: appendRendererDiagnosticMock,
}));

vi.mock("../services/reactScanController", () => ({
  recoverFromReactScanUpdateDepthError: recoverFromReactScanUpdateDepthErrorMock,
}));

import { ErrorBoundary } from "./ErrorBoundary";

function createBoundary() {
  return new ErrorBoundary({ children: null as ReactNode });
}

const errorInfo = {
  componentStack: "\n    at Messages\n    at AppShell",
} as ErrorInfo;

function Boom(): ReactNode {
  throw new Error("Minified React error #185; visit https://react.dev/errors/185");
}

describe("ErrorBoundary react-scan recovery", () => {
  beforeEach(() => {
    appendRendererDiagnosticMock.mockClear();
    recoverFromReactScanUpdateDepthErrorMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("records the bounded recovery and skips the ordinary error detail update", () => {
    recoverFromReactScanUpdateDepthErrorMock.mockReturnValue("recovered");
    const boundary = createBoundary();
    boundary.setState = vi.fn();
    const error = new Error("Minified React error #185");

    boundary.componentDidCatch(error, errorInfo);

    expect(recoverFromReactScanUpdateDepthErrorMock).toHaveBeenCalledWith(error);
    expect(boundary.setState).not.toHaveBeenCalled();
    expect(appendRendererDiagnosticMock).toHaveBeenCalledWith(
      "react/error-boundary-react-scan-recovery",
      expect.objectContaining({ errorClass: "maximum-update-depth" }),
    );
  });

  it("keeps the ordinary ErrorBoundary path when react-scan recovery does not apply", () => {
    recoverFromReactScanUpdateDepthErrorMock.mockReturnValue("not-applicable");
    const consoleErrorMock = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const boundary = createBoundary();
    boundary.setState = vi.fn();
    const error = new Error("render failed");

    boundary.componentDidCatch(error, errorInfo);

    expect(boundary.setState).toHaveBeenCalledWith({
      errorInfo,
      copyStatus: "idle",
    });
    expect(appendRendererDiagnosticMock).toHaveBeenCalledWith(
      "react/error-boundary",
      expect.objectContaining({
        error: "Error: render failed",
        errorClass: "Error",
      }),
    );
    expect(consoleErrorMock).toHaveBeenCalledOnce();
  });

  it("records a content-safe recovery failure before keeping the ordinary error path", () => {
    recoverFromReactScanUpdateDepthErrorMock.mockReturnValue("failed");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const boundary = createBoundary();
    boundary.setState = vi.fn();
    const error = new Error("Maximum update depth exceeded");

    boundary.componentDidCatch(error, errorInfo);

    expect(appendRendererDiagnosticMock).toHaveBeenNthCalledWith(
      1,
      "react/error-boundary-react-scan-recovery-failed",
      expect.objectContaining({ errorClass: "maximum-update-depth" }),
    );
    expect(appendRendererDiagnosticMock).toHaveBeenNthCalledWith(
      2,
      "react/error-boundary",
      expect.objectContaining({
        error: "Error: Maximum update depth exceeded",
        errorClass: "react-maximum-update-depth",
      }),
    );
    expect(boundary.setState).toHaveBeenCalledWith({
      errorInfo,
      copyStatus: "idle",
    });
  });
});

describe("ErrorBoundary crash UI", () => {
  beforeEach(() => {
    appendRendererDiagnosticMock.mockClear();
    recoverFromReactScanUpdateDepthErrorMock.mockReturnValue("not-applicable");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("shows decoded React #185, component stack, copy and feedback actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId("application-error-boundary")).toBeTruthy();
    expect(screen.getByTestId("application-error-message").textContent).toContain(
      "Minified React error #185",
    );
    expect(screen.getByTestId("application-error-decoded").textContent).toContain(
      "Maximum update depth exceeded",
    );
    // componentDidCatch fills component stack asynchronously via setState
    await waitFor(() => {
      expect(screen.getByTestId("application-error-component-stack").textContent).toContain(
        "at Boom",
      );
    });

    fireEvent.click(screen.getByTestId("application-error-copy"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    const copied = String(writeText.mock.calls[0]?.[0] ?? "");
    expect(copied).toContain("=== doge Application Error Report ===");
    expect(copied).toContain("react-maximum-update-depth");
    expect(copied).toContain("Maximum update depth exceeded");
    expect(copied).toContain("github.com/jasonmao-msj/doge/issues");

    expect(screen.getByTestId("application-error-feedback")).toBeTruthy();
    expect(screen.getByTestId("application-error-reload")).toBeTruthy();
  });
});
