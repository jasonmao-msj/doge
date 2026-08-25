// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, renderHook, waitFor } from "@testing-library/react";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  getThreadSelectDiffCleanupAction,
  shouldCollapseRightPanelOnThreadSelect,
  shouldPreserveEditorOnThreadSelect,
} from "./threadEditorPreservation";
import { pushErrorToast } from "../services/toasts";
import { useAppShellLayoutNodesSection } from "./useAppShellLayoutNodesSection";
import {
  publishAccountEngineReadyV1,
  requestAccountEngineSwitchV1,
} from "../features/account/runtime/engineSwitchSignal";

const { activateAccountEngineMock } = vi.hoisted(() => ({
  activateAccountEngineMock: vi.fn(),
}));

vi.mock("../services/accountEngineCommands", () => ({
  activateAccountEngineV1: activateAccountEngineMock,
}));

const pushErrorToastMock = vi.mocked(pushErrorToast);

// The wrapper behavior tests render the real section hook with a minimal
// `as any` input. Heavy child hooks that are irrelevant to the quick switcher
// wrapper (and would need a full app-shell context) are replaced with inert
// doubles; the wrapper `handleQuickSwitcherNavigate` itself stays real.
vi.mock("../features/layout/hooks/useLayoutNodes", () => ({
  useLayoutNodes: () => ({}),
}));
vi.mock("../features/app/components/MainHeaderActions", () => ({
  useMainHeaderActionItems: () => [],
}));
vi.mock("../features/app/hooks/useModuleViewShortcuts", () => ({
  useModuleViewShortcuts: () => {},
}));
vi.mock("../features/project-map/hooks/useProjectMapDataset", () => ({
  useProjectMapDataset: () => ({}),
}));
vi.mock("../features/client-ui-visibility/hooks/useClientUiVisibility", () => ({
  useClientUiVisibility: () => ({ isControlVisible: () => false }),
}));
vi.mock("../features/browser-agent/browserAgentDockWindow", () => ({
  openOrFocusBrowserAgentDockWindow: vi.fn(async () => "created"),
}));
vi.mock("../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

const currentDir = dirname(fileURLToPath(import.meta.url));

const layoutNodesDomainNames = [
  "workspace",
  "runtime",
  "chrome",
  "editor",
  "git",
  "composer",
  "panels",
] as const;

function getPropertyNameText(
  name: ts.PropertyName,
  sourceFile: ts.SourceFile,
): string {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }

  return name.getText(sourceFile);
}

function getUseLayoutNodesGroupKeys(): Map<string, string[]> {
  const filePath = join(currentDir, "useAppShellLayoutNodesSection.tsx");
  const source = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let result: Map<string, string[]> | null = null;

  const visit = (node: ts.Node): void => {
    if (
      result ||
      !ts.isCallExpression(node) ||
      node.expression.getText(sourceFile) !== "useLayoutNodes"
    ) {
      ts.forEachChild(node, visit);
      return;
    }

    const [argument] = node.arguments;
    if (!argument || !ts.isObjectLiteralExpression(argument)) {
      throw new Error("useLayoutNodes must receive an object literal.");
    }

    const groups = new Map<string, string[]>();
    for (const property of argument.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        !ts.isObjectLiteralExpression(property.initializer)
      ) {
        continue;
      }

      const groupName = getPropertyNameText(property.name, sourceFile);
      const keys: string[] = [];
      for (const groupProperty of property.initializer.properties) {
        if (ts.isShorthandPropertyAssignment(groupProperty)) {
          keys.push(groupProperty.name.text);
          continue;
        }

        if (
          ts.isPropertyAssignment(groupProperty) ||
          ts.isMethodDeclaration(groupProperty)
        ) {
          keys.push(getPropertyNameText(groupProperty.name, sourceFile));
        }
      }

      groups.set(groupName, keys);
    }

    result = groups;
  };

  visit(sourceFile);

  if (!result) {
    throw new Error("useLayoutNodes call was not found.");
  }

  return result;
}

describe("shouldPreserveEditorOnThreadSelect", () => {
  it("preserves desktop editor when selecting another thread in the same workspace", () => {
    expect(
      shouldPreserveEditorOnThreadSelect({
        isCompact: false,
        centerMode: "editor",
        activeWorkspaceId: "workspace-1",
        targetWorkspaceId: "workspace-1",
        activeEditorFilePath: "src/App.tsx",
      }),
    ).toBe(true);
  });

  it("falls back to chat outside the same desktop editor workspace", () => {
    const base = {
      isCompact: false,
      centerMode: "editor" as const,
      activeWorkspaceId: "workspace-1",
      targetWorkspaceId: "workspace-1",
      activeEditorFilePath: "src/App.tsx",
    };

    expect(
      shouldPreserveEditorOnThreadSelect({
        ...base,
        targetWorkspaceId: "workspace-2",
      }),
    ).toBe(false);
    expect(
      shouldPreserveEditorOnThreadSelect({
        ...base,
        centerMode: "chat",
      }),
    ).toBe(false);
    expect(
      shouldPreserveEditorOnThreadSelect({
        ...base,
        activeEditorFilePath: null,
      }),
    ).toBe(false);
    expect(
      shouldPreserveEditorOnThreadSelect({
        ...base,
        isCompact: true,
      }),
    ).toBe(false);
  });
});

