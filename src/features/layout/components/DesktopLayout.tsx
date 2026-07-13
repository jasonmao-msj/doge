import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { MainTopbar } from "../../app/components/MainTopbar";
import { MemoryPanel } from "./MemoryPanel";
import type { CenterMode } from "../../app/hooks/useGitPanelController";
import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";

const NOTE_CARDS_SPLIT_RATIO_KEY = "noteCardsSplitRatio";
const DEFAULT_NOTE_CARDS_SPLIT_RATIO = 66.667;
const MIN_NOTE_CARDS_SPLIT_RATIO = 48;
const MAX_NOTE_CARDS_SPLIT_RATIO = 76;

function clampNoteCardsSplitRatio(value: number, min = MIN_NOTE_CARDS_SPLIT_RATIO, max = MAX_NOTE_CARDS_SPLIT_RATIO) {
  return Math.min(max, Math.max(min, value));
}

function readNoteCardsSplitRatio() {
  const stored = getClientStoreSync<number>("layout", NOTE_CARDS_SPLIT_RATIO_KEY);
  return typeof stored === "number" && Number.isFinite(stored)
    ? clampNoteCardsSplitRatio(stored)
    : DEFAULT_NOTE_CARDS_SPLIT_RATIO;
}

function resolveNoteCardsSplitBounds(totalWidth: number) {
  return {
    min: Math.max(MIN_NOTE_CARDS_SPLIT_RATIO, (420 / totalWidth) * 100),
    max: Math.min(MAX_NOTE_CARDS_SPLIT_RATIO, ((totalWidth - 280) / totalWidth) * 100),
  };
}

function applyNoteCardsSplitRatio(
  splitRoot: HTMLElement,
  divider: HTMLElement,
  ratio: number,
  persist: boolean,
) {
  const normalizedRatio = clampNoteCardsSplitRatio(ratio);
  splitRoot.style.setProperty("--note-cards-split-ratio", normalizedRatio.toFixed(2));
  divider.setAttribute("aria-valuenow", normalizedRatio.toFixed(2));
  if (persist) {
    writeClientStoreValue("layout", NOTE_CARDS_SPLIT_RATIO_KEY, normalizedRatio);
  }
  return normalizedRatio;
}

type DesktopLayoutProps = {
  sidebarNode: ReactNode;
  updateToastNode: ReactNode;
  approvalToastsNode: ReactNode;
  errorToastsNode: ReactNode;
  globalRuntimeNoticeDockNode: ReactNode;
  homeNode: ReactNode;
  showHome: boolean;
  showWorkspace: boolean;
  showKanban: boolean;
  showPlugins: boolean;
  showGitHistory: boolean;
  hideRightPanel: boolean;
  isSoloMode: boolean;
  kanbanNode: ReactNode;
  pluginsNode: ReactNode;
  gitHistoryNode: ReactNode;
  settingsOpen: boolean;
  settingsNode: ReactNode;
  topbarLeftNode: ReactNode;
  centerMode: CenterMode;
  editorSplitLayout: "vertical" | "horizontal";
  editorSplitCompanion: "chat" | "projectMap";
  isEditorFileMaximized: boolean;
  messagesNode: ReactNode;
  gitDiffViewerNode: ReactNode;
  fileViewPanelNode: ReactNode;
  noteCardsPanelNode: ReactNode;
  fileComparePanelNode?: ReactNode;
  projectMapPanelNode?: ReactNode;
  intentCanvasPanelNode?: ReactNode;
  browserDockNode?: ReactNode;
  rightPanelToolbarNode: ReactNode;
  gitDiffPanelNode: ReactNode;
  planPanelNode: ReactNode;
  composerNode: ReactNode;
  runtimeConsoleDockNode: ReactNode;
  terminalDockNode: ReactNode;
  debugPanelNode: ReactNode;
  hasActivePlan: boolean;
  onSidebarResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onRightPanelResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onPlanPanelResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onGitHistoryPanelResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
};

