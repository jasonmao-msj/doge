// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledPlugin } from "../types";
import { PluginPreviewEntry } from "./PluginPreviewEntry";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "pluginsPage.previewButton" ? "预览" : key),
  }),
}));

const useInstalledPluginsMock = vi.fn<() => InstalledPlugin[]>(() => []);
vi.mock("../installedPluginsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../installedPluginsStore")>();
  return {
    ...actual,
    useInstalledPlugins: () => useInstalledPluginsMock(),
  };
});

const requestPluginHtmlPreviewMock = vi.fn();
vi.mock("../pluginPreviewBus", () => ({
  requestPluginHtmlPreview: (request: unknown) => requestPluginHtmlPreviewMock(request),
}));

const gzhPlugin: InstalledPlugin = {
  installPath: "/plugins/gzh-design",
  skillLinked: true,
  manifest: {
    manifestVersion: 1,
    id: "gzh-design",
    name: "公众号排版",
    version: "1.0.0",
    description: "",
    keywords: [],
    capabilities: {
      skill: { entry: "SKILL.md" },
      viewer: { filePattern: "**/*.gzh.html", action: "html-preview" },
    },
  },
};

describe("PluginPreviewEntry", () => {
  beforeEach(() => {
    useInstalledPluginsMock.mockReturnValue([gzhPlugin]);
    requestPluginHtmlPreviewMock.mockClear();
  });

  it("renders an entry card and dispatches the preview request", () => {
    render(
      <PluginPreviewEntry
        value={'{ "plugin": "gzh-design", "file": "out/认真休息.gzh.html", "title": "认真休息" }'}
      />,
    );

    expect(screen.getByText("认真休息")).toBeTruthy();
    expect(screen.getByText("公众号排版")).toBeTruthy();
    fireEvent.click(screen.getByText("预览"));

    expect(requestPluginHtmlPreviewMock).toHaveBeenCalledWith({
      filePath: "out/认真休息.gzh.html",
      pluginId: "gzh-design",
      pluginName: "公众号排版",
      pattern: "**/*.gzh.html",
    });
  });

  it("matches by file pattern when the declared plugin id is unknown", () => {
    render(
      <PluginPreviewEntry value={'{ "plugin": "other", "file": "a.gzh.html" }'} />,
    );

    expect(screen.getByText("a.gzh.html")).toBeTruthy();
    expect(screen.getByText("预览")).toBeTruthy();
  });

  it("falls back to a plain code block for invalid payloads", () => {
    render(<PluginPreviewEntry value={"not json"} />);

    expect(screen.queryByText("预览")).toBeNull();
    expect(screen.getByText("not json")).toBeTruthy();
  });

  it("falls back when no installed plugin can serve the file", () => {
    useInstalledPluginsMock.mockReturnValue([]);
    render(<PluginPreviewEntry value={'{ "file": "a.gzh.html" }'} />);

    expect(screen.queryByText("预览")).toBeNull();
  });
});
