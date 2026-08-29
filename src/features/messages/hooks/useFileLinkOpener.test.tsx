// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MouseEvent } from "react";
import type { OpenAppTarget } from "../../../types";
import { useFileLinkOpener } from "./useFileLinkOpener";

const openerMocks = vi.hoisted(() => ({
  openPath: vi.fn(),
  revealInFileManager: vi.fn(),
  openWorkspaceIn: vi.fn(),
  pushErrorToast: vi.fn(),
  clipboardWriteText: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: openerMocks.openPath,
}));

vi.mock("../../../services/tauri", () => ({
  openWorkspaceIn: openerMocks.openWorkspaceIn,
  revealInFileManager: openerMocks.revealInFileManager,
}));

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: openerMocks.pushErrorToast,
}));

function makeOpenTarget(
  id: string,
  appName: string,
  args: string[] = [],
): OpenAppTarget {
  return {
    id,
    label: appName,
    kind: "app",
    appName,
    args,
  };
}

describe("useFileLinkOpener", () => {
  beforeEach(() => {
    openerMocks.openPath.mockReset();
    openerMocks.revealInFileManager.mockReset();
    openerMocks.openWorkspaceIn.mockReset();
    openerMocks.pushErrorToast.mockReset();
    openerMocks.clipboardWriteText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: openerMocks.clipboardWriteText,
      },
    });
  });

  it("builds a renderer-owned file link menu with the expected actions", async () => {
    openerMocks.openPath.mockResolvedValue(undefined);
    openerMocks.openWorkspaceIn.mockResolvedValue(undefined);
    openerMocks.revealInFileManager.mockResolvedValue(undefined);
    openerMocks.clipboardWriteText.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useFileLinkOpener(
        "/repo",
        [
          {
            id: "cursor",
            label: "Cursor",
            appName: "Cursor",
            kind: "app",
            command: null,
            args: ["--reuse-window"],
          },
        ],
        "cursor",
        null,
      ),
    );

    const event = {
      clientX: 12,
      clientY: 24,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    act(() => {
      result.current.showFileLinkMenu(
        event as unknown as MouseEvent,
        "src/main.ts#L7",
      );
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(result.current.fileLinkMenu?.label).toBe("File link actions");

    const items = result.current.fileLinkMenu?.items ?? [];
    expect(items.map((item) => (item.type === "item" ? item.label : item.type))).toEqual([
      "Open File",
      "Open in Cursor",
      "Reveal in File Manager",
      "Download Linked File",
      "Copy Link",
    ]);

    const [openFile, openConfiguredTarget, reveal, download, copyLink] = items;
    expect(download?.type).toBe("item");
    if (download?.type === "item") {
      expect(download.disabled).toBe(true);
    }

    if (openFile?.type === "item") {
      await act(async () => {
        await openFile.onSelect();
      });
    }
    expect(openerMocks.openPath).toHaveBeenCalledWith("/repo/src/main.ts");

    if (openConfiguredTarget?.type === "item") {
      await act(async () => {
        await openConfiguredTarget.onSelect();
      });
    }
    expect(openerMocks.openWorkspaceIn).toHaveBeenCalledWith("/repo/src/main.ts", {
      appName: "Cursor",
      args: ["--reuse-window"],
    });

    if (reveal?.type === "item") {
      await act(async () => {
        await reveal.onSelect();
      });
    }
    expect(openerMocks.revealInFileManager).toHaveBeenCalledWith("/repo/src/main.ts");

    if (copyLink?.type === "item") {
      await act(async () => {
        await copyLink.onSelect();
      });
    }
    expect(openerMocks.clipboardWriteText).toHaveBeenCalledWith("file:///repo/src/main.ts");
  });

  it("keeps link handlers stable when open target arrays are recreated", async () => {
    openerMocks.openPath.mockRejectedValue(new Error("native open unavailable"));
    openerMocks.openWorkspaceIn.mockResolvedValue(undefined);
    const firstTargets = [makeOpenTarget("vscode", "VS Code")];
    const nextTargets = [makeOpenTarget("cursor", "Cursor", ["--reuse-window"])];

    const { result, rerender } = renderHook(
      (props: {
        workspacePath: string;
        openTargets: OpenAppTarget[];
        selectedOpenAppId: string;
      }) =>
        useFileLinkOpener(
          props.workspacePath,
          props.openTargets,
          props.selectedOpenAppId,
          null,
        ),
      {
        initialProps: {
          workspacePath: "/workspace/old",
          openTargets: firstTargets,
          selectedOpenAppId: "vscode",
        },
      },
    );

    const firstOpenFileLink = result.current.openFileLink;
    const firstShowFileLinkMenu = result.current.showFileLinkMenu;

    rerender({
      workspacePath: "/workspace/current",
      openTargets: nextTargets,
      selectedOpenAppId: "cursor",
    });

    expect(result.current.openFileLink).toBe(firstOpenFileLink);
    expect(result.current.showFileLinkMenu).toBe(firstShowFileLinkMenu);

    await act(async () => {
      await result.current.openFileLink("src/App.tsx");
    });

    expect(openerMocks.openWorkspaceIn).toHaveBeenCalledWith(
      "/workspace/current/src/App.tsx",
      {
        appName: "Cursor",
        args: ["--reuse-window"],
      },
    );
  });

  it("opens Windows absolute file links without prefixing the workspace path", async () => {
    openerMocks.openPath.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useFileLinkOpener(
        "D:\\workspace",
        [makeOpenTarget("vscode", "VS Code")],
        "vscode",
        null,
      ),
    );

    await act(async () => {
      await result.current.openFileLink("D:\\outputs\\单页可编辑版PPTX.pptx#L3");
    });

    expect(openerMocks.openPath).toHaveBeenCalledWith(
      "D:\\outputs\\单页可编辑版PPTX.pptx",
    );
  });

  it("previews Windows absolute file links relative to the current Windows workspace", async () => {
    openerMocks.openPath.mockResolvedValue(undefined);
    const onOpenWorkspaceFile = vi.fn();
    const { result } = renderHook(() =>
      useFileLinkOpener(
        "D:\\AI\\AIchat\\突击队",
        [makeOpenTarget("vscode", "VS Code")],
        "vscode",
        onOpenWorkspaceFile,
      ),
    );

    await act(async () => {
      await result.current.openFileLink("D:\\AI\\AIchat\\突击队\\src\\main.ts#L3");
    });

    expect(onOpenWorkspaceFile).toHaveBeenCalledWith("src/main.ts");
    expect(openerMocks.openPath).not.toHaveBeenCalled();
  });

  it("opens external Windows absolute file links natively when a preview callback exists", async () => {
    openerMocks.openPath.mockResolvedValue(undefined);
    const onOpenWorkspaceFile = vi.fn();
    const { result } = renderHook(() =>
      useFileLinkOpener(
        "D:\\workspace",
        [makeOpenTarget("vscode", "VS Code")],
        "vscode",
        onOpenWorkspaceFile,
      ),
    );

    await act(async () => {
      await result.current.openFileLink("D:\\outputs\\单页可编辑版PPTX.pptx#L3");
    });

    expect(onOpenWorkspaceFile).not.toHaveBeenCalled();
    expect(openerMocks.openPath).toHaveBeenCalledWith(
      "D:\\outputs\\单页可编辑版PPTX.pptx",
    );
  });

  it("builds context menu actions from the latest open target config", () => {
    const firstTargets = [makeOpenTarget("vscode", "VS Code")];
    const nextTargets = [makeOpenTarget("cursor", "Cursor")];
    const { result, rerender } = renderHook(
      (props: { openTargets: OpenAppTarget[]; selectedOpenAppId: string }) =>
        useFileLinkOpener(
          "/workspace/current",
          props.openTargets,
          props.selectedOpenAppId,
          null,
        ),
      {
        initialProps: {
          openTargets: firstTargets,
          selectedOpenAppId: "vscode",
        },
      },
    );
    const firstShowFileLinkMenu = result.current.showFileLinkMenu;

    rerender({
      openTargets: nextTargets,
      selectedOpenAppId: "cursor",
    });

    expect(result.current.showFileLinkMenu).toBe(firstShowFileLinkMenu);

    act(() => {
      result.current.showFileLinkMenu(
        {
          clientX: 12,
          clientY: 24,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as unknown as MouseEvent,
        "src/App.tsx",
      );
    });

    const configuredTargetAction = result.current.fileLinkMenu?.items.find(
      (item) =>
        item.type === "item" &&
        item.id === "open-configured-target",
    );
    expect(
      configuredTargetAction && "label" in configuredTargetAction
        ? configuredTargetAction.label
        : null,
    ).toBe("Open in Cursor");
  });

  it("recovers markdown-wrapped Windows hrefs before revealing", async () => {
    openerMocks.revealInFileManager.mockResolvedValue(undefined);
    const windowsPath = "D:/AI/Alchat/突击队/输出/report.md";
    const { result } = renderHook(() =>
      useFileLinkOpener(
        "D:/AI/Alchat/突击队",
        [makeOpenTarget("vscode", "Visual Studio Code")],
        "vscode",
        null,
      ),
    );

    act(() => {
      result.current.showFileLinkMenu(
        {
          clientX: 12,
          clientY: 24,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as unknown as MouseEvent,
        `/[${windowsPath}] (codex-file:${windowsPath})`,
      );
    });
    const reveal = result.current.fileLinkMenu?.items.find(
      (item) => item.type === "item" && item.id === "reveal",
    );
    if (reveal?.type !== "item") {
      throw new Error("Missing reveal action");
    }
    await act(async () => reveal.onSelect());

    expect(openerMocks.revealInFileManager).toHaveBeenCalledWith(windowsPath);
  });
});