export function DesktopLayout({
  sidebarNode,
  updateToastNode,
  approvalToastsNode,
  errorToastsNode,
  globalRuntimeNoticeDockNode,
  homeNode,
  showHome,
  showWorkspace,
  showKanban,
  showPlugins,
  showGitHistory,
  hideRightPanel,
  isSoloMode,
  kanbanNode,
  pluginsNode,
  gitHistoryNode,
  settingsOpen,
  settingsNode,
  topbarLeftNode,
  centerMode,
  editorSplitLayout,
  editorSplitCompanion,
  isEditorFileMaximized,
  messagesNode,
  gitDiffViewerNode,
  fileViewPanelNode,
  noteCardsPanelNode,
  fileComparePanelNode = null,
  projectMapPanelNode = null,
  intentCanvasPanelNode = null,
  browserDockNode = null,
  rightPanelToolbarNode,
  gitDiffPanelNode,
  planPanelNode,
  composerNode,
  runtimeConsoleDockNode,
  terminalDockNode,
  debugPanelNode,
  onSidebarResizeStart,
  onRightPanelResizeStart,
  onPlanPanelResizeStart,
  onGitHistoryPanelResizeStart,
}: DesktopLayoutProps) {
  const { t } = useTranslation();
  const diffLayerRef = useRef<HTMLDivElement | null>(null);
  const chatLayerRef = useRef<HTMLDivElement | null>(null);
  const editorLayerRef = useRef<HTMLDivElement | null>(null);
  const noteCardsLayerRef = useRef<HTMLDivElement | null>(null);
  const projectMapLayerRef = useRef<HTMLDivElement | null>(null);
  const intentCanvasLayerRef = useRef<HTMLDivElement | null>(null);
  const fileCompareLayerRef = useRef<HTMLDivElement | null>(null);
  const memoryLayerRef = useRef<HTMLDivElement | null>(null);
  const splitResizeCleanupRef = useRef<(() => void) | null>(null);
  const noteCardsSplitRatioRef = useRef(readNoteCardsSplitRatio());
  const isEditorSplitMode = centerMode === "editor";
  const isNoteCardsSplitMode = centerMode === "notes";
  const isEditorHorizontalSplitMode =
    isEditorSplitMode && editorSplitLayout === "horizontal";
  const isEditorSplitChatVisible =
    isEditorSplitMode && editorSplitCompanion === "chat" && !isEditorFileMaximized;
  const isEditorSplitProjectMapVisible =
    isEditorSplitMode &&
    editorSplitCompanion === "projectMap" &&
    !isEditorFileMaximized;
  const isBrowserDockSplitVisible = centerMode === "chat" && Boolean(browserDockNode);
  const shouldPlaceComposerInChatColumn =
    isEditorSplitChatVisible || isBrowserDockSplitVisible || isNoteCardsSplitMode;
  const hasBottomPanel = Boolean(planPanelNode);
  const shouldShowComposerBelowContent =
    centerMode !== "projectMap" &&
    centerMode !== "intentCanvas" &&
    centerMode !== "fileCompare" &&
    !shouldPlaceComposerInChatColumn &&
    !isEditorSplitProjectMapVisible &&
    !isEditorFileMaximized;

  useEffect(() => {
    const diffLayer = diffLayerRef.current;
    const chatLayer = chatLayerRef.current;
    const editorLayer = editorLayerRef.current;
    const noteCardsLayer = noteCardsLayerRef.current;
    const projectMapLayer = projectMapLayerRef.current;
    const intentCanvasLayer = intentCanvasLayerRef.current;
    const fileCompareLayer = fileCompareLayerRef.current;

    const layers = [
      { ref: diffLayer, mode: "diff" as const },
      { ref: chatLayer, mode: "chat" as const },
      { ref: editorLayer, mode: "editor" as const },
      { ref: noteCardsLayer, mode: "notes" as const },
      { ref: projectMapLayer, mode: "projectMap" as const },
      { ref: intentCanvasLayer, mode: "intentCanvas" as const },
      { ref: fileCompareLayer, mode: "fileCompare" as const },
    ];

    for (const { ref, mode } of layers) {
      if (!ref) continue;
      const isInteractive =
        centerMode === mode ||
        ((isEditorSplitChatVisible || isNoteCardsSplitMode) && mode === "chat") ||
        (isEditorSplitProjectMapVisible && mode === "projectMap");
      if (isInteractive) {
        ref.removeAttribute("inert");
      } else {
        ref.setAttribute("inert", "");
      }
    }

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      for (const { ref, mode } of layers) {
        const isInteractive =
          centerMode === mode ||
          ((isEditorSplitChatVisible || isNoteCardsSplitMode) && mode === "chat") ||
          (isEditorSplitProjectMapVisible && mode === "projectMap");
        if (ref && !isInteractive && ref.contains(activeElement)) {
          activeElement.blur();
          break;
        }
      }
    }
  }, [centerMode, isEditorSplitChatVisible, isEditorSplitProjectMapVisible, isNoteCardsSplitMode]);

  useEffect(() => {
    return () => {
      splitResizeCleanupRef.current?.();
      splitResizeCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isNoteCardsSplitMode) {
      return;
    }
    const splitRoot = noteCardsLayerRef.current?.parentElement;
    const divider = splitRoot?.querySelector<HTMLElement>(".content-note-cards-split-divider");
    if (splitRoot && divider) {
      const chatLayer = splitRoot.querySelector<HTMLElement>(".content-layer--note-cards-companion");
      const noteCardsLayer = splitRoot.querySelector<HTMLElement>(".content-layer--note-cards");
      const totalWidth = (chatLayer?.getBoundingClientRect().width ?? 0) +
        (noteCardsLayer?.getBoundingClientRect().width ?? 0);
      const bounds = totalWidth > 0 ? resolveNoteCardsSplitBounds(totalWidth) : null;
      const restoredRatio = bounds && bounds.max > bounds.min
        ? clampNoteCardsSplitRatio(noteCardsSplitRatioRef.current, bounds.min, bounds.max)
        : noteCardsSplitRatioRef.current;
      noteCardsSplitRatioRef.current = applyNoteCardsSplitRatio(
        splitRoot,
        divider,
        restoredRatio,
        false,
      );
    }
  }, [isNoteCardsSplitMode]);

  const handleHorizontalSplitPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      const divider = event.currentTarget;
      const splitRoot = divider.closest(".content.is-editor-split-horizontal") as HTMLElement | null;
      if (!splitRoot) {
        return;
      }
      const editorLayer = splitRoot.querySelector(
        ".content-layer--editor",
      ) as HTMLElement | null;
      const chatLayer = splitRoot.querySelector(
        ".content-layer--editor-companion",
      ) as HTMLElement | null;
      if (!editorLayer || !chatLayer) {
        return;
      }
      const editorRect = editorLayer.getBoundingClientRect();
      const chatRect = chatLayer.getBoundingClientRect();
      const totalWidth = editorRect.width + chatRect.width;
      if (totalWidth <= 0) {
        return;
      }

      event.preventDefault();

      const startX = event.clientX;
      const startEditorWidth = editorRect.width;
      const minEditorWidth = Math.max(320, totalWidth * 0.28);
      const maxEditorWidth = Math.min(totalWidth - 260, totalWidth * 0.8);
      if (maxEditorWidth <= minEditorWidth) {
        return;
      }

      document.body.classList.add("editor-horizontal-split-resizing");

      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        document.body.classList.remove("editor-horizontal-split-resizing");
        splitResizeCleanupRef.current = null;
      };

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const nextEditorWidth = Math.min(
          maxEditorWidth,
          Math.max(minEditorWidth, startEditorWidth - deltaX),
        );
        const nextRatio = (nextEditorWidth / totalWidth) * 100;
        splitRoot.style.setProperty("--editor-horizontal-split-ratio", nextRatio.toFixed(2));
      };

      const handlePointerUp = () => {
        cleanup();
      };

      splitResizeCleanupRef.current?.();
      splitResizeCleanupRef.current = cleanup;
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
    },
    [],
  );
  const handleBrowserDockSplitPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      const divider = event.currentTarget;
      const splitRoot = divider.closest(".content.is-browser-dock-split") as HTMLElement | null;
      if (!splitRoot) {
        return;
      }
      const chatLayer = splitRoot.querySelector(
        ".content-layer--chat",
      ) as HTMLElement | null;
      const browserLayer = splitRoot.querySelector(
        ".content-layer--browser-dock",
      ) as HTMLElement | null;
      if (!chatLayer || !browserLayer) {
        return;
      }
      const chatRect = chatLayer.getBoundingClientRect();
      const browserRect = browserLayer.getBoundingClientRect();
      const totalWidth = chatRect.width + browserRect.width;
      if (totalWidth <= 0) {
        return;
      }

      event.preventDefault();

      const startX = event.clientX;
      const startBrowserWidth = browserRect.width;
      const minBrowserWidth = Math.max(320, totalWidth * 0.24);
      const maxBrowserWidth = Math.min(totalWidth - 320, totalWidth * 0.72);
      if (maxBrowserWidth <= minBrowserWidth) {
        return;
      }

      document.body.classList.add("browser-dock-split-resizing");

      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        document.body.classList.remove("browser-dock-split-resizing");
        splitResizeCleanupRef.current = null;
      };

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const nextBrowserWidth = Math.min(
          maxBrowserWidth,
          Math.max(minBrowserWidth, startBrowserWidth - deltaX),
        );
        const nextRatio = (nextBrowserWidth / totalWidth) * 100;
        splitRoot.style.setProperty("--browser-dock-split-ratio", nextRatio.toFixed(2));
      };

      const handlePointerUp = () => {
        cleanup();
      };

      splitResizeCleanupRef.current?.();
      splitResizeCleanupRef.current = cleanup;
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
    },
    [],
  );
  const handleNoteCardsSplitPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      const divider = event.currentTarget;
      const splitRoot = divider.closest(".content.is-note-cards-split") as HTMLElement | null;
      if (!splitRoot) {
        return;
      }
      const chatLayer = splitRoot.querySelector(
        ".content-layer--note-cards-companion",
      ) as HTMLElement | null;
      const noteCardsLayer = splitRoot.querySelector(
        ".content-layer--note-cards",
      ) as HTMLElement | null;
      if (!chatLayer || !noteCardsLayer) {
        return;
      }
      const chatRect = chatLayer.getBoundingClientRect();
      const noteCardsRect = noteCardsLayer.getBoundingClientRect();
      const totalWidth = chatRect.width + noteCardsRect.width;
      if (totalWidth <= 0) {
        return;
      }

      event.preventDefault();

      const startX = event.clientX;
      const startNoteCardsWidth = noteCardsRect.width;
      const bounds = resolveNoteCardsSplitBounds(totalWidth);
      if (bounds.max <= bounds.min) {
        return;
      }
      divider.setAttribute("aria-valuemin", bounds.min.toFixed(2));
      divider.setAttribute("aria-valuemax", bounds.max.toFixed(2));

      document.body.classList.add("note-cards-split-resizing");

      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        document.body.classList.remove("note-cards-split-resizing");
        splitResizeCleanupRef.current = null;
      };

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const requestedRatio = ((startNoteCardsWidth - deltaX) / totalWidth) * 100;
        noteCardsSplitRatioRef.current = applyNoteCardsSplitRatio(
          splitRoot,
          divider,
          clampNoteCardsSplitRatio(requestedRatio, bounds.min, bounds.max),
          false,
        );
      };

      const handlePointerUp = () => {
        writeClientStoreValue(
          "layout",
          NOTE_CARDS_SPLIT_RATIO_KEY,
          noteCardsSplitRatioRef.current,
        );
        cleanup();
      };

      splitResizeCleanupRef.current?.();
      splitResizeCleanupRef.current = cleanup;
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
    },
    [],
  );

  const handleNoteCardsSplitKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home") {
        return;
      }
      const divider = event.currentTarget;
      const splitRoot = divider.closest(".content.is-note-cards-split") as HTMLElement | null;
      const chatLayer = splitRoot?.querySelector<HTMLElement>(".content-layer--note-cards-companion");
      const noteCardsLayer = splitRoot?.querySelector<HTMLElement>(".content-layer--note-cards");
      if (!splitRoot || !chatLayer || !noteCardsLayer) {
        return;
      }
      const totalWidth = chatLayer.getBoundingClientRect().width + noteCardsLayer.getBoundingClientRect().width;
      if (totalWidth <= 0) {
        return;
      }
      const bounds = resolveNoteCardsSplitBounds(totalWidth);
      if (bounds.max <= bounds.min) {
        return;
      }
      event.preventDefault();
      const requestedRatio = event.key === "Home"
        ? DEFAULT_NOTE_CARDS_SPLIT_RATIO
        : noteCardsSplitRatioRef.current + (event.key === "ArrowLeft" ? 2 : -2);
      noteCardsSplitRatioRef.current = applyNoteCardsSplitRatio(
        splitRoot,
        divider,
        clampNoteCardsSplitRatio(requestedRatio, bounds.min, bounds.max),
        true,
      );
    },
    [],
  );

  const handleNoteCardsSplitDoubleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const divider = event.currentTarget;
    const splitRoot = divider.closest(".content.is-note-cards-split") as HTMLElement | null;
    if (!splitRoot) {
      return;
    }
    const chatLayer = splitRoot.querySelector<HTMLElement>(".content-layer--note-cards-companion");
    const noteCardsLayer = splitRoot.querySelector<HTMLElement>(".content-layer--note-cards");
    const totalWidth = (chatLayer?.getBoundingClientRect().width ?? 0) +
      (noteCardsLayer?.getBoundingClientRect().width ?? 0);
    const bounds = totalWidth > 0 ? resolveNoteCardsSplitBounds(totalWidth) : null;
    const defaultRatio = bounds && bounds.max > bounds.min
      ? clampNoteCardsSplitRatio(DEFAULT_NOTE_CARDS_SPLIT_RATIO, bounds.min, bounds.max)
      : DEFAULT_NOTE_CARDS_SPLIT_RATIO;
    noteCardsSplitRatioRef.current = applyNoteCardsSplitRatio(
      splitRoot,
      divider,
      defaultRatio,
      true,
    );
  }, []);

  if (showKanban) {
    return (
      <section className="main kanban-fullscreen">
        {kanbanNode}
        {globalRuntimeNoticeDockNode}
        {runtimeConsoleDockNode}
        {terminalDockNode}
      </section>
    );
  }

  if (showPlugins) {
    return (
      <section className="main plugins-fullscreen">
        {pluginsNode}
        {errorToastsNode}
        {globalRuntimeNoticeDockNode}
        {runtimeConsoleDockNode}
        {terminalDockNode}
      </section>
    );
  }

  const isMemoryMode = centerMode === "memory";
  const gitHistoryDockNode = showGitHistory ? (
    <div className="git-history-dock-overlay">
      <div
        className="git-history-dock-resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("layout.resizeGitHistoryPanel")}
        onPointerDown={onGitHistoryPanelResizeStart}
      />
      <div className="git-history-dock-body">{gitHistoryNode}</div>
    </div>
  ) : null;

  return (
    <>
      {!settingsOpen && sidebarNode}
      {!settingsOpen && (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("layout.resizeSidebar")}
          onMouseDown={onSidebarResizeStart}
        />
      )}

      <section
        className={`main${settingsOpen ? " settings-open" : ""}${
          hideRightPanel ? " spec-focus" : ""
        }`}
        style={settingsOpen ? { gridColumn: "1 / -1" } : undefined}
      >
        {errorToastsNode}
        {globalRuntimeNoticeDockNode}

        {settingsOpen && settingsNode}

        {!settingsOpen && isMemoryMode && (
          <div
            ref={memoryLayerRef}
            style={{ position: "absolute", inset: 0, zIndex: 10 }}
          >
            <MemoryPanel />
          </div>
        )}

        {!settingsOpen && !isMemoryMode && (
          <>
            {updateToastNode}
            {showHome && homeNode}

            {showWorkspace && (
              <>
                <MainTopbar leftNode={topbarLeftNode} />
                {approvalToastsNode}
                <div
                  className={`content${isEditorSplitMode ? " is-editor-split" : ""}${
                    isNoteCardsSplitMode ? " is-note-cards-split" : ""
                  }${
                    isBrowserDockSplitVisible ? " is-browser-dock-split" : ""
                  }${
                    isEditorSplitMode
                      ? isEditorHorizontalSplitMode
                        ? " is-editor-split-horizontal"
                        : " is-editor-split-vertical"
                      : ""
                  }${
                    isEditorSplitMode && isEditorFileMaximized
                      ? " is-editor-file-maximized"
                      : ""
                  }`}
                >
                  <div
                    className={`content-layer content-layer--diff ${
                      centerMode === "diff" ? "is-active" : "is-hidden"
                    }`}
                    aria-hidden={centerMode !== "diff"}
                    ref={diffLayerRef}
                  >
                    {/* Only mount the diff viewer when actually shown. It was
                        always-mounted (CSS-hidden), so on a fresh chat it
                        eager-loaded the WHOLE working-tree diff DOM — which on a
                        large/dirty project made every WebKitGTK
                        style recalc re-resolve that hidden subtree, the main jank
                        source. Re-mounts (and reloads) on switch to the diff tab. */}
                    {centerMode === "diff" ? gitDiffViewerNode : null}
                  </div>
                  <div
                    className={`content-layer content-layer--editor ${
                      centerMode === "editor" ? "is-active" : "is-hidden"
                    }`}
                    aria-hidden={centerMode !== "editor"}
                    ref={editorLayerRef}
                  >
                    {fileViewPanelNode}
                  </div>
                  {isEditorHorizontalSplitMode ? (
                    <div
                      className="content-editor-split-divider"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={t("layout.resizeEditorSplit")}
                      onPointerDown={handleHorizontalSplitPointerDown}
                    />
                  ) : null}
                  <div
                    className={`content-layer content-layer--project-map ${
                      centerMode === "projectMap" || isEditorSplitProjectMapVisible
                        ? "is-active"
                        : "is-hidden"
                    }${
                      isEditorSplitProjectMapVisible
                        ? " content-layer--editor-companion"
                        : ""
                    }`}
                    aria-hidden={centerMode !== "projectMap" && !isEditorSplitProjectMapVisible}
                    ref={projectMapLayerRef}
                  >
                    {projectMapPanelNode}
                  </div>
                  <div
                    className={`content-layer content-layer--intent-canvas ${
                      centerMode === "intentCanvas" ? "is-active" : "is-hidden"
                    }`}
                    aria-hidden={centerMode !== "intentCanvas"}
                    ref={intentCanvasLayerRef}
                  >
                    {intentCanvasPanelNode}
                  </div>
                  <div
                    className={`content-layer content-layer--file-compare ${
                      centerMode === "fileCompare" ? "is-active" : "is-hidden"
                    }`}
                    aria-hidden={centerMode !== "fileCompare"}
                    ref={fileCompareLayerRef}
                  >
                    {fileComparePanelNode}
                  </div>
                  <div
                    className={`content-layer content-layer--note-cards ${
                      isNoteCardsSplitMode ? "is-active" : "is-hidden"
                    }`}
                    aria-hidden={!isNoteCardsSplitMode}
                    ref={noteCardsLayerRef}
                  >
                    {noteCardsPanelNode}
                  </div>
                  {isNoteCardsSplitMode ? (
                    <div
                      className="content-note-cards-split-divider"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={t("layout.resizeNoteCardsSplit")}
                      aria-valuemin={MIN_NOTE_CARDS_SPLIT_RATIO}
                      aria-valuemax={MAX_NOTE_CARDS_SPLIT_RATIO}
                      aria-valuenow={Number(noteCardsSplitRatioRef.current.toFixed(2))}
                      tabIndex={0}
                      onPointerDown={handleNoteCardsSplitPointerDown}
                      onKeyDown={handleNoteCardsSplitKeyDown}
                      onDoubleClick={handleNoteCardsSplitDoubleClick}
                    />
                  ) : null}
                  <div
                    className={`content-layer content-layer--chat ${
                      centerMode === "chat" || isEditorSplitChatVisible || isNoteCardsSplitMode
                        ? "is-active"
                        : "is-hidden"
                    }${
                      isEditorSplitChatVisible ? " content-layer--editor-companion" : ""
                    }${
                      isNoteCardsSplitMode ? " content-layer--note-cards-companion" : ""
                    }`}
                    aria-hidden={centerMode !== "chat" && !isEditorSplitChatVisible && !isNoteCardsSplitMode}
                    ref={chatLayerRef}
                  >
                    {messagesNode}
                    {shouldPlaceComposerInChatColumn ? composerNode : null}
                  </div>
                  {isBrowserDockSplitVisible ? (
                    <div
                      className="content-browser-dock-divider"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={t("layout.resizeEditorSplit")}
                      onPointerDown={handleBrowserDockSplitPointerDown}
                    />
                  ) : null}
                  <div
                    className={`content-layer content-layer--browser-dock ${
                      isBrowserDockSplitVisible
                        ? "is-active content-layer--browser-companion"
                        : "is-hidden"
                    }`}
                    aria-hidden={!isBrowserDockSplitVisible}
                  >
                    {browserDockNode}
                  </div>
                </div>

                {!hideRightPanel && (
                  <>
                    <div
                      className="right-panel-resizer"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={t("layout.resizeRightPanel")}
                      onMouseDown={onRightPanelResizeStart}
                    />
                    <div
                      className={`right-panel ${
                        hasBottomPanel && !isSoloMode ? "" : "plan-collapsed"
                      }${isSoloMode ? " is-solo" : ""}`}
                    >
                      {rightPanelToolbarNode}
                      <div className="right-panel-top">{gitDiffPanelNode}</div>
                      {hasBottomPanel ? (
                        <>
                          <div
                            className="right-panel-divider"
                            role="separator"
                            aria-orientation="horizontal"
                            aria-label={t("layout.resizePlanPanel")}
                            onMouseDown={onPlanPanelResizeStart}
                          />
                          <div className="right-panel-bottom">{planPanelNode}</div>
                        </>
                      ) : null}
                    </div>
                  </>
                )}
                {shouldShowComposerBelowContent ? composerNode : null}
                {runtimeConsoleDockNode}
                {terminalDockNode}
                {debugPanelNode}
                {gitHistoryDockNode}
              </>
            )}
            {!showWorkspace && gitHistoryDockNode}
          </>
        )}
      </section>
    </>
  );
}
