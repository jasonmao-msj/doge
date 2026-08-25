import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import type { MutableRefObject } from "react";
import type { ReactCodeMirrorProps } from "@uiw/react-codemirror";
import { useTranslation } from "react-i18next";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import Save from "lucide-react/dist/esm/icons/save";
import X from "lucide-react/dist/esm/icons/x";
import type { EditorView } from "@codemirror/view";
import type { CodeAnnotationSelection } from "../../code-annotations/types";
import type { FileCompareSession } from "../types/fileCompare";
import { useFileDocumentState } from "../hooks/useFileDocumentState";
import {
  computeFileCompareDiff,
  type FileCompareCollapsedRange,
  type FileCompareLineGap,
} from "../utils/fileCompareDiff";
import { resolveFileRenderProfile } from "@/utils/fileRenderProfile";
import { loadCodeMirrorExtensionsForEditorLanguage } from "../utils/codemirrorLanguageExtensions";
import { resolveFileReadTarget } from "../../../utils/workspacePaths";
import { loadFileViewStyles } from "../../../styles/featureStyleLoaders";
import { FileCodeMirrorEditor, type FileCodeMirrorEditorHandle } from "./FileCodeMirrorEditor";
import {
  resolveEditorTheme,
  type AnnotationWidgetCallbacks,
  type EditorTheme,
} from "./fileViewPanelShared";
import type { GitLineMarkers } from "../utils/gitLineMarkers";

type WorkspaceFileComparePanelProps = {
  session: FileCompareSession | null;
  workspaceId: string | null;
  workspaceName?: string | null;
  workspacePath?: string | null;
  saveFileShortcut?: string | null;
  onClose: () => void;
};

export type CompareColumnDraft = {
  id: string;
  label: string;
  title?: string;
  content: string;
  isDirty: boolean;
  isSaving: boolean;
  isLoading: boolean;
  error: string | null;
  saveError: string | null;
  truncated: boolean;
  readOnlyReason: string | null;
  editable: boolean;
  onChange: (value: string) => void;
  onSave: () => Promise<boolean> | boolean;
};

const EMPTY_LANGUAGE_EXTENSIONS: ReactCodeMirrorProps["extensions"] = [];
const EMPTY_GIT_LINE_MARKERS: GitLineMarkers = { added: [], modified: [] };
const EMPTY_ANNOTATIONS: CodeAnnotationSelection[] = [];
const EMPTY_ANNOTATION_LABELS = {
  title: "",
  remove: "",
  placeholder: "",
  cancel: "",
  submit: "",
};
const NOOP_ANNOTATION_CALLBACKS: AnnotationWidgetCallbacks = {
  onDraftCancel: () => {},
  onDraftConfirm: () => {},
};

function fileNameFromPath(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
export function useFileCompareEditorTheme() {
  const [editorTheme, setEditorTheme] = useState<EditorTheme>(() => resolveEditorTheme());

  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
      return;
    }
    const updateTheme = () => setEditorTheme(resolveEditorTheme());
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  return editorTheme;
}