describe("getThreadSelectDiffCleanupAction", () => {
  it("does not exit diff view when thread selection preserves the editor split", () => {
    expect(getThreadSelectDiffCleanupAction(true)).toBe("clear-selected-diff");
  });

  it("keeps the existing full diff exit behavior when editor split is not preserved", () => {
    expect(getThreadSelectDiffCleanupAction(false)).toBe("exit-diff-view");
  });
});

describe("shouldCollapseRightPanelOnThreadSelect", () => {
  it("keeps right-side surfaces stable while preserving the editor", () => {
    expect(
      shouldCollapseRightPanelOnThreadSelect({
        preserveEditor: true,
        requestedCollapse: true,
      }),
    ).toBe(false);
  });

  it("honors requested collapse when editor preservation is not active", () => {
    expect(
      shouldCollapseRightPanelOnThreadSelect({
        preserveEditor: false,
        requestedCollapse: true,
      }),
    ).toBe(true);
  });
});

describe("useAppShellLayoutNodesSection adapter contract", () => {
  it("passes grouped domain bags into useLayoutNodes instead of a flat option list", () => {
    const groups = getUseLayoutNodesGroupKeys();
    const duplicateKeys: string[] = [];
    const seenKeys = new Set<string>();

    for (const keys of groups.values()) {
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        if (seenKeys.has(key)) {
          duplicateKeys.push(key);
          continue;
        }

        seenKeys.add(key);
      }
    }

    expect([...groups.keys()]).toEqual([...layoutNodesDomainNames]);
    expect(duplicateKeys).toEqual([]);
    expect(groups.get("workspace")).toContain("workspaces");
    expect(groups.get("runtime")).toContain("activeItems");
    expect(groups.get("composer")).toContain("onSend");
  });

  it("forwards Project Map toggle state into useLayoutNodes despite ts-nocheck", () => {
    const source = readFileSync(
      join(currentDir, "useAppShellLayoutNodesSection.tsx"),
      "utf8",
    );
    const layoutNodesOptions = source.slice(
      source.indexOf("} = useLayoutNodes({"),
      source.indexOf(
        "  const runSelectedPath",
        source.indexOf("} = useLayoutNodes({"),
      ),
    );

    expect(layoutNodesOptions).toContain("centerMode,");
    expect(layoutNodesOptions).toContain("setCenterMode,");
    expect(layoutNodesOptions).toContain("editorSplitCompanion,");
    expect(layoutNodesOptions).toContain("setEditorSplitCompanion,");
  });

  it("owns and forwards Sidebar session visibility and folder draft state", () => {
    const source = readFileSync(
      join(currentDir, "useAppShellLayoutNodesSection.tsx"),
      "utf8",
    );

    expect(source).toContain("useExitedSessionVisibility");
    expect(source).toContain("isExitedSessionsHidden,");
    expect(source).toContain("onToggleExitedSessionsHidden:");
    expect(source).toContain("rootSessionFolderDraftRequestByWorkspaceId");
    expect(source).toContain("onRequestRootSessionFolderDraft,");
  });

  it("forwards file compare panel node from useLayoutNodes to the renderer context", () => {
    const source = readFileSync(
      join(currentDir, "useAppShellLayoutNodesSection.tsx"),
      "utf8",
    );
    const layoutNodesResult = source.slice(
      source.indexOf("  const {"),
      source.indexOf("  } = useLayoutNodes({"),
    );
    const returnedContext = source.slice(
      source.lastIndexOf("  return {"),
      source.lastIndexOf("};"),
    );

    expect(layoutNodesResult).toContain("fileComparePanelNode,");
    expect(returnedContext).toContain("fileComparePanelNode,");
  });

  it("collapses the left conversation sidebar before opening Project Map", () => {
    const source = readFileSync(
      join(currentDir, "useAppShellLayoutNodesSection.tsx"),
      "utf8",
    );
    const projectMapHandler = source.slice(
      source.indexOf("const handleOpenProjectMap = useEventCallback(() => {"),
      source.indexOf(
        "const handleGitSelectPullRequest",
        source.indexOf("const handleOpenProjectMap = useEventCallback(() => {"),
      ),
    );

    expect(projectMapHandler).toContain("closeSettings();");
    expect(projectMapHandler).toContain("collapseSidebar();");
    expect(projectMapHandler.indexOf("collapseSidebar();")).toBeLessThan(
      projectMapHandler.indexOf('setCenterMode("projectMap");'),
    );
  });

  it("routes quick switcher visual tools through canonical open actions", () => {
    const source = readFileSync(
      join(currentDir, "useAppShellLayoutNodesSection.tsx"),
      "utf8",
    );
    const handler = source.slice(
      source.indexOf("const handleQuickSwitcherNavigate = useEventCallback("),
      source.indexOf(
        "const handleGitSelectPullRequest",
        source.indexOf("const handleQuickSwitcherNavigate = useEventCallback("),
      ),
    );

    expect(handler).toContain('target === "spec"');
    expect(handler).toContain("handleOpenSpecHub();");
    expect(handler).toContain('target === "intentCanvas"');
    expect(handler).toContain("handleOpenIntentCanvas();");
    expect(handler).toContain('target === "projectMap"');
    expect(handler).toContain("handleOpenProjectMap();");
    expect(handler).not.toContain('setActiveTab("spec")');
  });

  it("routes quick switcher discovery entries through canonical open actions", () => {
    const source = readFileSync(
      join(currentDir, "useAppShellLayoutNodesSection.tsx"),
      "utf8",
    );
    const handler = source.slice(
      source.indexOf("const handleQuickSwitcherNavigate = useEventCallback("),
      source.indexOf(
        "const handleGitSelectPullRequest",
        source.indexOf("const handleQuickSwitcherNavigate = useEventCallback("),
      ),
    );

    expect(handler).toContain('target === "globalSearch"');
    expect(handler).toContain("handleOpenSearchPalette();");
    expect(handler).toContain('target === "notes"');
    expect(handler).toContain("handleOpenNotes();");
    expect(handler).toContain('target === "memory"');
    expect(handler).toContain("handleOpenProjectMemory();");
    // Each intercepted target closes the switcher before firing the canonical
    // open action, matching the spec/intentCanvas/projectMap branches.
    const closeCount = handler.split("closeQuickSwitcher();").length - 1;
    expect(closeCount).toBeGreaterThanOrEqual(6);
    // Unintercepted targets still delegate to the base handler.
    expect(handler).toContain("handleBaseQuickSwitcherNavigate(target);");
  });

  it("wires every configurable module shortcut to an existing view handler", () => {
    const source = readFileSync(
      join(currentDir, "useAppShellLayoutNodesSection.tsx"),
      "utf8",
    );
    const shortcutHook = source.slice(
      source.indexOf("useModuleViewShortcuts({"),
      source.indexOf("  const {", source.indexOf("useModuleViewShortcuts({")),
    );

    expect(shortcutHook).toContain(
      "toggleGitGraphShortcut: appSettings.toggleGitGraphShortcut",
    );
    expect(shortcutHook).toContain(
      "onToggleGitGraph: handleOpenGitHistoryPanel",
    );
    expect(shortcutHook).toContain("onOpenNotes: handleOpenNotes");
    expect(shortcutHook).toContain(
      "onOpenIntentCanvas: handleOpenIntentCanvas",
    );
    expect(shortcutHook).toContain("onOpenRadar: handleOpenRadar");
    expect(shortcutHook).toContain("onOpenProjectMap: handleOpenProjectMap");
    expect(shortcutHook).toContain(
      "onOpenBrowserDock: handleToggleBrowserDock",
    );
    expect(shortcutHook).toContain(
      "onOpenFileCompare: handleOpenScratchFileCompare",
    );
  });

  it("routes message-tail fork through message anchored fork with provider options", () => {
    const source = readFileSync(
      join(currentDir, "useAppShellLayoutNodesSection.tsx"),
      "utf8",
    );
    const forkHandler = source.slice(
      source.indexOf("const handleForkFromMessage = useEventCallback("),
      source.indexOf(
        "const handleCodexAutoCompactionSettingsChange",
        source.indexOf("const handleForkFromMessage = useEventCallback("),
      ),
    );

    expect(forkHandler).toContain("forkSessionFromMessageForWorkspace");
    expect(forkHandler).toContain("messageId");
    expect(forkHandler).toContain('mode: "messages-only"');
    expect(forkHandler).toContain('operation: "fork"');
    expect(forkHandler).toContain(
      "providerProfileId: options?.providerProfileId ?? null",
    );
    expect(forkHandler).toContain(
      "providerProfile: options?.providerProfile ?? null",
    );
    expect(forkHandler).toContain(
      'throw new Error("Fork did not return a child conversation.")',
    );
    expect(forkHandler).not.toContain("updateThreadParent(");
    expect(forkHandler).not.toContain('await startFork("/fork");');
    expect(forkHandler).not.toContain(
      "forkClaudeSessionFromMessageForWorkspace",
    );
  });
});

