import type {
  CompositionEvent,
  FormEvent,
  KeyboardEvent,
  MutableRefObject,
  MouseEvent,
  ReactNode,
  RefObject,
  SyntheticEvent,
} from "react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { EditorView } from "@codemirror/view";
import type { ReactCodeMirrorProps } from "@uiw/react-codemirror";
import {
  FileCodeMirrorEditor,
  type FileCodeMirrorEditorHandle,
} from "./FileCodeMirrorEditor";
import { FileDocumentPreview } from "./FileDocumentPreview";
import { FileMarkdownPreview } from "./FileMarkdownPreviewRouter";
import { FileStructuredPreview } from "./FileStructuredPreview";
import { FileTabularPreview } from "./FileTabularPreview";
import type { FilePreviewPayload } from "../hooks/useFilePreviewPayload";
import type { FileDocumentSnapshot } from "@/utils/fileDocumentSnapshot";
import type { FileViewSurface } from "../utils/fileViewSurface";
import { highlightLine } from "../../../utils/syntax";
import type { FileRenderPressure } from "../types/fileRenderPressure";
import type {
  FastMarkdownFeatureFlags,
  FastMarkdownRendererProfileId,
} from "../../markdown/fastMarkdownRenderer";
import type {
  CodeAnnotationLineRange,
  CodeAnnotationSelection,
} from "../../code-annotations/types";
import type {
  AnnotationWidgetCallbacks,
  FileAnnotationDraftState,
} from "./fileViewPanelShared";
import type { GitLineMarkers } from "../utils/gitLineMarkers";
import type { GitFileBlameResponse } from "../../../types";
import type { FileGitBlameStatus } from "../hooks/useFileGitBlame";
import type { NoteCaptureDraft } from "../../note-cards/types";
import { buildCodeSelectionNoteDraft } from "../../note-cards/utils/noteCapture";

const EDITOR_CONTENT_PUBLISH_DELAY_MS = 120;

const FilePdfPreview = lazy(() =>
  import("./FilePdfPreview").then((module) => ({
    default: module.FilePdfPreview,
  })),
);

type FileViewBodyProps = {
  workspaceId: string;
  filePath: string;
  sourceFilePath: string;
  documentKey: string;
  imageSrc: string | null;
  imageInfo: { width: number; height: number; sizeBytes: number | null } | null;
  handleImageLoad: (event: SyntheticEvent<HTMLImageElement>) => void;
  handleImageError: () => void;
  imageLoadError: string | null;
  error: string | null;
  isLoading: boolean;
  previewPayload: FilePreviewPayload | null;
  previewPayloadLoading: boolean;
  previewPayloadError: string | null;
  viewSurface: FileViewSurface;
  documentSnapshot: FileDocumentSnapshot;
  content: string;
  setContent: (value: string) => void;
  onEditorContentDraftChange?: (value: string) => void;
  onEditorContentPublished?: () => void;
  onEditorTypingInput?: (durationMs: number) => void;
  fileRenderPressure: FileRenderPressure;
  markdownPreviewSnapshotMode: "stable" | "live";
  markdownPreviewRefreshKey?: number | null;
  markdownPreviewContentOverride?: string | null;
  markdownRendererProfile?: FastMarkdownRendererProfileId;
  markdownFastFeatureFlags?: FastMarkdownFeatureFlags;
  onFastMarkdownRendererFallback?: (reason: string) => void;
  cmRef: RefObject<FileCodeMirrorEditorHandle | null>;
  onActiveFileLineRangeChange?: (
    range: { startLine: number; endLine: number } | null,
  ) => void;
  languageExtensions: ReactCodeMirrorProps["extensions"];
  gitLineMarkers: GitLineMarkers;
  gitBlameEnabled: boolean;
  gitBlameStatus: FileGitBlameStatus;
  gitBlameResponse: GitFileBlameResponse | null;
  onGitBlameContextMenu?: (position: { x: number; y: number }) => void;
  onFileContextMenu?: (
    event: MouseEvent<HTMLDivElement>,
    noteCaptureDraft?: NoteCaptureDraft,
  ) => void;
  editorCodeAnnotations: CodeAnnotationSelection[];
  editorAnnotationDraft: FileAnnotationDraftState | null;
  annotationWidgetLabels: {
    title: string;
    remove: string;
    placeholder: string;
    cancel: string;
    submit: string;
  };
  annotationWidgetCallbacks: AnnotationWidgetCallbacks;
  runDefinitionFromCursor: () => void;
  runImplementationsFromCursor: () => void;
  runReferencesFromCursor: () => void;
  resolveDefinitionAtOffset: (
    offset: number,
    view?: EditorView,
  ) => void | Promise<void>;
  onPreviewAnnotationStart?: (lineRange: CodeAnnotationLineRange) => void;
  annotationDraft?: {
    lineRange: CodeAnnotationLineRange;
    source: "file-preview-mode" | "file-edit-mode";
    body: string;
  } | null;
  codeAnnotations?: CodeAnnotationSelection[];
  onRemoveCodeAnnotation?: (annotationId: string) => void;
  onAnnotationDraftBodyChange?: (body: string) => void;
  onAnnotationDraftCancel?: () => void;
  onAnnotationDraftConfirm?: (bodyOverride?: string) => void;
  lastReportedLineRangeRef: MutableRefObject<string>;
  saveFileShortcut: string | null | undefined;
  expandSelectionShortcut: string | null | undefined;
  handleSave: () => void;
  editorTheme: "light" | "dark";
  previewLanguage: string | null;
  highlightedLines: string[];
  lines: string[];
  gitAddedLineNumberSet: Set<number>;
  gitModifiedLineNumberSet: Set<number>;
  formatFileSize: (bytes: number) => string;
  t: (key: string) => string;
};