function useLanguageExtensions(filePath: string | null) {
  const renderProfile = useMemo(
    () => (filePath ? resolveFileRenderProfile(filePath) : null),
    [filePath],
  );
  const [languageExtensions, setLanguageExtensions] =
    useState<ReactCodeMirrorProps["extensions"]>(EMPTY_LANGUAGE_EXTENSIONS);

  useEffect(() => {
    let cancelled = false;
    const editorLanguage = renderProfile?.editorLanguage ?? null;
    if (!editorLanguage) {
      setLanguageExtensions(EMPTY_LANGUAGE_EXTENSIONS);
      return;
    }
    loadCodeMirrorExtensionsForEditorLanguage(editorLanguage)
      .then((extensions) => {
        if (!cancelled) {
          setLanguageExtensions(extensions);
        }
      })
      .catch((error) => {
        console.error("[file-compare] failed to load CodeMirror language extension:", error);
        if (!cancelled) {
          setLanguageExtensions(EMPTY_LANGUAGE_EXTENSIONS);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [renderProfile?.editorLanguage]);

  return {
    renderProfile,
    languageExtensions,
  };
}

function WorkspaceCompareColumn({
  workspaceId,
  workspacePath,
  path,
  onDraftChange,
}: {
  workspaceId: string;
  workspacePath: string;
  path: string;
  onDraftChange: (draft: CompareColumnDraft) => void;
}) {
  const { t } = useTranslation();
  const renderProfile = useMemo(() => resolveFileRenderProfile(path), [path]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileReadTarget = useMemo(
    () => resolveFileReadTarget(workspacePath, path, null),
    [path, workspacePath],
  );
  const documentState = useFileDocumentState({
    workspaceId,
    customSpecRoot: null,
    workspaceRelativeFilePath: fileReadTarget.workspaceRelativePath,
    fileReadTarget,
    skipTextRead: renderProfile?.previewSourceKind !== "inline-bytes",
    externalAbsoluteReadOnlyMessage: t("files.externalAbsoluteReadOnly"),
  });
  const canEdit =
    renderProfile?.editCapability !== "read-only" &&
    !documentState.truncated &&
    !documentState.error;
  const saveDocument = documentState.handleSave;
  const readOnlyReason = documentState.truncated
    ? t("files.fileCompare.truncatedReadOnly")
    : renderProfile?.editCapability === "read-only"
      ? t("files.fileCompare.unsupportedReadOnly")
      : null;
  const handleSave = useCallback(async () => {
    const saved = await saveDocument();
    setSaveError(saved ? null : t("files.fileCompare.saveFailed"));
    return saved;
  }, [saveDocument, t]);

  useEffect(() => {
    setSaveError(null);
  }, [documentState.content]);

  useEffect(() => {
    onDraftChange({
      id: path,
      label: path,
      content: documentState.content,
      isDirty: documentState.isDirty,
      isSaving: documentState.isSaving,
      isLoading: documentState.isLoading,
      error: documentState.error,
      saveError,
      truncated: documentState.truncated,
      readOnlyReason,
      editable: canEdit,
      onChange: canEdit ? documentState.setContent : () => {},
      onSave: handleSave,
    });
  }, [
    canEdit,
    documentState.content,
    documentState.error,
    documentState.isDirty,
    documentState.isLoading,
    documentState.isSaving,
    documentState.setContent,
    documentState.truncated,
    handleSave,
    onDraftChange,
    path,
    readOnlyReason,
    saveError,
  ]);

  return null;
}

export function CompareEditorColumn({
  draft,
  editorTheme,
  markers,
  lineGaps,
  collapsedRanges = [],
  saveFileShortcut,
  activeLineNumber,
  diffTone = null,
  lineNumberLabels = null,
}: {
  draft: CompareColumnDraft;
  editorTheme: EditorTheme;
  markers: GitLineMarkers;
  lineGaps: FileCompareLineGap[];
  collapsedRanges?: FileCompareCollapsedRange[];
  saveFileShortcut?: string | null;
  activeLineNumber: number | null;
  diffTone?: "deletion" | "addition" | null;
  lineNumberLabels?: readonly (number | null)[] | null;
}) {
  const { t } = useTranslation();
  const cmRef = useRef<FileCodeMirrorEditorHandle | null>(null);
  const lastReportedLineRangeRef = useRef("");
  const { languageExtensions } = useLanguageExtensions(
    draft.id.startsWith("scratch-") ? null : draft.id,
  );
  const isReadOnly = !draft.editable || Boolean(draft.readOnlyReason || draft.error || draft.truncated);
  const shouldRenderPlainText = Boolean(draft.readOnlyReason || draft.error || draft.truncated);

  useEffect(() => {
    if (!activeLineNumber || shouldRenderPlainText) {
      return;
    }
    const view = cmRef.current?.view;
    if (!view || activeLineNumber < 1 || activeLineNumber > view.state.doc.lines) {
      return;
    }
    const line = view.state.doc.line(activeLineNumber);
    view.dispatch({
      selection: { anchor: line.from },
      scrollIntoView: true,
    });
    cmRef.current?.flashNavigationLine(activeLineNumber);
  }, [activeLineNumber, shouldRenderPlainText]);

  return (
    <section
      className={`file-compare-column${diffTone ? ` is-diff-${diffTone}` : ""}`}
      aria-label={draft.label}
    >
      <div className="file-compare-column-header">
        <div className="file-compare-column-title" title={draft.label}>
          <span className="file-compare-column-name">
            {draft.title ?? fileNameFromPath(draft.label)}
          </span>
          <span className="file-compare-column-path">{draft.label}</span>
        </div>
        <div className="file-compare-column-actions">
          {draft.editable && draft.isDirty ? (
            <span className="file-compare-dirty" title={t("files.unsavedChanges")} />
          ) : null}
          {draft.saveError ? (
            <span
              className="file-compare-save-error-dot"
              role="img"
              aria-label={draft.saveError}
              title={draft.saveError}
            />
          ) : null}
          {draft.editable ? (
            <button
              type="button"
              className="ghost file-compare-save"
              onClick={() => void draft.onSave()}
              disabled={!draft.isDirty || draft.isSaving || isReadOnly}
              aria-label={t("files.save")}
              title={t("files.save")}
            >
              <Save size={14} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
      {draft.isLoading ? (
        <div className="file-compare-state">{t("common.loading")}</div>
      ) : draft.error ? (
        <div className="file-compare-state is-error" role="alert">
          {draft.error}
        </div>
      ) : draft.readOnlyReason ? (
        <div className="file-compare-state">{draft.readOnlyReason}</div>
      ) : null}
      <div className="file-compare-editor">
        {shouldRenderPlainText ? (
          <pre className="file-compare-readonly-content">{draft.content}</pre>
        ) : (
          <FileCodeMirrorEditor
            cmRef={cmRef as MutableRefObject<FileCodeMirrorEditorHandle | null>}
            fallback={<div className="file-compare-state">{t("common.loading")}</div>}
            filePath={draft.id}
            value={draft.content}
            onChange={draft.onChange}
            theme={editorTheme}
            languageExtensions={languageExtensions}
            gitLineMarkers={markers}
            fileCompareLineGaps={lineGaps}
            fileCompareCollapsedRanges={collapsedRanges}
            lineNumberLabels={lineNumberLabels}
            codeAnnotations={EMPTY_ANNOTATIONS}
            annotationDraft={null}
            annotationWidgetLabels={EMPTY_ANNOTATION_LABELS}
            annotationWidgetCallbacks={NOOP_ANNOTATION_CALLBACKS}
            runDefinitionFromCursor={() => {}}
            runReferencesFromCursor={() => {}}
            resolveDefinitionAtOffset={(_offset: number, _view?: EditorView) => {}}
            className="file-compare-cm"
            lastReportedLineRangeRef={lastReportedLineRangeRef}
            saveFileShortcut={saveFileShortcut}
            handleSave={() => {
              void draft.onSave();
            }}
            editable={!isReadOnly}
          />
        )}
      </div>
    </section>
  );
}

export function WorkspaceFileComparePanel({
  session,
  workspaceId,
  workspaceName,
  workspacePath,
  saveFileShortcut,
  onClose,
}: WorkspaceFileComparePanelProps) {
  const { t } = useTranslation();
  const editorTheme = useFileCompareEditorTheme();
  const scrollSyncingRef = useRef(false);
  const [draftsById, setDraftsById] = useState<Record<string, CompareColumnDraft>>({});
  const [scratchTexts, setScratchTexts] = useState({ left: "", right: "" });
  const [activeDifferenceIndex, setActiveDifferenceIndex] = useState(0);

  useEffect(() => {
    void loadFileViewStyles();
  }, []);

  useEffect(() => {
    setDraftsById({});
    setScratchTexts({ left: "", right: "" });
    setActiveDifferenceIndex(0);
  }, [session]);

  const handleDraftChange = useCallback((draft: CompareColumnDraft) => {
    setDraftsById((current) => {
      const existing = current[draft.id];
      if (
        existing &&
        existing.content === draft.content &&
        existing.isDirty === draft.isDirty &&
        existing.isSaving === draft.isSaving &&
        existing.isLoading === draft.isLoading &&
        existing.error === draft.error &&
        existing.saveError === draft.saveError &&
        existing.truncated === draft.truncated &&
        existing.readOnlyReason === draft.readOnlyReason
      ) {
        return current;
      }
      return {
        ...current,
        [draft.id]: draft,
      };
    });
  }, []);

  const sessionColumns = useMemo(() => {
    if (!session) {
      return [];
    }
    if (session.kind === "scratch") {
      return ["scratch-left", "scratch-right"];
    }
    return session.paths;
  }, [session]);
  const scratchDrafts = useMemo<CompareColumnDraft[]>(
    () => [
      {
        id: "scratch-left",
        label: t("files.fileCompare.leftText"),
        content: scratchTexts.left,
        isDirty: false,
        isSaving: false,
        isLoading: false,
        error: null,
        saveError: null,
        truncated: false,
        readOnlyReason: null,
        editable: true,
        onChange: (value) =>
          setScratchTexts((current) =>
            current.left === value ? current : { ...current, left: value },
          ),
        onSave: () => false,
      },
      {
        id: "scratch-right",
        label: t("files.fileCompare.rightText"),
        content: scratchTexts.right,
        isDirty: false,
        isSaving: false,
        isLoading: false,
        error: null,
        saveError: null,
        truncated: false,
        readOnlyReason: null,
        editable: true,
        onChange: (value) =>
          setScratchTexts((current) =>
            current.right === value ? current : { ...current, right: value },
          ),
        onSave: () => false,
      },
    ],
    [scratchTexts.left, scratchTexts.right, t],
  );
  const workspaceDrafts = useMemo(
    () => sessionColumns.map((id) => draftsById[id]).filter(Boolean),
    [draftsById, sessionColumns],
  );
  const drafts = session?.kind === "scratch" ? scratchDrafts : workspaceDrafts;
  const diffResult = useMemo(
    () => computeFileCompareDiff(drafts.map((draft) => draft.content)),
    [drafts],
  );
  const activeDifference = diffResult.changedBlocks[activeDifferenceIndex] ?? null;
  const canNavigateDiffs = diffResult.changedBlocks.length > 0;

  useEffect(() => {
    if (activeDifferenceIndex < diffResult.changedBlocks.length) {
      return;
    }
    setActiveDifferenceIndex(Math.max(0, diffResult.changedBlocks.length - 1));
  }, [activeDifferenceIndex, diffResult.changedBlocks.length]);

  const markersByDraftId = useMemo(() => {
    const entries = drafts.map((draft, index) => [
      draft.id,
      {
        added: [],
        modified: diffResult.changedLineNumbersByColumn[index] ?? [],
      } satisfies GitLineMarkers,
    ]);
    return Object.fromEntries(entries) as Record<string, GitLineMarkers>;
  }, [diffResult.changedLineNumbersByColumn, drafts]);

  const goPreviousDifference = useCallback(() => {
    if (!canNavigateDiffs) {
      return;
    }
    setActiveDifferenceIndex((current) =>
      (current - 1 + diffResult.changedBlocks.length) % diffResult.changedBlocks.length,
    );
  }, [canNavigateDiffs, diffResult.changedBlocks.length]);

  const goNextDifference = useCallback(() => {
    if (!canNavigateDiffs) {
      return;
    }
    setActiveDifferenceIndex((current) => (current + 1) % diffResult.changedBlocks.length);
  }, [canNavigateDiffs, diffResult.changedBlocks.length]);

  const handlePanelScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const sourceScroller = event.target;
    if (
      scrollSyncingRef.current ||
      !(sourceScroller instanceof HTMLElement) ||
      !sourceScroller.classList.contains("cm-scroller")
    ) {
      return;
    }
    const panel = event.currentTarget;
    const scrollers = Array.from(
      panel.querySelectorAll<HTMLElement>(".file-compare-cm .cm-scroller"),
    );
    scrollSyncingRef.current = true;
    for (const scroller of scrollers) {
      if (scroller === sourceScroller) {
        continue;
      }
      scroller.scrollTop = sourceScroller.scrollTop;
    }
    window.requestAnimationFrame(() => {
      scrollSyncingRef.current = false;
    });
  }, []);

  if (!session) {
    return (
      <div className="file-compare-panel">
        <div className="file-compare-empty">{t("files.fileCompare.noSession")}</div>
      </div>
    );
  }

  const isWorkspaceSession = session.kind === "workspace";
  const canRenderWorkspace =
    isWorkspaceSession &&
    workspaceId === session.workspaceId &&
    Boolean(workspacePath);

  return (
    <div className="file-compare-panel" onScrollCapture={handlePanelScroll}>
      <div className="file-compare-header">
        <button
          type="button"
          className="icon-button file-compare-back"
          onClick={onClose}
          aria-label={t("files.backToChat")}
          title={t("files.backToChat")}
        >
          <ArrowLeft size={16} aria-hidden />
        </button>
        <div className="file-compare-heading">
          <h2>{t("files.fileCompare.title")}</h2>
          <span>
            {isWorkspaceSession
              ? t("files.fileCompare.workspaceSubtitle", {
                  count: session.paths.length,
                  workspace: workspaceName ?? workspaceId ?? "",
                })
              : t("files.fileCompare.scratchSubtitle")}
          </span>
        </div>
        <div className="file-compare-diff-nav">
          <button
            type="button"
            className="ghost"
            onClick={goPreviousDifference}
            disabled={!canNavigateDiffs}
            aria-label={t("files.fileCompare.previousDifference")}
            title={t("files.fileCompare.previousDifference")}
          >
            <ChevronUp size={15} aria-hidden />
          </button>
          <span>
            {canNavigateDiffs
              ? t("files.fileCompare.differenceCount", {
                  current: activeDifferenceIndex + 1,
                  total: diffResult.changedBlocks.length,
                })
              : t("files.fileCompare.noDifferences")}
          </span>
          <button
            type="button"
            className="ghost"
            onClick={goNextDifference}
            disabled={!canNavigateDiffs}
            aria-label={t("files.fileCompare.nextDifference")}
            title={t("files.fileCompare.nextDifference")}
          >
            <ChevronDown size={15} aria-hidden />
          </button>
        </div>
        <button
          type="button"
          className="icon-button file-compare-close"
          onClick={onClose}
          aria-label={t("common.close")}
          title={t("common.close")}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="file-compare-active-diff" aria-live="polite">
        {activeDifference
          ? t("files.fileCompare.activeDifference", {
              line: activeDifference.rowIndex + 1,
            })
          : t("files.fileCompare.noDifferencesDetail")}
      </div>
      {isWorkspaceSession && canRenderWorkspace ? (
        session.paths.map((path) => (
          <WorkspaceCompareColumn
            key={`${session.workspaceId}:${path}`}
            workspaceId={session.workspaceId}
            workspacePath={workspacePath ?? ""}
            path={path}
            onDraftChange={handleDraftChange}
          />
        ))
      ) : session.kind === "scratch" ? null : (
        <div className="file-compare-empty">{t("files.fileCompare.workspaceUnavailable")}</div>
      )}
      <div
        className="file-compare-columns"
        style={{
          ["--file-compare-column-count" as string]: String(
            Math.max(1, sessionColumns.length),
          ),
        }}
      >
        {drafts.map((draft, index) => {
          return (
            <CompareEditorColumn
              key={draft.id}
              draft={draft}
              editorTheme={editorTheme}
              markers={markersByDraftId[draft.id] ?? EMPTY_GIT_LINE_MARKERS}
              lineGaps={diffResult.gapLineCountsByColumn[index] ?? []}
              saveFileShortcut={saveFileShortcut}
              activeLineNumber={
                activeDifference?.lineNumbersByColumn[index] ?? null
              }
            />
          );
        })}
      </div>
    </div>
  );
}