describe("useAppShellLayoutNodesSection quick switcher wrapper behavior", () => {
  function createQuickSwitcherWrapperFixture(
    stateOverrides: Record<string, any> = {},
  ) {
    const closeQuickSwitcher = vi.fn();
    const handleOpenSearchPalette = vi.fn();
    const handleToggleSearchPalette = vi.fn();
    const handleBaseQuickSwitcherNavigate = vi.fn();
    const handleOpenSpecHub = vi.fn();
    const handleOpenHomeChat = vi.fn();
    const setActiveEngine = vi.fn(async () => undefined);
    // 首页表面 state：拦截 action（含回切）执行前统一关闭，提示/委托分支除外。
    const setHomeOpen = vi.fn();
    const setWorkspaceHomeWorkspaceId = vi.fn();
    // Terminal shell effects used by the internal canonical open handlers
    // (handleOpenNotes / handleOpenProjectMemory compose these ctx actions).
    const closeSettings = vi.fn();
    const collapseRightPanel = vi.fn();
    const collapseSidebar = vi.fn();
    const setAppMode = vi.fn();
    const setCenterMode = vi.fn();
    const setFilePanelMode = vi.fn();
    const expandRightPanel = vi.fn();
    const setActiveTab = vi.fn();
    const handleActivateGitHistoryTab = vi.fn();
    // Minimal render-time context: only values the hook dereferences during
    // render (verified against the options/return blocks) plus the quick
    // switcher wiring under test. Everything else stays undefined on purpose.
    // stateOverrides carries the D1 判定口径快照（filePanelMode/appMode/
    // centerMode/rightPanelCollapsed/settingsOpen/isSearchPaletteOpen/
    // activeWorkspace/activeTab/isCompact）per test case.
    const input = {
      appShellDomainContexts: {
        runtimeContext: { runtimeRunState: {} },
      },
      searchAndComposerSection: {
        appSettings: {},
        workspaceGroups: [],
        gitStatus: {},
        launchScriptState: {},
        sidebarToggleProps: {},
        hydratedThreadListWorkspaceIds: new Set<string>(),
        hydratedThreadListWorkspaceIdsRef: { current: new Set<string>() },
        t: (key: string) => key,
        isCompact: false,
        closeQuickSwitcher,
        handleQuickSwitcherNavigate: handleBaseQuickSwitcherNavigate,
        handleOpenSearchPalette,
        handleToggleSearchPalette,
        handleOpenSpecHub,
        handleOpenHomeChat,
        setActiveEngine,
        setHomeOpen,
        setWorkspaceHomeWorkspaceId,
        closeSettings,
        collapseRightPanel,
        collapseSidebar,
        setAppMode,
        setCenterMode,
        setFilePanelMode,
        expandRightPanel,
        setActiveTab,
        handleActivateGitHistoryTab,
        // D1 状态默认值：全部「未激活」（右侧面板收起、chat 落点、无弹窗）。
        activeWorkspace: { id: "workspace-1", name: "Alpha" },
        activeWorkspaceId: "workspace-1",
        activeTab: "codex",
        appMode: "chat",
        centerMode: "chat",
        filePanelMode: "files",
        rightPanelCollapsed: true,
        settingsOpen: false,
        isSearchPaletteOpen: false,
        ...stateOverrides,
      },
      sections: {},
      isPullRequestComposer: false,
      isPullRequestComposerFromSections: false,
    } as any;
    return {
      input,
      closeQuickSwitcher,
      handleOpenSearchPalette,
      handleToggleSearchPalette,
      handleBaseQuickSwitcherNavigate,
      handleOpenHomeChat,
      setActiveEngine,
      setHomeOpen,
      setWorkspaceHomeWorkspaceId,
      closeSettings,
      collapseRightPanel,
      collapseSidebar,
      setAppMode,
      setCenterMode,
      setFilePanelMode,
      expandRightPanel,
      setActiveTab,
      handleActivateGitHistoryTab,
    };
  }

  it("opens a fresh target-engine conversation after account preparation commits", async () => {
    const fixture = createQuickSwitcherWrapperFixture();
    renderHook(() => useAppShellLayoutNodesSection(fixture.input));

    act(() => publishAccountEngineReadyV1({
      engineId: "claude-code",
      openNewConversation: true,
    }));

    await waitFor(() => expect(fixture.setActiveEngine).toHaveBeenCalledWith("claude"));
    expect(fixture.closeSettings).toHaveBeenCalled();
    expect(fixture.handleOpenHomeChat).toHaveBeenCalled();
  });

  it("activates a requested Codex engine before publishing the ready switch", async () => {
    activateAccountEngineMock.mockResolvedValue(undefined);
    const fixture = createQuickSwitcherWrapperFixture();
    renderHook(() => useAppShellLayoutNodesSection(fixture.input));

    act(() => requestAccountEngineSwitchV1({
      source: "enginePicker",
      targetEngineId: "codex",
      openNewConversation: true,
    }));

    await waitFor(() => expect(activateAccountEngineMock).toHaveBeenCalledWith("codex"));
    await waitFor(() => expect(fixture.setActiveEngine).toHaveBeenCalledWith("codex"));
    expect(fixture.closeSettings).toHaveBeenCalled();
    expect(fixture.handleOpenHomeChat).toHaveBeenCalled();
  });

  it("intercepts discovery targets with canonical actions after closing the switcher", () => {
    const fixture = createQuickSwitcherWrapperFixture();
    const { result } = renderHook(() =>
      useAppShellLayoutNodesSection(fixture.input),
    );

    // Each case pins the distinguishing terminal effect of the branch's
    // canonical open action:
    // - globalSearch -> ctx handleOpenSearchPalette (direct canonical action)
    // - notes        -> internal handleOpenNotes composing setCenterMode("notes")
    // - memory       -> internal handleOpenProjectMemory composing
    //   setFilePanelMode("memory")
    const cases = [
      {
        target: "globalSearch",
        marker: fixture.handleOpenSearchPalette,
        markerArg: undefined,
      },
      { target: "notes", marker: fixture.setCenterMode, markerArg: "notes" },
      { target: "memory", marker: fixture.setFilePanelMode, markerArg: "memory" },
    ] as const;

    for (const { target, marker, markerArg } of cases) {
      const markerCallsBefore = marker.mock.calls.length;
      const closeCallsBefore = fixture.closeQuickSwitcher.mock.calls.length;

      act(() => result.current.handleQuickSwitcherNavigate(target));

      // The canonical action fires exactly once for this branch.
      expect(marker.mock.calls.length).toBe(markerCallsBefore + 1);
      if (markerArg !== undefined) {
        expect(marker).toHaveBeenLastCalledWith(markerArg);
      }
      // This branch closed the switcher exactly once, before the canonical
      // open action fired.
      expect(fixture.closeQuickSwitcher.mock.calls.length).toBe(
        closeCallsBefore + 1,
      );
      const closeOrder =
        fixture.closeQuickSwitcher.mock.invocationCallOrder[
          fixture.closeQuickSwitcher.mock.calls.length - 1
        ];
      const markerOrder =
        marker.mock.invocationCallOrder[marker.mock.calls.length - 1];
      expect(closeOrder).toBeDefined();
      expect(closeOrder!).toBeLessThan(markerOrder!);
      // Intercepted targets never fall through to the base section handler.
      expect(fixture.handleBaseQuickSwitcherNavigate).not.toHaveBeenCalled();
    }
    expect(fixture.closeQuickSwitcher).toHaveBeenCalledTimes(cases.length);
    // notes/memory canonical handlers share the composed panel-opening tail.
    expect(fixture.closeSettings).toHaveBeenCalledTimes(2);
    expect(fixture.expandRightPanel).toHaveBeenCalledTimes(2);
  });

  it("delegates unintercepted targets to the base quick switcher handler", () => {
    const fixture = createQuickSwitcherWrapperFixture();
    const { result } = renderHook(() =>
      useAppShellLayoutNodesSection(fixture.input),
    );

    act(() => result.current.handleQuickSwitcherNavigate("chat"));

    expect(fixture.handleBaseQuickSwitcherNavigate).toHaveBeenCalledTimes(1);
    expect(fixture.handleBaseQuickSwitcherNavigate).toHaveBeenCalledWith(
      "chat",
    );
    expect(fixture.closeQuickSwitcher).not.toHaveBeenCalled();
    expect(fixture.handleOpenSearchPalette).not.toHaveBeenCalled();
    expect(fixture.closeSettings).not.toHaveBeenCalled();
    expect(fixture.setCenterMode).not.toHaveBeenCalled();
    expect(fixture.setFilePanelMode).not.toHaveBeenCalled();
  });

  it("closes the home surface before intercepted actions, but not for hint-only or base-delegated branches", () => {
    // open action 分支（notes）：home 关闭先于 canonical open action。
    const openFixture = createQuickSwitcherWrapperFixture();
    const { result: openResult } = renderHook(() =>
      useAppShellLayoutNodesSection(openFixture.input),
    );
    act(() => openResult.current.handleQuickSwitcherNavigate("notes"));
    expect(openFixture.setHomeOpen).toHaveBeenCalledWith(false);
    expect(openFixture.setWorkspaceHomeWorkspaceId).toHaveBeenCalledWith(null);
    const notesOpenOrder =
      openFixture.setCenterMode.mock.invocationCallOrder[0];
    expect(openFixture.setHomeOpen.mock.invocationCallOrder[0]).toBeLessThan(
      notesOpenOrder,
    );
    expect(
      openFixture.setWorkspaceHomeWorkspaceId.mock.invocationCallOrder[0],
    ).toBeLessThan(notesOpenOrder);

    // 回切分支（memory 已开 → collapseRightPanel）同样先关 home。
    const toggleFixture = createQuickSwitcherWrapperFixture({
      filePanelMode: "memory",
      rightPanelCollapsed: false,
    });
    const { result: toggleResult } = renderHook(() =>
      useAppShellLayoutNodesSection(toggleFixture.input),
    );
    act(() => toggleResult.current.handleQuickSwitcherNavigate("memory"));
    expect(toggleFixture.setHomeOpen).toHaveBeenCalledWith(false);
    expect(toggleFixture.setWorkspaceHomeWorkspaceId).toHaveBeenCalledWith(
      null,
    );
    expect(toggleFixture.collapseRightPanel).toHaveBeenCalledTimes(1);

    // history toggle 分支（现成 toggle 也属于拦截 action）。
    const historyFixture = createQuickSwitcherWrapperFixture({
      appMode: "gitHistory",
    });
    const { result: historyResult } = renderHook(() =>
      useAppShellLayoutNodesSection(historyFixture.input),
    );
    act(() => historyResult.current.handleQuickSwitcherNavigate("history"));
    expect(historyFixture.setHomeOpen).toHaveBeenCalledWith(false);
    expect(historyFixture.handleActivateGitHistoryTab).toHaveBeenCalledTimes(1);

    // spec open-or-focus 分支（独立窗口）也统一关 home，保持主窗口落点一致。
    const specFixture = createQuickSwitcherWrapperFixture();
    const { result: specResult } = renderHook(() =>
      useAppShellLayoutNodesSection(specFixture.input),
    );
    act(() => specResult.current.handleQuickSwitcherNavigate("spec"));
    expect(specFixture.setHomeOpen).toHaveBeenCalledWith(false);
    expect(specFixture.setWorkspaceHomeWorkspaceId).toHaveBeenCalledWith(null);

    // 提示分支（无 workspace toast）不打开模块，不关 home（toast 在 home 之上可见）。
    pushErrorToastMock.mockClear();
    const hintFixture = createQuickSwitcherWrapperFixture({
      activeWorkspace: null,
      activeWorkspaceId: null,
    });
    const { result: hintResult } = renderHook(() =>
      useAppShellLayoutNodesSection(hintFixture.input),
    );
    act(() => hintResult.current.handleQuickSwitcherNavigate("intentCanvas"));
    expect(pushErrorToastMock).toHaveBeenCalledTimes(1);
    expect(hintFixture.setHomeOpen).not.toHaveBeenCalled();
    expect(hintFixture.setWorkspaceHomeWorkspaceId).not.toHaveBeenCalled();

    // 委托 base 的分支由 base handler 入口统一关闭 home，wrapper 不重复调用。
    const delegateFixture = createQuickSwitcherWrapperFixture();
    const { result: delegateResult } = renderHook(() =>
      useAppShellLayoutNodesSection(delegateFixture.input),
    );
    act(() => delegateResult.current.handleQuickSwitcherNavigate("chat"));
    expect(delegateFixture.handleBaseQuickSwitcherNavigate).toHaveBeenCalledWith(
      "chat",
    );
    expect(delegateFixture.setHomeOpen).not.toHaveBeenCalled();
    expect(delegateFixture.setWorkspaceHomeWorkspaceId).not.toHaveBeenCalled();
  });

  // —— design.md D1：逐入口「未开 → open」「已开 → 回切」行为级覆盖 ——

  it("toggles files/git off via collapseRightPanel when the panel is already open", () => {
    for (const target of ["files", "git"] as const) {
      const fixture = createQuickSwitcherWrapperFixture({
        filePanelMode: target,
        rightPanelCollapsed: false,
      });
      const { result } = renderHook(() =>
        useAppShellLayoutNodesSection(fixture.input),
      );

      act(() => result.current.handleQuickSwitcherNavigate(target));

      expect(fixture.collapseRightPanel).toHaveBeenCalledTimes(1);
      expect(fixture.closeQuickSwitcher).toHaveBeenCalledTimes(1);
      // 已开分支不委托 base open action。
      expect(fixture.handleBaseQuickSwitcherNavigate).not.toHaveBeenCalled();
      expect(fixture.setFilePanelMode).not.toHaveBeenCalled();
    }
  });

  it("delegates files/git to the base open action when the panel is not active", () => {
    for (const target of ["files", "git"] as const) {
      // 默认态：filePanelMode 相同但右侧面板已收起 → 未激活。
      const fixture = createQuickSwitcherWrapperFixture({
        filePanelMode: target,
        rightPanelCollapsed: true,
      });
      const { result } = renderHook(() =>
        useAppShellLayoutNodesSection(fixture.input),
      );

      act(() => result.current.handleQuickSwitcherNavigate(target));

      expect(fixture.handleBaseQuickSwitcherNavigate).toHaveBeenCalledTimes(1);
      expect(fixture.handleBaseQuickSwitcherNavigate).toHaveBeenCalledWith(
        target,
      );
      expect(fixture.collapseRightPanel).not.toHaveBeenCalled();
      expect(fixture.closeQuickSwitcher).not.toHaveBeenCalled();
    }
  });

  it("uses the compact-layout predicate (activeTab git + panel mode) for panel entries", () => {
    // compact 已开：activeTab === "git" 且 filePanelMode 命中 → 回切。
    const activeFixture = createQuickSwitcherWrapperFixture({
      isCompact: true,
      activeTab: "git",
      filePanelMode: "git",
      rightPanelCollapsed: true,
    });
    const { result: activeResult } = renderHook(() =>
      useAppShellLayoutNodesSection(activeFixture.input),
    );
    act(() => activeResult.current.handleQuickSwitcherNavigate("git"));
    expect(activeFixture.collapseRightPanel).toHaveBeenCalledTimes(1);
    expect(activeFixture.handleBaseQuickSwitcherNavigate).not.toHaveBeenCalled();

    // compact 未开：面板 mode 命中但 activeTab 不在 git → 委托 base 打开。
    const inactiveFixture = createQuickSwitcherWrapperFixture({
      isCompact: true,
      activeTab: "codex",
      filePanelMode: "git",
      rightPanelCollapsed: false,
    });
    const { result: inactiveResult } = renderHook(() =>
      useAppShellLayoutNodesSection(inactiveFixture.input),
    );
    act(() => inactiveResult.current.handleQuickSwitcherNavigate("git"));
    expect(inactiveFixture.handleBaseQuickSwitcherNavigate).toHaveBeenCalledWith(
      "git",
    );
    expect(inactiveFixture.collapseRightPanel).not.toHaveBeenCalled();
  });

  it("toggles notes off with collapseRightPanel plus a center-mode reset", () => {
    const fixture = createQuickSwitcherWrapperFixture({
      filePanelMode: "notes",
      rightPanelCollapsed: false,
      centerMode: "notes",
    });
    const { result } = renderHook(() =>
      useAppShellLayoutNodesSection(fixture.input),
    );

    act(() => result.current.handleQuickSwitcherNavigate("notes"));

    expect(fixture.collapseRightPanel).toHaveBeenCalledTimes(1);
    // 便签回切连带把 center mode 复位到 chat（不留残留态）。
    expect(fixture.setCenterMode).toHaveBeenCalledWith("chat");
    expect(fixture.closeQuickSwitcher).toHaveBeenCalledTimes(1);
    expect(fixture.expandRightPanel).not.toHaveBeenCalled();
  });

  it("toggles memory off with collapseRightPanel only", () => {
    const fixture = createQuickSwitcherWrapperFixture({
      filePanelMode: "memory",
      rightPanelCollapsed: false,
    });
    const { result } = renderHook(() =>
      useAppShellLayoutNodesSection(fixture.input),
    );

    act(() => result.current.handleQuickSwitcherNavigate("memory"));

    expect(fixture.collapseRightPanel).toHaveBeenCalledTimes(1);
    expect(fixture.setCenterMode).not.toHaveBeenCalled();
    expect(fixture.closeQuickSwitcher).toHaveBeenCalledTimes(1);
    expect(fixture.expandRightPanel).not.toHaveBeenCalled();
  });

  it("toggles kanban via setAppMode and delegates the open path to base", () => {
    const openFixture = createQuickSwitcherWrapperFixture({
      appMode: "kanban",
    });
    const { result: openResult } = renderHook(() =>
      useAppShellLayoutNodesSection(openFixture.input),
    );
    act(() => openResult.current.handleQuickSwitcherNavigate("kanban"));
    expect(openFixture.setAppMode).toHaveBeenCalledWith("chat");
    expect(openFixture.closeQuickSwitcher).toHaveBeenCalledTimes(1);
    expect(openFixture.handleBaseQuickSwitcherNavigate).not.toHaveBeenCalled();

    const closedFixture = createQuickSwitcherWrapperFixture({
      appMode: "chat",
    });
    const { result: closedResult } = renderHook(() =>
      useAppShellLayoutNodesSection(closedFixture.input),
    );
    act(() => closedResult.current.handleQuickSwitcherNavigate("kanban"));
    expect(closedFixture.handleBaseQuickSwitcherNavigate).toHaveBeenCalledWith(
      "kanban",
    );
    expect(closedFixture.setAppMode).not.toHaveBeenCalled();
  });

  it("routes history through the existing gitHistory toggle in both directions", () => {
    for (const appMode of ["chat", "gitHistory"] as const) {
      const fixture = createQuickSwitcherWrapperFixture({ appMode });
      const { result } = renderHook(() =>
        useAppShellLayoutNodesSection(fixture.input),
      );

      act(() => result.current.handleQuickSwitcherNavigate("history"));

      // 现成 toggle：先激活 Git Graph tab，再以函数式 setAppMode 翻转。
      expect(fixture.handleActivateGitHistoryTab).toHaveBeenCalledTimes(1);
      expect(fixture.setAppMode).toHaveBeenCalledTimes(1);
      const toggler = fixture.setAppMode.mock.calls[0]![0] as (
        current: string,
      ) => string;
      expect(typeof toggler).toBe("function");
      expect(toggler(appMode)).toBe(
        appMode === "gitHistory" ? "chat" : "gitHistory",
      );
      expect(fixture.closeQuickSwitcher).toHaveBeenCalledTimes(1);
      expect(fixture.handleBaseQuickSwitcherNavigate).not.toHaveBeenCalled();
    }
  });

  it("closes settings when already open and delegates the open path to base", () => {
    const openFixture = createQuickSwitcherWrapperFixture({
      settingsOpen: true,
    });
    const { result: openResult } = renderHook(() =>
      useAppShellLayoutNodesSection(openFixture.input),
    );
    act(() => openResult.current.handleQuickSwitcherNavigate("settings"));
    expect(openFixture.closeSettings).toHaveBeenCalledTimes(1);
    expect(openFixture.closeQuickSwitcher).toHaveBeenCalledTimes(1);
    expect(openFixture.handleBaseQuickSwitcherNavigate).not.toHaveBeenCalled();

    const closedFixture = createQuickSwitcherWrapperFixture({
      settingsOpen: false,
    });
    const { result: closedResult } = renderHook(() =>
      useAppShellLayoutNodesSection(closedFixture.input),
    );
    act(() => closedResult.current.handleQuickSwitcherNavigate("settings"));
    expect(closedFixture.handleBaseQuickSwitcherNavigate).toHaveBeenCalledWith(
      "settings",
    );
    expect(closedFixture.closeSettings).not.toHaveBeenCalled();
  });

  it("toggles global search off via the palette toggle when already open", () => {
    const fixture = createQuickSwitcherWrapperFixture({
      isSearchPaletteOpen: true,
    });
    const { result } = renderHook(() =>
      useAppShellLayoutNodesSection(fixture.input),
    );

    act(() => result.current.handleQuickSwitcherNavigate("globalSearch"));

    expect(fixture.handleToggleSearchPalette).toHaveBeenCalledTimes(1);
    expect(fixture.handleOpenSearchPalette).not.toHaveBeenCalled();
    expect(fixture.closeQuickSwitcher).toHaveBeenCalledTimes(1);
  });

  it("toggles intent canvas and project map back to the chat landing", () => {
    const cases = [
      { target: "intentCanvas", openMarker: "intentCanvas" },
      { target: "projectMap", openMarker: "projectMap" },
    ] as const;

    for (const { target, openMarker } of cases) {
      // 已开 → setCenterMode("chat") 回切。
      const activeFixture = createQuickSwitcherWrapperFixture({
        centerMode: openMarker,
      });
      const { result: activeResult } = renderHook(() =>
        useAppShellLayoutNodesSection(activeFixture.input),
      );
      act(() => activeResult.current.handleQuickSwitcherNavigate(target));
      expect(activeFixture.setCenterMode).toHaveBeenCalledTimes(1);
      expect(activeFixture.setCenterMode).toHaveBeenLastCalledWith("chat");
      expect(activeFixture.closeQuickSwitcher).toHaveBeenCalledTimes(1);

      // 未开 → canonical open action 落到对应 center mode。
      const inactiveFixture = createQuickSwitcherWrapperFixture({
        centerMode: "chat",
      });
      const { result: inactiveResult } = renderHook(() =>
        useAppShellLayoutNodesSection(inactiveFixture.input),
      );
      act(() => inactiveResult.current.handleQuickSwitcherNavigate(target));
      expect(inactiveFixture.setCenterMode).toHaveBeenLastCalledWith(
        openMarker,
      );
      expect(inactiveFixture.handleBaseQuickSwitcherNavigate).not.toHaveBeenCalled();
    }
  });

  // —— design.md D2：无 active workspace 的无效打开提示 ——

  it("hints with an info toast instead of opening when there is no active workspace", () => {
    pushErrorToastMock.mockClear();
    for (const target of [
      "intentCanvas",
      "projectMap",
      "notes",
      "memory",
    ] as const) {
      const fixture = createQuickSwitcherWrapperFixture({
        activeWorkspace: null,
        activeWorkspaceId: null,
      });
      const { result } = renderHook(() =>
        useAppShellLayoutNodesSection(fixture.input),
      );

      act(() => result.current.handleQuickSwitcherNavigate(target));

      expect(pushErrorToastMock).toHaveBeenCalledWith({
        variant: "info",
        title: `quickSwitcher.nav.${target}`,
        message: "quickSwitcher.hints.selectWorkspaceFirst",
      });
      // MUST NOT 打开：没有任何 open action 终态，也不落入 base。
      expect(fixture.setCenterMode).not.toHaveBeenCalled();
      expect(fixture.setFilePanelMode).not.toHaveBeenCalled();
      expect(fixture.expandRightPanel).not.toHaveBeenCalled();
      expect(fixture.handleBaseQuickSwitcherNavigate).not.toHaveBeenCalled();
      // Quick Switcher 仍然关闭。
      expect(fixture.closeQuickSwitcher).toHaveBeenCalledTimes(1);
    }
    expect(pushErrorToastMock).toHaveBeenCalledTimes(4);
  });

  // —— design.md D1：active id 集合（is-active 高亮数据源） ——

  it("computes quickSwitcherActiveNavigationIds from the current shell state", () => {
    const cases = [
      {
        state: { filePanelMode: "files", rightPanelCollapsed: false },
        expected: ["files"],
      },
      {
        state: { filePanelMode: "memory", rightPanelCollapsed: false },
        expected: ["memory"],
      },
      { state: { appMode: "kanban" }, expected: ["kanban"] },
      { state: { appMode: "gitHistory" }, expected: ["history"] },
      { state: { centerMode: "projectMap" }, expected: ["projectMap"] },
      { state: { centerMode: "intentCanvas" }, expected: ["intentCanvas"] },
      { state: { settingsOpen: true }, expected: ["settings"] },
      { state: { isSearchPaletteOpen: true }, expected: ["globalSearch"] },
      {
        // compact 口径：activeTab git + 面板 mode。
        state: {
          isCompact: true,
          activeTab: "git",
          filePanelMode: "notes",
          centerMode: "notes",
        },
        expected: ["notes"],
      },
      {
        // 多模块同时激活时按 NAVIGATION_ITEMS 顺序排列。
        state: { centerMode: "projectMap", settingsOpen: true },
        expected: ["projectMap", "settings"],
      },
      { state: {}, expected: [] },
    ] as const;

    for (const { state, expected } of cases) {
      const fixture = createQuickSwitcherWrapperFixture(state);
      const { result } = renderHook(() =>
        useAppShellLayoutNodesSection(fixture.input),
      );
      expect(result.current.quickSwitcherActiveNavigationIds).toEqual(expected);
    }
  });
});
