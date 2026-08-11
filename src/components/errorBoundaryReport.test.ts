// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ERROR_BOUNDARY_FEEDBACK_URL,
  buildErrorBoundaryReportText,
  classifyErrorBoundaryError,
  copyTextWithDownloadFallback,
  decodeMinifiedReactError,
} from "./errorBoundaryReport";

describe("decodeMinifiedReactError", () => {
  it("expands React #185 to the full maximum-update-depth message", () => {
    const decoded = decodeMinifiedReactError(
      "Minified React error #185; visit https://react.dev/errors/185 for the full message",
    );
    expect(decoded?.code).toBe("185");
    expect(decoded?.fullMessage).toContain("Maximum update depth exceeded");
  });

  it("returns a docs link for unknown minified codes", () => {
    const decoded = decodeMinifiedReactError("Minified React error #999");
    expect(decoded).toEqual({
      code: "999",
      fullMessage: "See https://react.dev/errors/999 for the full message.",
    });
  });

  it("returns null when the message is not a minified React error", () => {
    expect(decodeMinifiedReactError("render failed")).toBeNull();
  });
});

describe("classifyErrorBoundaryError", () => {
  it("classifies minified #185 and full-text depth errors", () => {
    expect(
      classifyErrorBoundaryError(new Error("Minified React error #185")),
    ).toBe("react-maximum-update-depth");
    expect(
      classifyErrorBoundaryError(new Error("Maximum update depth exceeded")),
    ).toBe("react-maximum-update-depth");
  });
});

describe("buildErrorBoundaryReportText", () => {
  it("includes decoded message, stacks, version, and feedback URL", () => {
    const error = new Error("Minified React error #185; visit https://react.dev/errors/185");
    error.stack = "Error: Minified React error #185\n    at App";
    const text = buildErrorBoundaryReportText({
      error,
      componentStack: "\n    at Messages\n    at AppShell",
      generatedAt: new Date("2026-07-31T00:00:00.000Z"),
      appVersion: "0.7.13",
      platform: "test-agent",
      language: "zh",
    });

    expect(text).toContain("=== doge Application Error Report ===");
    expect(text).toContain("appVersion: 0.7.13");
    expect(text).toContain("errorClass: react-maximum-update-depth");
    expect(text).toContain("Maximum update depth exceeded");
    expect(text).toContain("at Messages");
    expect(text).toContain("at App");
    expect(text).toContain(ERROR_BOUNDARY_FEEDBACK_URL);
    expect(text).not.toContain("user prompt");
  });
});

describe("copyTextWithDownloadFallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies via clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const status = await copyTextWithDownloadFallback("hello", "report.txt");
    expect(status).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("downloads a text file when clipboard write fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });

    const click = vi.fn();
    const remove = vi.fn();
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) => {
        if (tag === "a") {
          return {
            href: "",
            download: "",
            click,
            remove,
          } as unknown as HTMLAnchorElement;
        }
        return document.createElementNS("http://www.w3.org/1999/xhtml", tag);
      });
    const appendSpy = vi
      .spyOn(document.body, "appendChild")
      .mockImplementation((node) => node);
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });

    const status = await copyTextWithDownloadFallback("report-body", "err.txt");
    expect(status).toBe("downloaded");
    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();

    createElementSpy.mockRestore();
    appendSpy.mockRestore();
  });
});
