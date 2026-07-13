// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TurnFilesChangedCard } from "./TurnFilesChangedCard";
import type { TurnFileChangesSummary } from "../utils/turnFileChanges";
import type { InstalledPlugin } from "../../plugins/types";

let mockInstalledPlugins: InstalledPlugin[] = [];

// 只替换 useInstalledPlugins（避免测试触发真实 tauri 拉取），matchViewerPlugin 走真实实现。
vi.mock("../../plugins/installedPluginsStore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../plugins/installedPluginsStore")>();
  return {
    ...actual,
    useInstalledPlugins: () => mockInstalledPlugins,
  };
});

vi.mock("../../plugins/pluginPreviewBus", () => ({
  requestPluginHtmlPreview: vi.fn(),
}));

import { requestPluginHtmlPreview } from "../../plugins/pluginPreviewBus";

function buildHtmlViewerPlugin(): InstalledPlugin {
  return {
    manifest: {
      manifestVersion: 1,
      id: "gzh-design",
      name: "GZH Design",
      version: "1.0.0",
      description: "",
      keywords: [],
      capabilities: {
        viewer: { filePattern: "**/*.html", action: "html-preview" },
      },
    },
    installPath: "/plugins/gzh-design",
    skillLinked: false,
  };
}

function buildSummary(fileCount: number): TurnFileChangesSummary {
  const files = Array.from({ length: fileCount }, (_, index) => ({
    path: `src/file-${index}.ts`,
    additions: index + 1,
    deletions: index,
    status: "completed" as const,
  }));
  return {
    files,
    totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

beforeEach(() => {
  mockInstalledPlugins = [];
  vi.mocked(requestPluginHtmlPreview).mockClear();
});

afterEach(() => {
  cleanup();
});

describe("TurnFilesChangedCard", () => {
  it("renders title, total stats and collapses long file lists", () => {
    render(<TurnFilesChangedCard summary={buildSummary(6)} />);
    expect(screen.getByText("messages.turnFilesChanged.title")).toBeTruthy();
    // 总计 +21 -15（1+..+6 / 0+..+5）
    expect(screen.getByText("+21")).toBeTruthy();
    expect(screen.getByText("-15")).toBeTruthy();
    // 收起态只显示前 4 个文件
    expect(screen.getByText("file-0.ts")).toBeTruthy();
    expect(screen.getByText("file-3.ts")).toBeTruthy();
    expect(screen.queryByText("file-4.ts")).toBeNull();
    expect(screen.getByText("messages.turnFilesChanged.showMore")).toBeTruthy();
  });

  it("hides undo and review entry points in the display-only version", () => {
    render(<TurnFilesChangedCard summary={buildSummary(2)} />);
    expect(screen.queryByText("messages.turnFilesChanged.revert")).toBeNull();
    expect(screen.queryByText("messages.turnFilesChanged.review")).toBeNull();
  });

  it("expands hidden files when clicking show-more", () => {
    render(<TurnFilesChangedCard summary={buildSummary(6)} />);
    fireEvent.click(screen.getByText("messages.turnFilesChanged.showMore"));
    expect(screen.getByText("file-5.ts")).toBeTruthy();
    expect(screen.queryByText("messages.turnFilesChanged.showMore")).toBeNull();
  });

  it("renders file rows as non-clickable display-only elements", () => {
    render(<TurnFilesChangedCard summary={buildSummary(2)} />);
    expect(screen.getByText("file-0.ts").closest("button")).toBeNull();
    expect(screen.getByText("file-1.ts").closest("button")).toBeNull();
  });

  it("does not render preview buttons when no installed plugin matches", () => {
    mockInstalledPlugins = [buildHtmlViewerPlugin()];
    render(<TurnFilesChangedCard summary={buildSummary(2)} />);
    expect(screen.queryByText("pluginsPage.previewButton")).toBeNull();
  });

  it("renders a preview button for files matching a viewer plugin pattern", () => {
    mockInstalledPlugins = [buildHtmlViewerPlugin()];
    const summary: TurnFileChangesSummary = {
      files: [
        {
          path: "docs/article.html",
          additions: 10,
          deletions: 0,
          status: "completed",
        },
        { path: "src/main.ts", additions: 2, deletions: 1, status: "completed" },
      ],
      totalAdditions: 12,
      totalDeletions: 1,
    };
    render(<TurnFilesChangedCard summary={summary} />);
    expect(screen.getAllByText("pluginsPage.previewButton")).toHaveLength(1);
  });

  it("dispatches a plugin html preview request when clicking the preview button", () => {
    mockInstalledPlugins = [buildHtmlViewerPlugin()];
    const summary: TurnFileChangesSummary = {
      files: [
        {
          path: "docs/article.html",
          additions: 10,
          deletions: 0,
          status: "completed",
        },
      ],
      totalAdditions: 10,
      totalDeletions: 0,
    };
    render(<TurnFilesChangedCard summary={summary} />);
    fireEvent.click(screen.getByText("pluginsPage.previewButton"));
    expect(requestPluginHtmlPreview).toHaveBeenCalledTimes(1);
    expect(requestPluginHtmlPreview).toHaveBeenCalledWith({
      filePath: "docs/article.html",
      pluginId: "gzh-design",
      pluginName: "GZH Design",
      pattern: "**/*.html",
    });
  });
});
