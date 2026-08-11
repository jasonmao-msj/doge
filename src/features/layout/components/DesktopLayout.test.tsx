// @vitest-environment jsdom
import { useState, type ComponentProps } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopLayout } from "./DesktopLayout";
import { useWorkspaceNoteCardsLayout } from "../../note-cards/components/WorkspaceNoteCardsLayoutContext";

const clientStorageMock = vi.hoisted(() => ({
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

vi.mock("../../../services/clientStorage", () => clientStorageMock);

function NoteCardsLayoutProbe() {
  const layout = useWorkspaceNoteCardsLayout();

  return (
    <div>
      <span>note-cards</span>
      {layout?.canMaximize ? (
        <button type="button" onClick={layout.onToggleMaximized}>
          {layout.isMaximized ? "restore-notes" : "maximize-notes"}
        </button>
      ) : null}
    </div>
  );
}

function StatefulNoteCardsLayoutProbe() {
  const [draft, setDraft] = useState("");
  const layout = useWorkspaceNoteCardsLayout();

  return (
    <div>
      <input
        aria-label="note-draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      {layout?.canMaximize ? <span>notes-can-maximize</span> : null}
    </div>
  );
}

function createDesktopLayout(overrides: Partial<ComponentProps<typeof DesktopLayout>> = {}) {
  return (
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
      showExtensions={false}
      showGitHistory={false}
      hideRightPanel={false}
      isSoloMode={false}
      kanbanNode={<div>kanban</div>}
      extensionsNode={<div>extensions</div>}
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
    />
  );
}

function renderDesktopLayout(overrides: Partial<ComponentProps<typeof DesktopLayout>> = {}) {
  return render(createDesktopLayout(overrides));
}

describe("DesktopLayout", () => {
  beforeEach(() => {
    clientStorageMock.getClientStoreSync.mockReset().mockReturnValue(undefined);
    clientStorageMock.writeClientStoreValue.mockReset();
  });

  it("renders Extensions as a workspace-independent page", () => {
    const { container, getByText, queryByText } = renderDesktopLayout({
      showExtensions: true,
      showWorkspace: false,
    });

    expect(getByText("sidebar")).toBeTruthy();
    expect(getByText("extensions")).toBeTruthy();
    expect(queryByText("messages")).toBeNull();
    expect(queryByText("composer")).toBeNull();
    expect(queryByText("right-toolbar")).toBeNull();
    expect(queryByText("activity-panel")).toBeNull();
    expect(container.querySelector(".right-panel")).toBeNull();
  });

  it("opens Git Graph as a bottom half-dock with a resize handle", () => {
    const { container, getByText, getByRole } = renderDesktopLayout({
      showGitHistory: true,
    });

    const overlay = container.querySelector(".git-history-dock-overlay");
    const body = container.querySelector(".git-history-dock-body");
    expect(overlay).toBeTruthy();
    expect(body).toBeTruthy();
    expect(body?.getAttribute("role")).not.toBe("dialog");
    expect(container.querySelector(".git-history-dock-resizer")).toBeTruthy();
    expect(
      getByRole("separator", { name: /resizeGitHistoryPanel|resize git history/i }),
    ).toBeTruthy();
    expect(getByText("git-history")).toBeTruthy();
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
    expect(composer.parentElement?.classList.contains("subagent-chat-split-main")).toBe(true);
    expect(composer.closest(".content-layer")).toBe(chatLayer);
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

  it("uses the mounted note workbench as the left editor companion", () => {
    cleanup();
    const noteCardsPanelNode = <StatefulNoteCardsLayoutProbe />;
    const { container, getByRole, getByText, queryByText, rerender } =
      renderDesktopLayout({
        centerMode: "notes",
        editorSplitLayout: "vertical",
        noteCardsPanelNode,
      });

    fireEvent.change(getByRole("textbox", { name: "note-draft" }), {
      target: { value: "保留便签现场" },
    });
    expect(getByText("notes-can-maximize")).toBeTruthy();

    rerender(
      createDesktopLayout({
        centerMode: "editor",
        editorSplitLayout: "vertical",
        editorSplitCompanion: "notes",
        noteCardsPanelNode,
      }),
    );

    const content = container.querySelector(
      ".content.is-editor-split-horizontal",
    );
    const noteCardsLayer = container.querySelector(
      ".content-layer--note-cards",
    );
    const editorLayer = container.querySelector(".content-layer--editor");
    const chatLayer = container.querySelector(".content-layer--chat");

    expect(content).toBeTruthy();
    expect(noteCardsLayer?.className).toContain("is-active");
    expect(noteCardsLayer?.className).toContain(
      "content-layer--editor-companion",
    );
    expect(noteCardsLayer?.getAttribute("aria-hidden")).toBe("false");
    expect(editorLayer?.contains(getByText("file-viewer"))).toBe(true);
    expect(chatLayer?.className).toContain("is-hidden");
    expect(chatLayer?.hasAttribute("inert")).toBe(true);
    const draftInput = noteCardsLayer?.querySelector(
      'input[aria-label="note-draft"]',
    ) as HTMLInputElement | null;
    expect(draftInput?.value).toBe("保留便签现场");
    expect(queryByText("notes-can-maximize")).toBeNull();
    expect(getByText("right-toolbar")).toBeTruthy();
    expect(container.querySelector(".composer")).toBeNull();
    expect(container.querySelector(".content-editor-split-divider")).toBeTruthy();

    rerender(
      createDesktopLayout({
        centerMode: "editor",
        editorSplitLayout: "vertical",
        editorSplitCompanion: "notes",
        isEditorFileMaximized: true,
        noteCardsPanelNode,
      }),
    );

    expect(noteCardsLayer?.className).toContain("is-hidden");
    expect(noteCardsLayer?.getAttribute("aria-hidden")).toBe("true");
    expect(noteCardsLayer?.hasAttribute("inert")).toBe(true);
    const hiddenDraftInput = noteCardsLayer?.querySelector(
      'input[aria-label="note-draft"]',
    ) as HTMLInputElement | null;
    expect(hiddenDraftInput?.value).toBe("保留便签现场");

    rerender(
      createDesktopLayout({
        centerMode: "editor",
        editorSplitLayout: "vertical",
        editorSplitCompanion: "notes",
        noteCardsPanelNode,
      }),
    );

    expect(noteCardsLayer?.className).toContain("is-active");
    expect(noteCardsLayer?.getAttribute("aria-hidden")).toBe("false");
    expect(
      (getByRole("textbox", { name: "note-draft" }) as HTMLInputElement).value,
    ).toBe("保留便签现场");
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

  it("maximizes note cards across the conversation column while preserving the right panel", () => {
    cleanup();
    const { container, getByRole, getByText } = renderDesktopLayout({
      centerMode: "notes",
      noteCardsPanelNode: <NoteCardsLayoutProbe />,
      messagesNode: <button type="button">conversation-action</button>,
    });

    const conversationAction = getByRole("button", {
      name: "conversation-action",
    });
    conversationAction.focus();
    expect(document.activeElement).toBe(conversationAction);

    fireEvent.click(getByRole("button", { name: "maximize-notes" }));

    const content = container.querySelector(".content");
    const chatLayer = container.querySelector(".content-layer--chat");
    expect(content?.classList.contains("is-note-cards-maximized")).toBe(true);
    expect(chatLayer?.classList.contains("is-hidden")).toBe(true);
    expect(chatLayer?.getAttribute("aria-hidden")).toBe("true");
    expect(chatLayer?.hasAttribute("inert")).toBe(true);
    expect(chatLayer?.contains(conversationAction)).toBe(true);
    expect(document.activeElement).not.toBe(conversationAction);
    expect(container.querySelector(".content-note-cards-split-divider")).toBeNull();
    expect(getByText("right-toolbar")).toBeTruthy();
    expect(clientStorageMock.writeClientStoreValue).not.toHaveBeenCalled();

    fireEvent.click(getByRole("button", { name: "restore-notes" }));

    expect(content?.classList.contains("is-note-cards-maximized")).toBe(false);
    expect(chatLayer?.classList.contains("is-active")).toBe(true);
    expect(chatLayer?.getAttribute("aria-hidden")).toBe("false");
    expect(chatLayer?.hasAttribute("inert")).toBe(false);
    expect(container.querySelector(".content-note-cards-split-divider")).toBeTruthy();
    expect(getByText("right-toolbar")).toBeTruthy();
    expect(clientStorageMock.writeClientStoreValue).not.toHaveBeenCalled();
  });

  it("clears note-card maximize state after leaving the notes center", () => {
    cleanup();
    const noteCardsPanelNode = <NoteCardsLayoutProbe />;
    const { container, getByRole, rerender } = renderDesktopLayout({
      centerMode: "notes",
      noteCardsPanelNode,
    });

    fireEvent.click(getByRole("button", { name: "maximize-notes" }));
    expect(
      container.querySelector(".content")?.classList.contains(
        "is-note-cards-maximized",
      ),
    ).toBe(true);

    rerender(
      createDesktopLayout({
        centerMode: "chat",
        noteCardsPanelNode,
      }),
    );
    rerender(
      createDesktopLayout({
        centerMode: "notes",
        noteCardsPanelNode,
      }),
    );

    expect(
      container.querySelector(".content")?.classList.contains(
        "is-note-cards-maximized",
      ),
    ).toBe(false);
    expect(getByRole("button", { name: "maximize-notes" })).toBeTruthy();
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