type PreviewLineSelection = {
  start: number;
  end: number;
};

type AnnotationDraftSelection = {
  draftKey: string;
  start: number;
  end: number;
};

function formatAnnotationLineLabel(lineRange: CodeAnnotationLineRange) {
  return lineRange.startLine === lineRange.endLine
    ? `L${lineRange.startLine}`
    : `L${lineRange.startLine}-L${lineRange.endLine}`;
}

function InlineAnnotationDraft({
  draft,
  t,
  onBodyChange,
  onSelectionChange,
  selectionSnapshot,
  onCancel,
  onConfirm,
}: {
  draft: {
    lineRange: CodeAnnotationLineRange;
    body: string;
  };
  t: (key: string) => string;
  onBodyChange?: (body: string) => void;
  onSelectionChange?: (selection: AnnotationDraftSelection) => void;
  selectionSnapshot?: AnnotationDraftSelection | null;
  onCancel?: () => void;
  onConfirm?: (body: string) => void;
}) {
  const draftKey = useMemo(
    () => `${draft.lineRange.startLine}:${draft.lineRange.endLine}`,
    [draft.lineRange.endLine, draft.lineRange.startLine],
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const localBodyRef = useRef(draft.body);
  const selectionRef = useRef<AnnotationDraftSelection | null>(null);
  const isComposingRef = useRef(false);
  const lastDraftKeyRef = useRef(draftKey);
  const focusedDraftKeyRef = useRef<string | null>(null);
  const updateSubmitDisabled = useCallback((body: string) => {
    const submitButton = submitButtonRef.current;
    if (!submitButton) {
      return;
    }
    const isDisabled = !body.trim();
    submitButton.setAttribute("aria-disabled", String(isDisabled));
    submitButton.classList.toggle("is-disabled", isDisabled);
  }, []);
  const syncDraftBody = useCallback(
    (body: string, options: { notifyParent: boolean }) => {
      localBodyRef.current = body;
      updateSubmitDisabled(body);
      if (options.notifyParent) {
        onBodyChange?.(body);
      }
    },
    [onBodyChange, updateSubmitDisabled],
  );
  const recordSelection = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    selectionRef.current = {
      draftKey,
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
    onSelectionChange?.(selectionRef.current);
  }, [draftKey, onSelectionChange]);

  useEffect(() => {
    if (draftKey === lastDraftKeyRef.current) {
      return;
    }
    lastDraftKeyRef.current = draftKey;
    focusedDraftKeyRef.current = null;
    selectionRef.current = null;
    localBodyRef.current = draft.body;
    if (textareaRef.current && textareaRef.current.value !== draft.body) {
      textareaRef.current.value = draft.body;
    }
    updateSubmitDisabled(draft.body);
  }, [draft.body, draftKey, updateSubmitDisabled]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const activeElement = document.activeElement;
    const shouldRestoreFocus =
      activeElement === textarea ||
      activeElement === document.body ||
      activeElement === null;
    if (!shouldRestoreFocus) {
      updateSubmitDisabled(textarea.value);
      return;
    }
    const snapshotForDraft =
      selectionSnapshot?.draftKey === draftKey ? selectionSnapshot : null;
    if (focusedDraftKeyRef.current === draftKey && !snapshotForDraft) {
      return;
    }
    focusedDraftKeyRef.current = draftKey;
    textarea.focus();
    const nextSelection =
      selectionRef.current?.draftKey === draftKey
        ? selectionRef.current
        : (snapshotForDraft ?? {
            start: textarea.value.length,
            end: textarea.value.length,
          });
    textarea.setSelectionRange(nextSelection.start, nextSelection.end);
    updateSubmitDisabled(textarea.value);
  }, [draftKey, selectionSnapshot, updateSubmitDisabled]);

  const stopDraftEvent = useCallback((event: SyntheticEvent) => {
    event.stopPropagation();
  }, []);
  const handleDraftInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      event.stopPropagation();
      syncDraftBody(event.currentTarget.value, {
        notifyParent: !isComposingRef.current,
      });
      recordSelection();
    },
    [recordSelection, syncDraftBody],
  );
  const handleCompositionStart = useCallback(
    (event: CompositionEvent<HTMLTextAreaElement>) => {
      event.stopPropagation();
      isComposingRef.current = true;
    },
    [],
  );
  const handleCompositionEnd = useCallback(
    (event: CompositionEvent<HTMLTextAreaElement>) => {
      event.stopPropagation();
      isComposingRef.current = false;
      syncDraftBody(event.currentTarget.value, { notifyParent: true });
      recordSelection();
    },
    [recordSelection, syncDraftBody],
  );
  const handleDraftKeyUp = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      event.stopPropagation();
      recordSelection();
    },
    [recordSelection],
  );

  return (
    <div
      className="fvp-annotation-draft fvp-annotation-draft-inline"
      role="region"
      aria-label={t("files.annotationDraft")}
      onMouseDown={stopDraftEvent}
      onMouseUp={stopDraftEvent}
      onClick={stopDraftEvent}
      onKeyDown={stopDraftEvent}
    >
      <div className="fvp-annotation-draft-head">
        <span className="fvp-annotation-title">
          <span className="codicon codicon-comment-discussion" aria-hidden />
          {t("files.annotationDraft")}
        </span>
        <code>{formatAnnotationLineLabel(draft.lineRange)}</code>
      </div>
      <textarea
        ref={textareaRef}
        className="fvp-annotation-draft-input"
        defaultValue={draft.body}
        onChange={handleDraftInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onClick={recordSelection}
        onKeyUp={handleDraftKeyUp}
        onMouseUp={recordSelection}
        onSelect={recordSelection}
        placeholder={t("files.annotationPlaceholder")}
      />
      <div className="fvp-annotation-draft-actions">
        <button
          type="button"
          className="ghost fvp-action-btn"
          onClick={onCancel}
        >
          {t("common.cancel")}
        </button>
        <button
          ref={submitButtonRef}
          type="button"
          className="fvp-annotation-submit"
          onClick={() => {
            const body = textareaRef.current?.value ?? localBodyRef.current;
            if (!body.trim()) {
              return;
            }
            onConfirm?.(body);
          }}
          aria-disabled={!draft.body.trim()}
        >
          {t("files.annotationSubmit")}
        </button>
      </div>
    </div>
  );
}

