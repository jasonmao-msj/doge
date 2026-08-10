// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyDockIconPreference: vi.fn().mockResolvedValue(undefined),
  appendRendererDiagnostic: vi.fn(),
  getAppSettings: vi.fn().mockResolvedValue({ dockIconId: "default" }),
  getVersion: vi.fn().mockResolvedValue("0.1.0"),
  loadAboutStyles: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  recoverFromReactScanUpdateDepthError: vi.fn().mockReturnValue("not-applicable"),
  resolveDockIconSrc: vi.fn().mockReturnValue("/doge-icon.png"),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => (key === "about.github" ? "GitHub" : key) }),
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("../../../styles/featureStyleLoaders", () => ({
  loadAboutStyles: mocks.loadAboutStyles,
}));
vi.mock("../../../services/tauri", () => ({ getAppSettings: mocks.getAppSettings }));
vi.mock("../../theme/utils/dockIcon", () => ({
  applyDockIconPreference: mocks.applyDockIconPreference,
  DEFAULT_DOCK_ICON_ID: "default",
  resolveDockIconSrc: mocks.resolveDockIconSrc,
}));
vi.mock("../../../services/rendererDiagnostics", () => ({
  appendRendererDiagnostic: mocks.appendRendererDiagnostic,
}));
vi.mock("../../../services/reactScanController", () => ({
  recoverFromReactScanUpdateDepthError: mocks.recoverFromReactScanUpdateDepthError,
}));
vi.mock("../../../i18n", () => ({
  default: {
    language: "en",
    t: (key: string) => key,
  },
}));

import { ErrorBoundary } from "../../../components/ErrorBoundary";
import { DOGE_ISSUES_URL, DOGE_REPOSITORY_URL } from "../../../config/brand";
import { AboutView } from "../../about/components/AboutView";

function Boom(): ReactNode {
  throw new Error("brand link fixture");
}

describe("canonical doge product links", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockClear());
    mocks.getAppSettings.mockResolvedValue({ dockIconId: "default" });
    mocks.getVersion.mockResolvedValue("0.1.0");
    mocks.openUrl.mockResolvedValue(undefined);
    mocks.recoverFromReactScanUpdateDepthError.mockReturnValue("not-applicable");
    mocks.resolveDockIconSrc.mockReturnValue("/doge-icon.png");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens the canonical doge repository from About", async () => {
    render(<AboutView />);
    await screen.findByText("about.version 0.1.0");

    fireEvent.click(screen.getByRole("button", { name: "GitHub" }));

    expect(mocks.openUrl).toHaveBeenCalledWith(DOGE_REPOSITORY_URL);
  });

  it("opens the canonical doge issue form from the crash UI", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByTestId("application-error-feedback"));

    expect(windowOpen).toHaveBeenCalledWith(
      `${DOGE_ISSUES_URL}/new`,
      "_blank",
      "noopener,noreferrer",
    );
  });
});
