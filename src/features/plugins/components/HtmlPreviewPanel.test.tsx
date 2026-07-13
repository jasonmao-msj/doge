// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/tauri", () => ({
  readWorkspaceFilePreview: vi.fn(),
}));

vi.mock("../../../styles/plugin-preview.css", () => ({}));

import { readWorkspaceFilePreview } from "../../../services/tauri";
import { setPluginPreviewTarget } from "../pluginPreviewBus";
import { HtmlPreviewPanel } from "./HtmlPreviewPanel";

const SAMPLE_HTML = "<section><h1>Hello</h1></section>";

function setSampleTarget() {
  setPluginPreviewTarget({
    filePath: "docs/article.html",
    pluginId: "gzh-design",
    pluginName: "GZH Design",
    pattern: "**/*.html",
  });
}

beforeEach(() => {
  vi.mocked(readWorkspaceFilePreview).mockResolvedValue({
    content: SAMPLE_HTML,
    truncated: false,
  });
});

afterEach(() => {
  setPluginPreviewTarget(null);
  vi.mocked(readWorkspaceFilePreview).mockReset();
  cleanup();
});

describe("HtmlPreviewPanel", () => {
  it("renders an empty state when no preview target is set", () => {
    render(<HtmlPreviewPanel workspaceId="ws-1" />);
    expect(screen.getByText("pluginsPage.previewTitle")).toBeTruthy();
    expect(readWorkspaceFilePreview).not.toHaveBeenCalled();
  });

  it("loads the file and renders it into a fully sandboxed iframe", async () => {
    setSampleTarget();
    render(<HtmlPreviewPanel workspaceId="ws-1" />);
    expect(screen.getByText("article.html")).toBeTruthy();
    // 测试环境 i18n mock 对未映射 key 原样返回
    expect(screen.getByText("pluginsPage.previewTriggerLabel")).toBeTruthy();
    expect(readWorkspaceFilePreview).toHaveBeenCalledWith(
      "ws-1",
      "docs/article.html",
    );
    const iframe = await screen.findByTitle("pluginsPage.previewTitle");
    await waitFor(() => {
      expect(iframe.getAttribute("srcdoc")).toBe(SAMPLE_HTML);
    });
    expect(iframe.getAttribute("sandbox")).toBe("");
  });

  it("shows the load-failed message when reading the file rejects", async () => {
    vi.mocked(readWorkspaceFilePreview).mockRejectedValue(
      new Error("path escapes workspace"),
    );
    setSampleTarget();
    render(<HtmlPreviewPanel workspaceId="ws-1" />);
    await waitFor(() => {
      expect(
        screen.getByText(/pluginsPage\.previewLoadFailed/),
      ).toBeTruthy();
    });
    expect(screen.getByText(/path escapes workspace/)).toBeTruthy();
  });

  it("copies the html via clipboard writeText fallback and flips to copied label", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    setSampleTarget();
    render(<HtmlPreviewPanel workspaceId="ws-1" />);
    const copyButton = await screen.findByText("pluginsPage.copyHtml");
    await waitFor(() => {
      expect((copyButton.closest("button") as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.click(copyButton);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(SAMPLE_HTML);
    });
    await waitFor(() => {
      expect(screen.getByText("pluginsPage.copied")).toBeTruthy();
    });
  });
});