function InlineAnnotationMarker({
  annotation,
  t,
  onRemove,
}: {
  annotation: CodeAnnotationSelection;
  t: (key: string) => string;
  onRemove?: (annotationId: string) => void;
}) {
  return (
    <div className="fvp-annotation-marker" role="note">
      <div className="fvp-annotation-marker-head">
        <span className="fvp-annotation-title">
          <span className="codicon codicon-comment-discussion" aria-hidden />
          {t("files.annotationDraft")}
        </span>
        <span className="fvp-annotation-marker-tools">
          <code>{formatAnnotationLineLabel(annotation.lineRange)}</code>
          {onRemove ? (
            <button
              type="button"
              className="fvp-annotation-remove"
              onClick={() => onRemove(annotation.id)}
              title={t("files.annotationRemove")}
              aria-label={t("files.annotationRemove")}
            >
              <span className="codicon codicon-close" aria-hidden />
            </button>
          ) : null}
        </span>
      </div>
      <p>{annotation.body}</p>
    </div>
  );
}

type CodePreviewVirtualListProps = {
  documentSnapshot: FileDocumentSnapshot;
  previewLanguage: string | null;
  useLowCostPreview: boolean;
  previewLineSelection: PreviewLineSelection | null;
  previewAnnotations: CodeAnnotationSelection[];
  previewDraft: {
    lineRange: CodeAnnotationLineRange;
    body: string;
  } | null;
  gitAddedLineNumberSet: Set<number>;
  gitModifiedLineNumberSet: Set<number>;
  onPreviewAnnotationStart?: (lineRange: CodeAnnotationLineRange) => void;
  onPreviewLineClick: (
    lineNumber: number,
    event: MouseEvent<HTMLDivElement>,
  ) => void;
  onPreviewLineMouseDown: (
    lineNumber: number,
    event: MouseEvent<HTMLDivElement>,
  ) => void;
  onPreviewLineMouseEnter: (lineNumber: number) => void;
  onPreviewLineMouseUp: () => void;
  renderAnnotationDraft: (draft: {
    lineRange: CodeAnnotationLineRange;
    body: string;
  }) => ReactNode;
  renderAnnotationMarker: (annotation: CodeAnnotationSelection) => ReactNode;
  t: (key: string) => string;
};

