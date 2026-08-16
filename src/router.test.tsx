/** @vitest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let windowLabel = "main";
let startupGateOverlayTestEnabled = false;

vi.mock("./features/layout/hooks/useWindowLabel", () => ({
  useWindowLabel: () => windowLabel,
}));

vi.mock("./app-shell", () => ({
  AppShell: () => <div>main-shell</div>,
}));

vi.mock("./features/account/components/AccountAppGate", () => ({
  AccountAppGate: ({ readyContent }: { readyContent: ReactNode }) => (
    <div data-testid="account-app-gate-sentinel">{readyContent}</div>
  ),
}));

vi.mock("./features/app/components/StartupGateOverlay", () => ({
  StartupGateOverlay: () => (
    <div data-testid="startup-gate-overlay-sentinel" />
  ),
}));

vi.mock(
  "./features/startup-orchestration/utils/startupGateOverlayTestFlag",
  () => ({
    isStartupGateOverlayTestEnabled: () => startupGateOverlayTestEnabled,
  }),
);

vi.mock("./features/about/components/AboutView", () => ({
  AboutView: () => <div>about-view</div>,
}));

vi.mock("./features/files/components/DetachedFileExplorerWindow", () => ({
  DetachedFileExplorerWindow: () => <div>detached-file-explorer-view</div>,
}));

vi.mock("./features/spec/components/DetachedSpecHubWindow", () => ({
  DetachedSpecHubWindow: () => <div>detached-spec-hub-view</div>,
}));

vi.mock("./features/client-documentation/components/ClientDocumentationWindow", () => ({
  ClientDocumentationWindow: () => <div>client-documentation-view</div>,
}));

import { AppRouter } from "./router";

async function renderAppRouter() {
  let rendered: ReturnType<typeof render> | undefined;
  await act(async () => {
    rendered = render(<AppRouter />);
    await Promise.resolve();
  });
  if (!rendered) {
    throw new Error("AppRouter test render did not initialize");
  }
  return rendered;
}

describe("AppRouter", () => {
  beforeAll(async () => {
    await Promise.all([
      import("./features/about/components/AboutView"),
      import("./features/files/components/DetachedFileExplorerWindow"),
      import("./features/spec/components/DetachedSpecHubWindow"),
      import("./features/client-documentation/components/ClientDocumentationWindow"),
    ]);
  });

  beforeEach(() => {
    windowLabel = "main";
    startupGateOverlayTestEnabled = false;
  });

  it("renders the main shell for the main window", async () => {
    await renderAppRouter();
    expect(screen.getByText("main-shell")).not.toBeNull();
    expect(
      screen.queryByTestId("startup-gate-overlay-sentinel"),
    ).toBeNull();
  });

  it("mounts the startup gate for an explicitly enabled main-window test", async () => {
    startupGateOverlayTestEnabled = true;
    await renderAppRouter();

    expect(screen.getByText("main-shell")).not.toBeNull();
    expect(
      screen.getByTestId("startup-gate-overlay-sentinel"),
    ).not.toBeNull();
  });

  it("keeps the startup gate setting fixed for the current router mount", async () => {
    const rendered = await renderAppRouter();
    startupGateOverlayTestEnabled = true;

    rendered.rerender(<AppRouter />);

    expect(
      screen.queryByTestId("startup-gate-overlay-sentinel"),
    ).toBeNull();
  });

  it("keeps detached windows behind the account gate without the startup overlay", async () => {
    windowLabel = "about";
    startupGateOverlayTestEnabled = true;
    await renderAppRouter();

    expect(await screen.findByText("about-view")).not.toBeNull();
    expect(screen.getByTestId("account-app-gate-sentinel")).not.toBeNull();
    expect(
      screen.queryByTestId("startup-gate-overlay-sentinel"),
    ).toBeNull();
  });

  it("renders the about view for the about window", async () => {
    windowLabel = "about";
    await renderAppRouter();
    expect(await screen.findByText("about-view")).not.toBeNull();
  });

  it("renders the detached file explorer for the file-explorer window", async () => {
    windowLabel = "file-explorer";
    await renderAppRouter();
    expect(await screen.findByText("detached-file-explorer-view")).not.toBeNull();
  });

  it("renders the detached file explorer for per-tab file-explorer windows", async () => {
    windowLabel = "file-explorer-multiple-1";
    await renderAppRouter();
    expect(await screen.findByText("detached-file-explorer-view")).not.toBeNull();
  });

  it("renders the detached Spec Hub for the spec-hub window", async () => {
    windowLabel = "spec-hub";
    await renderAppRouter();
    expect(await screen.findByText("detached-spec-hub-view")).not.toBeNull();
  });

  it("renders the client documentation window for the client-documentation window", async () => {
    windowLabel = "client-documentation";
    await renderAppRouter();
    expect(await screen.findByText("client-documentation-view")).not.toBeNull();
  });
});
