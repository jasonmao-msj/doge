// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopLayout } from "./DesktopLayout";

const clientStorageMock = vi.hoisted(() => ({
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

vi.mock("../../../services/clientStorage", () => clientStorageMock);

function renderDesktopLayout(overrides: Partial<ComponentProps<typeof DesktopLayout>> = {}) {
  return render(
    <DesktopLayout
      sidebarNode={<aside>sidebar</aside>}
      updateToastNode={<div>update-toast</div>}
      approvalToastsNode={<div>approval-toast</div>}
      errorToastsNode={<div>error-toast</div>}
      globalRuntimeNoticeDockNode={<div>runtime-notice-dock</div>}
      homeNode={<div>home</div>}
      showHome={false}
      showWorkspace
      showKanban={false}
      showPlugins={false}
      showGitHistory={false}
      hideRightPanel={false}
      isSoloMode={false}
      kanbanNode={<div>kanban</div>}
      pluginsNode={<div>plugins</div>}
      gitHistoryNode={<div>git-history</div>}
      settingsOpen={false}
      settingsNode={<div>settings</div>}
      topbarLeftNode={<div>topbar-left</div>}
      centerMode="chat"
      editorSplitLayout="vertical"
      editorSplitCompanion="chat"
      isEditorFileMaximized={false}
      messagesNode={<div>messages</div>}
      gitDiffViewerNode={<div>git-diff-viewer</div>}
      fileViewPanelNode={<div>file-viewer</div>}
      noteCardsPanelNode={<div>note-cards</div>}
      rightPanelToolbarNode={<div>right-toolbar</div>}
      gitDiffPanelNode={<div>activity-panel</div>}
      planPanelNode={<div>plan-panel</div>}
      composerNode={<div className="composer">composer</div>}
      runtimeConsoleDockNode={<div>runtime-dock</div>}
      terminalDockNode={<div>terminal-dock</div>}
      debugPanelNode={<div>debug-panel</div>}
      hasActivePlan
      onSidebarResizeStart={vi.fn()}
      onRightPanelResizeStart={vi.fn()}
      onPlanPanelResizeStart={vi.fn()}
      onGitHistoryPanelResizeStart={vi.fn()}
      {...overrides}
    />,
  );
}

describe("DesktopLayout", () => {
  beforeEach(() => {
    clientStorageMock.getClientStoreSync.mockReset().mockReturnValue(undefined);
    clientStorageMock.writeClientStoreValue.mockReset();
  });

  it("keeps plan section expanded in normal activity view", () => {
    const { container } = renderDesktopLayout();

    expect(container.textContent ?? "").toContain("activity-panel");
    expect(container.textContent ?? "").toContain("plan-panel");
    expect(container.textContent ?? "").toContain("runtime-notice-dock");

    const rightPanel = container.querySelector(".right-panel");
    expect(rightPanel?.className).not.toContain("plan-collapsed");
    expect(rightPanel?.className).not.toContain("is-solo");
  });

  it("collapses the plan section and marks the right panel in SOLO mode", () => {
    cleanup();
    const { container } = renderDesktopLayout({ isSoloMode: true });

    expect(container.textContent ?? "").toContain("activity-panel");
    expect(container.textContent ?? "").toContain("plan-panel");

    const rightPanel = container.querySelector(".right-panel");
    expect(rightPanel?.className).toContain("plan-collapsed");
    expect(rightPanel?.className).toContain("is-solo");
  });

  it("keeps right panel bottom collapsed when no merged plan node is mounted", () => {
    cleanup();
    const { container } = renderDesktopLayout({
      planPanelNode: null,
      hasActivePlan: true,
    });

    const rightPanel = container.querySelector(".right-panel");
    expect(rightPanel?.className).toContain("plan-collapsed");
    expect(container.querySelector(".right-panel-bottom")).toBeNull();
    expect(container.querySelector(".right-panel-divider")).toBeNull();
  });

  it("hides the outer composer when the editor file is maximized", () => {
    cleanup();
    const { container } = renderDesktopLayout({
      centerMode: "editor",
      isEditorFileMaximized: true,
    });

    expect(container.querySelector(".content.is-editor-file-maximized")).toBeTruthy();
    expect(container.textContent ?? "").toContain("file-viewer");
    expect(container.querySelector(".composer")).toBeNull();
  });

  it("places the composer inside the chat column in horizontal editor split", () => {
    cleanup();
    const { container, getByText } = renderDesktopLayout({
      centerMode: "editor",
      editorSplitLayout: "horizontal",
    });

    const content = container.querySelector(".content.is-editor-split-horizontal");
    const chatLayer = container.querySelector(".content-layer--chat");
    const editorLayer = container.querySelector(".content-layer--editor");
    const composer = getByText("composer");

    expect(content).toBeTruthy();
    expect(chatLayer?.contains(getByText("messages"))).toBe(true);
    expect(chatLayer?.contains(composer)).toBe(true);
    expect(editorLayer?.contains(getByText("file-viewer"))).toBe(true);
    expect(composer.parentElement).toBe(chatLayer);
  });

  it("uses Project Map as the editor split companion for evidence file navigation", () => {
    cleanup();
    const { container, getByText } = renderDesktopLayout({
      centerMode: "editor",
      editorSplitLayout: "horizontal",
      editorSplitCompanion: "projectMap",
      projectMapPanelNode: <div>project-map</div>,
    });

    const content = container.querySelector(".content.is-editor-split-horizontal");
    const projectMapLayer = container.querySelector(".content-layer--project-map");
    const chatLayer = container.querySelector(".content-layer--chat");
    const editorLayer = container.querySelector(".content-layer--editor");

    expect(content).toBeTruthy();
    expect(content?.className).not.toContain("is-editor-file-maximized");
    expect(projectMapLayer?.className).toContain("is-active");
    expect(projectMapLayer?.className).toContain("content-layer--editor-companion");
    expect(projectMapLayer?.getAttribute("aria-hidden")).toBe("false");
    expect(chatLayer?.className).toContain("is-hidden");
    expect(editorLayer?.contains(getByText("file-viewer"))).toBe(true);
    expect(projectMapLayer?.contains(getByText("project-map"))).toBe(true);
    expect(container.querySelector(".composer")).toBeNull();
  });

  it("keeps composer outside the chat layer in normal chat mode", () => {
    cleanup();
    const { container, getByText } = renderDesktopLayout();

    const chatLayer = container.querySelector(".content-layer--chat");
    const composer = getByText("composer");

    expect(chatLayer?.contains(composer)).toBe(false);
    expect(composer.parentElement?.className).toContain("main");
  });

  it("places the conversation left of note cards and keeps Composer in the conversation column", () => {
    cleanup();
    const { container, getByText } = renderDesktopLayout({ centerMode: "notes" });

    const content = container.querySelector(".content.is-note-cards-split");
    const noteCardsLayer = container.querySelector(".content-layer--note-cards");
    const chatLayer = container.querySelector(".content-layer--note-cards-companion");
    const composer = getByText("composer");
    const divider = container.querySelector(".content-note-cards-split-divider");

    expect(content).toBeTruthy();
    expect(noteCardsLayer?.contains(getByText("note-cards"))).toBe(true);
    expect(noteCardsLayer?.getAttribute("aria-hidden")).toBe("false");
    expect(chatLayer?.contains(getByText("messages"))).toBe(true);
    expect(chatLayer?.contains(composer)).toBe(true);
    expect(divider?.getAttribute("role")).toBe("separator");
    expect(divider?.getAttribute("aria-orientation")).toBe("vertical");
    expect(divider?.getAttribute("aria-label")).toBe("layout.resizeNoteCardsSplit");
    expect(divider?.getAttribute("tabindex")).toBe("0");
    expect(divider?.getAttribute("aria-valuenow")).toBe("66.67");
  });

  it("resizes the right note-card column while preserving minimum widths", () => {
    cleanup();
    const { container } = renderDesktopLayout({ centerMode: "notes" });

    const content = container.querySelector(".content.is-note-cards-split") as HTMLElement;
    const noteCardsLayer = container.querySelector(".content-layer--note-cards") as HTMLElement;
    const chatLayer = container.querySelector(".content-layer--note-cards-companion") as HTMLElement;
    const divider = container.querySelector(".content-note-cards-split-divider") as HTMLElement;

    vi.spyOn(noteCardsLayer, "getBoundingClientRect").mockReturnValue({
      width: 600,
    } as DOMRect);
    vi.spyOn(chatLayer, "getBoundingClientRect").mockReturnValue({
      width: 300,
    } as DOMRect);

    fireEvent.pointerDown(divider, { button: 0, clientX: 300 });
    fireEvent.pointerMove(window, { clientX: 360 });

    expect(content.style.getPropertyValue("--note-cards-split-ratio")).toBe("60.00");

    fireEvent.pointerUp(window);
    expect(document.body.classList.contains("note-cards-split-resizing")).toBe(false);
    expect(clientStorageMock.writeClientStoreValue).toHaveBeenCalledWith(
      "layout",
      "noteCardsSplitRatio",
      60,
    );
  });

  it("restores, keyboard-adjusts, and resets the persisted note split ratio", () => {
    cleanup();
    clientStorageMock.getClientStoreSync.mockReturnValue(62);
    const { container } = renderDesktopLayout({ centerMode: "notes" });
    const content = container.querySelector(".content.is-note-cards-split") as HTMLElement;
    const noteCardsLayer = container.querySelector(".content-layer--note-cards") as HTMLElement;
    const chatLayer = container.querySelector(".content-layer--note-cards-companion") as HTMLElement;
    const divider = container.querySelector(".content-note-cards-split-divider") as HTMLElement;
    vi.spyOn(noteCardsLayer, "getBoundingClientRect").mockReturnValue({ width: 600 } as DOMRect);
    vi.spyOn(chatLayer, "getBoundingClientRect").mockReturnValue({ width: 300 } as DOMRect);

    expect(content.style.getPropertyValue("--note-cards-split-ratio")).toBe("62.00");
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(content.style.getPropertyValue("--note-cards-split-ratio")).toBe("60.00");
    expect(divider.getAttribute("aria-valuenow")).toBe("60.00");

    fireEvent.doubleClick(divider);
    expect(content.style.getPropertyValue("--note-cards-split-ratio")).toBe("66.67");
    expect(clientStorageMock.writeClientStoreValue).toHaveBeenLastCalledWith(
      "layout",
      "noteCardsSplitRatio",
      66.667,
    );
  });
});