function CodePreviewVirtualList({
  documentSnapshot,
  previewLanguage,
  useLowCostPreview,
  previewLineSelection,
  previewAnnotations,
  previewDraft,
  gitAddedLineNumberSet,
  gitModifiedLineNumberSet,
  onPreviewAnnotationStart,
  onPreviewLineClick,
  onPreviewLineMouseDown,
  onPreviewLineMouseEnter,
  onPreviewLineMouseUp,
  renderAnnotationDraft,
  renderAnnotationMarker,
  t,
}: CodePreviewVirtualListProps) {
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const highlightedLineCacheRef = useRef<Map<string, string>>(new Map());
  const annotationBucketsByEndLine = useMemo(() => {
    const buckets = new Map<number, CodeAnnotationSelection[]>();
    for (const annotation of previewAnnotations) {
      const bucket = buckets.get(annotation.lineRange.endLine);
      if (bucket) {
        bucket.push(annotation);
      } else {
        buckets.set(annotation.lineRange.endLine, [annotation]);
      }
    }
    return buckets;
  }, [previewAnnotations]);

  useEffect(() => {
    highlightedLineCacheRef.current.clear();
  }, [documentSnapshot.contentHash, previewLanguage, useLowCostPreview]);

  const rowVirtualizer = useVirtualizer({
    count: documentSnapshot.lineCount,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 23,
    overscan: 12,
    getItemKey: (index) => `${documentSnapshot.contentHash}:${index}`,
  });

  const getHighlightedLine = useCallback(
    (lineIndex: number) => {
      const lineText = documentSnapshot.getLineText(lineIndex);
      if (useLowCostPreview) {
        return lineText
          ? lineText.replace(/[&<>"']/g, (char) => {
              switch (char) {
                case "&":
                  return "&amp;";
                case "<":
                  return "&lt;";
                case ">":
                  return "&gt;";
                case '"':
                  return "&quot;";
                default:
                  return "&#39;";
              }
            })
          : "&nbsp;";
      }
      const cacheKey = `${lineIndex}:${lineText}`;
      const cached = highlightedLineCacheRef.current.get(cacheKey);
      if (cached) {
        return cached;
      }
      const html = highlightLine(lineText, previewLanguage) || "&nbsp;";
      highlightedLineCacheRef.current.set(cacheKey, html);
      return html;
    },
    [documentSnapshot, previewLanguage, useLowCostPreview],
  );

  return (
    <div
      ref={scrollParentRef}
      className="fvp-code-preview is-virtualized"
      role="list"
      data-code-preview-line-count={documentSnapshot.lineCount}
      data-code-preview-snapshot-version={documentSnapshot.snapshotVersion}
    >
      <div
        className="fvp-code-preview-virtual-spacer"
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const lineNumber = virtualRow.index + 1;
          const html = getHighlightedLine(virtualRow.index);
          const isGitAddedLine = gitAddedLineNumberSet.has(lineNumber);
          const isGitModifiedLine = gitModifiedLineNumberSet.has(lineNumber);
          const isSelected = Boolean(
            previewLineSelection &&
            lineNumber >= previewLineSelection.start &&
            lineNumber <= previewLineSelection.end,
          );
          const lineAnnotations =
            annotationBucketsByEndLine.get(lineNumber) ?? [];
          const shouldRenderDraft =
            previewDraft?.lineRange.endLine === lineNumber;
          return (
            <div
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              className={`fvp-code-line${isGitModifiedLine ? " is-git-modified" : isGitAddedLine ? " is-git-added" : ""}${
                isSelected ? " is-selected" : ""
              }`}
              role={onPreviewAnnotationStart ? "button" : undefined}
              tabIndex={onPreviewAnnotationStart ? 0 : undefined}
              aria-pressed={onPreviewAnnotationStart ? isSelected : undefined}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
              onClick={(event) => onPreviewLineClick(lineNumber, event)}
              onMouseDown={(event) => onPreviewLineMouseDown(lineNumber, event)}
              onMouseEnter={() => onPreviewLineMouseEnter(lineNumber)}
              onMouseUp={onPreviewLineMouseUp}
            >
              <span className="fvp-line-number">
                {lineNumber}
                {onPreviewAnnotationStart ? (
                  <button
                    type="button"
                    className="fvp-line-annotation-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPreviewAnnotationStart({
                        startLine: lineNumber,
                        endLine: lineNumber,
                      });
                    }}
                    aria-label={`${t("files.annotateForAi")} L${lineNumber}`}
                    title={t("files.annotateForAi")}
                  >
                    +
                  </button>
                ) : null}
              </span>
              <span
                className="fvp-line-text"
                dangerouslySetInnerHTML={{ __html: html }}
              />
              {lineAnnotations.map(renderAnnotationMarker)}
              {shouldRenderDraft && previewDraft
                ? renderAnnotationDraft(previewDraft)
                : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FileViewBody({
  workspaceId,
  filePath,
  sourceFilePath,
  documentKey,
  imageSrc,
  imageInfo,
  handleImageLoad,
  handleImageError,
  imageLoadError,
  error,
  isLoading,
  previewPayload,
  previewPayloadLoading,
  previewPayloadError,
  viewSurface,
  documentSnapshot,
  content,
  setContent,
  onEditorContentDraftChange,
  onEditorContentPublished,
  onEditorTypingInput,
  fileRenderPressure,
  markdownPreviewSnapshotMode,
  markdownPreviewRefreshKey,
  markdownPreviewContentOverride,
  markdownRendererProfile,
  markdownFastFeatureFlags,
  onFastMarkdownRendererFallback,
  cmRef,
  onActiveFileLineRangeChange,
  languageExtensions,
  gitLineMarkers,
  gitBlameEnabled,
  gitBlameStatus,
  gitBlameResponse,
  onGitBlameContextMenu,
  onFileContextMenu,
  editorCodeAnnotations,
  editorAnnotationDraft,
  annotationWidgetLabels,
  annotationWidgetCallbacks,
  runDefinitionFromCursor,
  runImplementationsFromCursor,
  runReferencesFromCursor,
  resolveDefinitionAtOffset,
  onPreviewAnnotationStart,
  annotationDraft = null,
  codeAnnotations = [],
  onRemoveCodeAnnotation,
  onAnnotationDraftBodyChange,
  onAnnotationDraftCancel,
  onAnnotationDraftConfirm,
  lastReportedLineRangeRef,
  saveFileShortcut,
  expandSelectionShortcut,
  handleSave,
  editorTheme,
  previewLanguage,
  highlightedLines,
  lines,
  gitAddedLineNumberSet,
  gitModifiedLineNumberSet,
  formatFileSize,
  t,
}: FileViewBodyProps) {
  const [previewLineSelection, setPreviewLineSelection] =
    useState<PreviewLineSelection | null>(null);
  const [isPreviewDragSelecting, setIsPreviewDragSelecting] = useState(false);
  const previewDragAnchorRef = useRef<number | null>(null);
  const previewDragMovedRef = useRef(false);
  const annotationDraftSelectionRef = useRef<AnnotationDraftSelection | null>(
    null,
  );
  const previewAnnotations = codeAnnotations.filter(
    (annotation) => annotation.source === "file-preview-mode",
  );
  const previewDraft =
    annotationDraft?.source === "file-preview-mode" ? annotationDraft : null;
  const previousViewSurfaceKindRef = useRef(viewSurface.kind);
  const [editorContent, setEditorContent] = useState(content);
  const latestEditorContentRef = useRef(content);
  const lastPublishedEditorContentRef = useRef(content);
  const editorContentPublishTimerRef = useRef<number | null>(null);
  const [stableMarkdownPreviewSnapshot, setStableMarkdownPreviewSnapshot] =
    useState(() => ({
      documentKey,
      content,
    }));

  const handleEditorNoteCaptureContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const view = cmRef.current?.view;
      if (!view || !onFileContextMenu || event.defaultPrevented) {
        return;
      }
      const selection = view.state.selection.main;
      if (selection.empty) {
        return;
      }
      const startLine = view.state.doc.lineAt(selection.from).number;
      const rawEndLine = view.state.doc.lineAt(selection.to);
      const endLine =
        selection.to > selection.from && rawEndLine.from === selection.to
          ? Math.max(startLine, rawEndLine.number - 1)
          : rawEndLine.number;
      const draft = buildCodeSelectionNoteDraft({
        path: filePath,
        content: view.state.doc.sliceString(selection.from, selection.to),
        startLine,
        endLine,
        language: previewLanguage,
      });
      if (draft) {
        onFileContextMenu(event, draft);
      }
    },
    [cmRef, filePath, onFileContextMenu, previewLanguage],
  );

  const handlePreviewNoteCaptureContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (
        !previewLineSelection ||
        !onFileContextMenu ||
        event.defaultPrevented
      ) {
        return;
      }
      const draft = buildCodeSelectionNoteDraft({
        path: filePath,
        content: documentSnapshot
          .getLines(previewLineSelection.start - 1, previewLineSelection.end)
          .join("\n"),
        startLine: previewLineSelection.start,
        endLine: previewLineSelection.end,
        language: previewLanguage,
      });
      if (draft) {
        onFileContextMenu(event, draft);
      }
    },
    [
      documentSnapshot,
      filePath,
      onFileContextMenu,
      previewLanguage,
      previewLineSelection,
    ],
  );

  const clearEditorContentPublishTimer = useCallback(() => {
    if (editorContentPublishTimerRef.current === null) {
      return;
    }
    window.clearTimeout(editorContentPublishTimerRef.current);
    editorContentPublishTimerRef.current = null;
  }, []);

  const publishEditorContent = useCallback(() => {
    clearEditorContentPublishTimer();
    const nextContent = latestEditorContentRef.current;
    if (lastPublishedEditorContentRef.current === nextContent) {
      return;
    }
    lastPublishedEditorContentRef.current = nextContent;
    setContent(nextContent);
    onEditorContentPublished?.();
  }, [clearEditorContentPublishTimer, onEditorContentPublished, setContent]);

  const scheduleEditorContentPublish = useCallback(() => {
    clearEditorContentPublishTimer();
    editorContentPublishTimerRef.current = window.setTimeout(() => {
      editorContentPublishTimerRef.current = null;
      publishEditorContent();
    }, EDITOR_CONTENT_PUBLISH_DELAY_MS);
  }, [clearEditorContentPublishTimer, publishEditorContent]);

  const handleEditorContentChange = useCallback(
    (nextContent: string) => {
      const startedAt =
        typeof performance !== "undefined" &&
        typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      latestEditorContentRef.current = nextContent;
      onEditorContentDraftChange?.(nextContent);
      scheduleEditorContentPublish();
      const endedAt =
        typeof performance !== "undefined" &&
        typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      onEditorTypingInput?.(Math.max(0, endedAt - startedAt));
    },
    [
      onEditorContentDraftChange,
      onEditorTypingInput,
      scheduleEditorContentPublish,
    ],
  );

  useLayoutEffect(() => {
    clearEditorContentPublishTimer();
    latestEditorContentRef.current = content;
    lastPublishedEditorContentRef.current = content;
    setEditorContent(content);
    onEditorContentDraftChange?.(content);
  }, [
    clearEditorContentPublishTimer,
    content,
    documentKey,
    onEditorContentDraftChange,
  ]);

  useEffect(
    () => () => {
      publishEditorContent();
    },
    [publishEditorContent],
  );

  useEffect(() => {
    const previousKind = previousViewSurfaceKindRef.current;
    previousViewSurfaceKindRef.current = viewSurface.kind;
    if (isLoading) {
      return;
    }
    setStableMarkdownPreviewSnapshot((currentSnapshot) => {
      const documentChanged = currentSnapshot.documentKey !== documentKey;
      const enteringMarkdownPreview =
        previousKind !== "markdown-preview" &&
        viewSurface.kind === "markdown-preview";
      const needsInitialSnapshot =
        viewSurface.kind === "markdown-preview" &&
        currentSnapshot.content.length === 0 &&
        content.length > 0;
      const shouldUseLatestContent =
        documentChanged ||
        markdownPreviewSnapshotMode === "live" ||
        Boolean(markdownPreviewRefreshKey) ||
        enteringMarkdownPreview ||
        needsInitialSnapshot;
      if (!shouldUseLatestContent) {
        return currentSnapshot;
      }
      if (
        currentSnapshot.documentKey === documentKey &&
        currentSnapshot.content === content
      ) {
        return currentSnapshot;
      }
      return {
        documentKey,
        content,
      };
    });
  }, [
    content,
    documentKey,
    isLoading,
    markdownPreviewRefreshKey,
    markdownPreviewSnapshotMode,
    viewSurface.kind,
  ]);

  const selectPreviewLineRange = useCallback(
    (anchor: number, lineNumber: number) => {
      setPreviewLineSelection({
        start: Math.min(anchor, lineNumber),
        end: Math.max(anchor, lineNumber),
      });
    },
    [],
  );

  const handlePreviewLineMouseDown = useCallback(
    (lineNumber: number, event: MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !onPreviewAnnotationStart) {
        return;
      }
      event.preventDefault();
      setIsPreviewDragSelecting(true);
      const anchor =
        event.shiftKey && previewLineSelection
          ? previewLineSelection.start
          : lineNumber;
      previewDragAnchorRef.current = anchor;
      previewDragMovedRef.current = false;
      selectPreviewLineRange(anchor, lineNumber);
    },
    [onPreviewAnnotationStart, previewLineSelection, selectPreviewLineRange],
  );

  const handlePreviewLineMouseEnter = useCallback(
    (lineNumber: number) => {
      if (!isPreviewDragSelecting) {
        return;
      }
      const anchor = previewDragAnchorRef.current;
      if (anchor === null) {
        return;
      }
      if (anchor !== lineNumber) {
        previewDragMovedRef.current = true;
      }
      selectPreviewLineRange(anchor, lineNumber);
    },
    [isPreviewDragSelecting, selectPreviewLineRange],
  );

  const handlePreviewLineMouseUp = useCallback(() => {
    if (!isPreviewDragSelecting) {
      return;
    }
    setIsPreviewDragSelecting(false);
    previewDragAnchorRef.current = null;
  }, [isPreviewDragSelecting]);

  const handlePreviewLineClick = useCallback(
    (lineNumber: number, event: MouseEvent<HTMLDivElement>) => {
      if (!onPreviewAnnotationStart) {
        return;
      }
      if (previewDragMovedRef.current) {
        previewDragMovedRef.current = false;
        return;
      }
      if (event.shiftKey && previewLineSelection) {
        selectPreviewLineRange(previewLineSelection.start, lineNumber);
        return;
      }
      setPreviewLineSelection({ start: lineNumber, end: lineNumber });
    },
    [onPreviewAnnotationStart, previewLineSelection, selectPreviewLineRange],
  );

  useEffect(() => {
    if (!isPreviewDragSelecting) {
      return;
    }
    const handleWindowMouseUp = () => {
      setIsPreviewDragSelecting(false);
      previewDragAnchorRef.current = null;
    };
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => window.removeEventListener("mouseup", handleWindowMouseUp);
  }, [isPreviewDragSelecting]);

  useEffect(() => {
    setPreviewLineSelection(null);
    setIsPreviewDragSelecting(false);
    previewDragAnchorRef.current = null;
    previewDragMovedRef.current = false;
  }, [filePath, viewSurface.kind]);

  if (isLoading) {
    return <div className="fvp-status">{t("files.loadingFile")}</div>;
  }
  if (error) {
    return <div className="fvp-status fvp-error">{error}</div>;
  }

  if (viewSurface.kind === "image") {
    return (
      <div className="fvp-image-preview">
        {imageSrc ? (
          <div className="fvp-image-preview-inner">
            <img
              src={imageSrc}
              alt={filePath}
              className="fvp-image-preview-img"
              draggable={false}
              onLoad={handleImageLoad}
              onError={handleImageError}
            />
            {imageLoadError ? (
              <span className="fvp-image-info fvp-error">{imageLoadError}</span>
            ) : imageInfo ? (
              <span className="fvp-image-info">
                {imageInfo.width > 0 &&
                  `${imageInfo.width} × ${imageInfo.height}`}
                {imageInfo.width > 0 && imageInfo.sizeBytes != null && " · "}
                {imageInfo.sizeBytes != null
                  ? formatFileSize(imageInfo.sizeBytes)
                  : null}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="fvp-status fvp-error">{t("files.imagePreview")}</div>
        )}
      </div>
    );
  }

  if (viewSurface.kind === "binary-unsupported") {
    return <div className="fvp-status">{t("files.unsupportedFormat")}</div>;
  }

  if (viewSurface.kind === "pdf-preview") {
    return (
      <Suspense
        fallback={<div className="fvp-status">{t("files.loadingFile")}</div>}
      >
        <FilePdfPreview
          assetUrl={
            previewPayload?.kind === "file-handle" ||
            previewPayload?.kind === "asset-url"
              ? previewPayload.assetUrl
              : null
          }
          isLoading={previewPayloadLoading}
          error={previewPayloadError}
          t={t}
        />
      </Suspense>
    );
  }

  if (viewSurface.kind === "tabular-preview") {
    return (
      <FileTabularPreview
        payload={previewPayload}
        isLoading={previewPayloadLoading}
        error={previewPayloadError}
        t={t}
      />
    );
  }

  if (viewSurface.kind === "document-preview") {
    return (
      <FileDocumentPreview
        payload={previewPayload}
        isLoading={previewPayloadLoading}
        error={previewPayloadError}
        t={t}
      />
    );
  }

  if (viewSurface.kind === "editor") {
    return (
      <div
        className="fvp-editor-capture-surface"
        onContextMenu={handleEditorNoteCaptureContextMenu}
      >
        <FileCodeMirrorEditor
          cmRef={cmRef}
          filePath={filePath}
          value={editorContent}
          onChange={handleEditorContentChange}
          onActiveFileLineRangeChange={onActiveFileLineRangeChange}
          theme={editorTheme}
          languageExtensions={languageExtensions}
          gitLineMarkers={gitLineMarkers}
          gitBlameEnabled={gitBlameEnabled}
          gitBlameStatus={gitBlameStatus}
          gitBlameResponse={gitBlameResponse}
          onGitBlameContextMenu={onGitBlameContextMenu}
          codeAnnotations={editorCodeAnnotations}
          annotationDraft={editorAnnotationDraft}
          annotationWidgetLabels={annotationWidgetLabels}
          annotationWidgetCallbacks={annotationWidgetCallbacks}
          runDefinitionFromCursor={runDefinitionFromCursor}
          runImplementationsFromCursor={runImplementationsFromCursor}
          runReferencesFromCursor={runReferencesFromCursor}
          resolveDefinitionAtOffset={resolveDefinitionAtOffset}
          className="fvp-cm"
          lastReportedLineRangeRef={lastReportedLineRangeRef}
          saveFileShortcut={saveFileShortcut}
          expandSelectionShortcut={expandSelectionShortcut}
          handleSave={handleSave}
          gotoLineLabels={{
            title: t("files.gotoLine.title"),
            inputLabel: t("files.gotoLine.inputLabel"),
            placeholder: t("files.gotoLine.placeholder"),
            cancel: t("files.gotoLine.cancel"),
            confirm: t("files.gotoLine.confirm"),
            invalid: t("files.gotoLine.invalid"),
          }}
          fallback={<div className="fvp-status">{t("files.loadingFile")}</div>}
        />
      </div>
    );
  }

  if (viewSurface.kind === "markdown-preview") {
    const markdownPreviewContent =
      markdownPreviewContentOverride ??
      (markdownPreviewSnapshotMode === "live"
        ? content
        : stableMarkdownPreviewSnapshot.documentKey === documentKey &&
            stableMarkdownPreviewSnapshot.content.length > 0
          ? stableMarkdownPreviewSnapshot.content
          : content);
    return (
      <div className="fvp-markdown-preview-frame">
        <FileMarkdownPreview
          key={filePath}
          workspaceId={workspaceId}
          sourceFilePath={sourceFilePath}
          documentKey={documentKey}
          value={markdownPreviewContent}
          renderPressure={fileRenderPressure}
          className="fvp-file-markdown fvp-markdown-github"
          rendererProfile={markdownRendererProfile}
          featureFlags={markdownFastFeatureFlags}
          onFastRendererFallback={onFastMarkdownRendererFallback}
          t={t}
          onAnnotationStart={onPreviewAnnotationStart}
          annotationDraft={previewDraft}
          annotations={previewAnnotations}
          renderAnnotationDraft={(draft) => (
            <InlineAnnotationDraft
              draft={draft}
              t={t}
              onBodyChange={onAnnotationDraftBodyChange}
              onSelectionChange={(selection) => {
                annotationDraftSelectionRef.current = selection;
              }}
              selectionSnapshot={annotationDraftSelectionRef.current}
              onCancel={onAnnotationDraftCancel}
              onConfirm={onAnnotationDraftConfirm}
            />
          )}
          renderAnnotationMarker={(annotation) => (
            <InlineAnnotationMarker
              annotation={annotation}
              t={t}
              onRemove={onRemoveCodeAnnotation}
            />
          )}
          annotationActionLabel={t("files.annotateForAi")}
        />
      </div>
    );
  }

  if (viewSurface.kind === "structured-preview") {
    return (
      <div className="fvp-preview-scroll">
        <FileStructuredPreview
          key={filePath}
          filePath={filePath}
          value={content}
          documentSnapshot={documentSnapshot}
          className="fvp-structured-preview"
        />
      </div>
    );
  }

  const previewSelectionLabel = previewLineSelection
    ? previewLineSelection.start === previewLineSelection.end
      ? `L${previewLineSelection.start}`
      : `L${previewLineSelection.start}-L${previewLineSelection.end}`
    : null;
  const shouldUseVirtualCodePreview =
    viewSurface.kind === "code-preview" &&
    lines.length === 0 &&
    documentSnapshot.lineCount > 0;
  const renderPreviewAnnotationDraft = (draft: {
    lineRange: CodeAnnotationLineRange;
    body: string;
  }) => (
    <InlineAnnotationDraft
      draft={draft}
      t={t}
      onBodyChange={onAnnotationDraftBodyChange}
      onSelectionChange={(selection) => {
        annotationDraftSelectionRef.current = selection;
      }}
      selectionSnapshot={annotationDraftSelectionRef.current}
      onCancel={onAnnotationDraftCancel}
      onConfirm={onAnnotationDraftConfirm}
    />
  );
  const renderPreviewAnnotationMarker = (
    annotation: CodeAnnotationSelection,
  ) => (
    <InlineAnnotationMarker
      key={annotation.id}
      annotation={annotation}
      t={t}
      onRemove={onRemoveCodeAnnotation}
    />
  );

  return (
    <div
      className="fvp-code-preview-capture-surface"
      onContextMenu={handlePreviewNoteCaptureContextMenu}
    >
      {previewLineSelection && onPreviewAnnotationStart ? (
        <div
          className="fvp-preview-selection-toolbar"
          role="group"
          aria-label={t("files.annotationSelectionToolbar")}
        >
          <span>{previewSelectionLabel}</span>
          <button
            type="button"
            className="ghost fvp-action-btn"
            onClick={() => setPreviewLineSelection(null)}
          >
            {t("files.clearSelection")}
          </button>
          <button
            type="button"
            className="fvp-annotation-trigger"
            onClick={() =>
              onPreviewAnnotationStart({
                startLine: previewLineSelection.start,
                endLine: previewLineSelection.end,
              })
            }
          >
            {t("files.annotateForAi")}
          </button>
        </div>
      ) : null}
      {shouldUseVirtualCodePreview ? (
        <CodePreviewVirtualList
          documentSnapshot={documentSnapshot}
          previewLanguage={previewLanguage}
          useLowCostPreview={viewSurface.useLowCostPreview}
          previewLineSelection={previewLineSelection}
          previewAnnotations={previewAnnotations}
          previewDraft={previewDraft}
          gitAddedLineNumberSet={gitAddedLineNumberSet}
          gitModifiedLineNumberSet={gitModifiedLineNumberSet}
          onPreviewAnnotationStart={onPreviewAnnotationStart}
          onPreviewLineClick={handlePreviewLineClick}
          onPreviewLineMouseDown={handlePreviewLineMouseDown}
          onPreviewLineMouseEnter={handlePreviewLineMouseEnter}
          onPreviewLineMouseUp={handlePreviewLineMouseUp}
          renderAnnotationDraft={renderPreviewAnnotationDraft}
          renderAnnotationMarker={renderPreviewAnnotationMarker}
          t={t}
        />
      ) : (
        <div className="fvp-code-preview" role="list">
          {lines.map((_, index) => {
            const html = highlightedLines[index] ?? "&nbsp;";
            const lineNumber = index + 1;
            const isGitAddedLine = gitAddedLineNumberSet.has(lineNumber);
            const isGitModifiedLine = gitModifiedLineNumberSet.has(lineNumber);
            const isSelected = Boolean(
              previewLineSelection &&
              lineNumber >= previewLineSelection.start &&
              lineNumber <= previewLineSelection.end,
            );
            const lineAnnotations = previewAnnotations.filter(
              (annotation) => annotation.lineRange.endLine === lineNumber,
            );
            const shouldRenderDraft =
              previewDraft?.lineRange.endLine === lineNumber;
            return (
              <div
                key={`line-${index}`}
                className={`fvp-code-line${isGitModifiedLine ? " is-git-modified" : isGitAddedLine ? " is-git-added" : ""}${
                  isSelected ? " is-selected" : ""
                }`}
                role={onPreviewAnnotationStart ? "button" : undefined}
                tabIndex={onPreviewAnnotationStart ? 0 : undefined}
                aria-pressed={onPreviewAnnotationStart ? isSelected : undefined}
                onClick={(event) => handlePreviewLineClick(lineNumber, event)}
                onMouseDown={(event) =>
                  handlePreviewLineMouseDown(lineNumber, event)
                }
                onMouseEnter={() => handlePreviewLineMouseEnter(lineNumber)}
                onMouseUp={handlePreviewLineMouseUp}
              >
                <span className="fvp-line-number">
                  {lineNumber}
                  {onPreviewAnnotationStart ? (
                    <button
                      type="button"
                      className="fvp-line-annotation-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onPreviewAnnotationStart({
                          startLine: lineNumber,
                          endLine: lineNumber,
                        });
                      }}
                      aria-label={`${t("files.annotateForAi")} L${lineNumber}`}
                      title={t("files.annotateForAi")}
                    >
                      +
                    </button>
                  ) : null}
                </span>
                <span
                  className="fvp-line-text"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
                {lineAnnotations.map((annotation) =>
                  renderPreviewAnnotationMarker(annotation),
                )}
                {shouldRenderDraft
                  ? renderPreviewAnnotationDraft(previewDraft)
                  : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
