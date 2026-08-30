import { Fragment, lazy, memo, startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ImgHTMLAttributes } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "@tauri-apps/api/core";
import { LocalImage } from "../../components/common/LocalImage";
import { ImageFullscreenViewer } from "../../features/markdown/imageFullscreen";
import type { MarkdownOutlineEntry } from "../../features/markdown/fastMarkdownRenderer";
import { extractOutlineFromMarkdown } from "../presentation/messageOutlineExtractor";
import type {
  FullMarkdownComponents,
  FullMarkdownUrlTransform,
} from "../runtime/FullMarkdownRuntime";
import {
  LightweightMarkdown,
  PROGRESSIVE_REVEAL_CHUNK_CHARS,
  PROGRESSIVE_REVEAL_STEP_MS,
  type LightweightMarkdownLinkRenderer,
} from "../runtime/LiveMarkdown";
import { ToolCallBlock } from "../runtime/ToolCallBlock";
import {
  areKatexAssetsReady,
  detectMathContent,
  loadKatexAssets,
  normalizeMarkdownMathForMessage,
} from "../../features/markdown/markdownMath";
export { prewarmKatexAssets } from "../../features/markdown/markdownMath";

const FullMarkdownRuntime = lazy(() =>
  import("../runtime/FullMarkdownRuntime").then((module) => ({
    default: module.FullMarkdownRuntime,
  })),
);
import {
  decodeFileLink,
  isFileLinkUrl,
  isLinkableFilePath,
  normalizeBareWindowsFilePathLinksAround,
  rewriteWindowsAbsoluteMarkdownLinkDestinations,
  toFileLink,
} from "../../utils/remarkFileLinks";
import {
  getMarkdownInlineCodeInfo,
  normalizeOutsideMarkdownCode,
} from "../../utils/markdownCodeRegions";
import { parseToolCallBlocks, type Block } from "../presentation/toolCallBlocks";
import {
  createMessageMarkdownOptionsHash,
  createMessageMarkdownPrecomputeRequest,
  isStaleMessageMarkdownPrecomputeResult,
  runMessageMarkdownPrecompute,
} from "../../features/markdown/messageMarkdownPrecompute";
import {
  classifyMessageMarkdownHeavyIslands,
  EMPTY_MESSAGE_MARKDOWN_HEAVY_ISLAND_SUMMARY,
} from "../../features/markdown/messageMarkdownHeavyIslands";
import { appendMarkdownPrecomputeDiagnostic } from "../../services/rendererDiagnostics";
import { useRenderHotspot } from "../../services/perfBaseline/useRenderHotspot";
import {
  normalizeFragmentedLineBreaks,
  normalizeFragmentedParagraphBreaks,
  normalizeGithubBlockquoteAlerts,
  normalizeInlineOrderedListBreaks,
  normalizeListIndentation,
} from "../presentation/markdownTextNormalizers";
import {
  normalizeFragmentedResourceReferences,
  normalizeImageLocalPath,
  normalizeImageTags,
  normalizeMarkdownImageSrc,
  resolveLocalFileHref,
} from "../presentation/markdownLocalResources";
import {
  countMarkdownTableRowsFromNode,
  shouldDeferMarkdownTable,
} from "../presentation/markdownHeavyIslands";
import { useMarkdownStreamingValue } from "../hooks/useMarkdownStreamingValue";
import {
  DeferredMarkdownTable,
  extractAlertToneFromNode,
  PreBlock,
  type PreProps,
} from "./MarkdownBlocks";

type MarkdownProps = {
  value: string;
  className?: string;
  workspaceId?: string | null;
  codeBlock?: boolean;
  codeBlockStyle?: "default" | "message";
  codeBlockCopyUseModifier?: boolean;
  streamingThrottleMs?: number;
  softBreaks?: boolean;
  preserveFormatting?: boolean;
  liveRenderMode?: "full" | "lightweight";
  progressiveReveal?: boolean;
  progressiveRevealStepMs?: number;
  progressiveRevealChunkChars?: number;
  onOpenFileLink?: (path: string) => void;
  onOpenFileLinkMenu?: (event: React.MouseEvent, path: string) => void;
  onRenderedValueChange?: (value: string) => void;
  onOutlineReady?: (outline: MarkdownOutlineEntry[]) => void;
};

const TOOL_CALL_XML_CANDIDATE_REGEX = /<\s*(?:antml:)?(?:function_calls|invoke)\b/i;

function stableToolCallHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function buildToolCallBlockKey(block: Extract<Block, { kind: "tool-call" }>) {
  return `tcb-${block.startOffset}-${block.tagName}-${stableToolCallHash(block.keySignature)}`;
}

function areMarkdownPropsEqual(prev: MarkdownProps, next: MarkdownProps) {
  return (
    prev.value === next.value &&
    prev.className === next.className &&
    prev.workspaceId === next.workspaceId &&
    prev.codeBlock === next.codeBlock &&
    prev.codeBlockStyle === next.codeBlockStyle &&
    prev.codeBlockCopyUseModifier === next.codeBlockCopyUseModifier &&
    prev.streamingThrottleMs === next.streamingThrottleMs &&
    prev.softBreaks === next.softBreaks &&
    prev.preserveFormatting === next.preserveFormatting &&
    prev.liveRenderMode === next.liveRenderMode &&
    prev.progressiveReveal === next.progressiveReveal &&
    prev.progressiveRevealStepMs === next.progressiveRevealStepMs &&
    prev.progressiveRevealChunkChars === next.progressiveRevealChunkChars &&
    prev.onOpenFileLink === next.onOpenFileLink &&
    prev.onOpenFileLinkMenu === next.onOpenFileLinkMenu &&
    prev.onRenderedValueChange === next.onRenderedValueChange &&
    prev.onOutlineReady === next.onOutlineReady
  );
}

export const Markdown = memo(function Markdown({
  value,
  className,
  workspaceId = null,
  codeBlock,
  codeBlockStyle = "default",
  codeBlockCopyUseModifier = false,
  streamingThrottleMs = 80,
  softBreaks = false,
  preserveFormatting = false,
  liveRenderMode = "full",
  progressiveReveal = false,
  progressiveRevealStepMs = PROGRESSIVE_REVEAL_STEP_MS,
  progressiveRevealChunkChars = PROGRESSIVE_REVEAL_CHUNK_CHARS,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onRenderedValueChange,
  onOutlineReady,
}: MarkdownProps) {
  const { throttledValue, renderValue } = useMarkdownStreamingValue({
    value,
    streamingThrottleMs,
    progressiveReveal,
    progressiveRevealStepMs,
    progressiveRevealChunkChars,
  });
  const [imageFullscreen, setImageFullscreen] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const outlineCacheRef = useRef<{
    value: string;
    outline: MarkdownOutlineEntry[];
  } | null>(null);

  // Best-effort outline extraction for the floater. We use a lightweight
  // line-by-line scan over the raw markdown value (NOT the rendered
  // HAST) because the messages surface does not run the fast pipeline;
  // the floater only needs heading title + depth + source line, and
  // extracting from raw markdown keeps the cost bounded. We do NOT
  // extend `MarkdownOutlineEntry` (its id/startLine/endLine/anchor
  // fields are sufficient; we just compute them locally). If the
  // consumer does not pass `onOutlineReady`, the work is a no-op.
  useEffect(() => {
    if (!onOutlineReady) {
      return;
    }
    const cachedOutline = outlineCacheRef.current;
    const outline =
      cachedOutline?.value === throttledValue
        ? cachedOutline.outline
        : extractOutlineFromMarkdown(throttledValue);
    if (cachedOutline?.value !== throttledValue) {
      outlineCacheRef.current = {
        value: throttledValue,
        outline,
      };
    }
    try {
      onOutlineReady(outline);
    } catch {
      // consumer-side callback must not break the renderer
    }
  }, [throttledValue, onOutlineReady]);
  useRenderHotspot(
    "markdown-render",
    `${liveRenderMode}:${renderValue.length}ch`,
    liveRenderMode === "lightweight" || progressiveReveal,
  );

  useEffect(() => {
    onRenderedValueChange?.(renderValue);
  }, [onRenderedValueChange, renderValue]);

  // Memoize heavy text normalization to avoid re-running on every render
  const content = useMemo(() => {
    if (codeBlock) {
      return `\`\`\`\n${renderValue}\n\`\`\``;
    }
    if (preserveFormatting) {
      return renderValue;
    }
    if (liveRenderMode === "lightweight") {
      return renderValue.replace(/\r\n/g, "\n");
    }
    const normalizeDisplayText = (text: string) =>
      normalizeImageTags(
        rewriteWindowsAbsoluteMarkdownLinkDestinations(
          normalizeBareWindowsFilePathLinksAround(
            normalizeListIndentation(
              normalizeInlineOrderedListBreaks(
                normalizeGithubBlockquoteAlerts(
                  normalizeFragmentedLineBreaks(
                    normalizeFragmentedParagraphBreaks(text),
                  ),
                ),
              ),
            ),
            (protectedText) =>
              normalizeMarkdownMathForMessage(
                normalizeFragmentedResourceReferences(protectedText),
              ),
          ),
        ),
      );
    return normalizeOutsideMarkdownCode(renderValue, normalizeDisplayText);
  }, [renderValue, codeBlock, liveRenderMode, preserveFormatting]);
  // 轻量流式 / 纯代码块模式下 shouldDeferMarkdownHeavyIslands 短路、precompute effect 早退，
  // 该分类结果全不参与渲染；此时跳过每 token 的全行重扫，返回稳定空摘要。
  const markdownHeavyIslandSummary = useMemo(
    () =>
      liveRenderMode === "lightweight" || codeBlock
        ? EMPTY_MESSAGE_MARKDOWN_HEAVY_ISLAND_SUMMARY
        : classifyMessageMarkdownHeavyIslands(content),
    [content, liveRenderMode, codeBlock],
  );
  const shouldDeferMarkdownHeavyIslands =
    liveRenderMode !== "lightweight" &&
    !codeBlock &&
    markdownHeavyIslandSummary.totalHeavyIslands > 0;
  const toolCallBlocks = useMemo(() => parseToolCallBlocks(content), [content]);
  const shouldRenderToolCallSegments = !(
    toolCallBlocks.length === 1 && toolCallBlocks[0]?.kind === "md"
  );
  const sourceMarkdownRef = useRef(content);
  sourceMarkdownRef.current = content;

  // Stable callback refs for file link handlers
  const onOpenFileLinkRef = useRef(onOpenFileLink);
  onOpenFileLinkRef.current = onOpenFileLink;
  const onOpenFileLinkMenuRef = useRef(onOpenFileLinkMenu);
  onOpenFileLinkMenuRef.current = onOpenFileLinkMenu;

  const handleFileLinkClick = useCallback((event: React.MouseEvent, path: string) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenFileLinkRef.current?.(path);
  }, []);
  const handleFileLinkContextMenu = useCallback((
    event: React.MouseEvent,
    path: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenFileLinkMenuRef.current?.(event, path);
  }, []);

  // Memoize ReactMarkdown components to prevent full re-initialization on every render.
  // This is critical: when components/plugins change reference, ReactMarkdown
  // discards its entire internal HAST tree and re-parses from scratch.
  const components = useMemo<FullMarkdownComponents>(() => {
    const result: FullMarkdownComponents = {
      a: ({ href, children }) => {
        const url = href ?? "";
        if (isFileLinkUrl(url)) {
          const path = decodeFileLink(url);
          return (
            <a
              href={href}
              onClick={(event) => handleFileLinkClick(event, path)}
              onContextMenu={(event) => handleFileLinkContextMenu(event, path)}
            >
              {children}
            </a>
          );
        }
        const localFilePath = resolveLocalFileHref(url);
        if (localFilePath) {
          return (
            <a
              href={href}
              onClick={(event) => handleFileLinkClick(event, localFilePath)}
              onContextMenu={(event) =>
                handleFileLinkContextMenu(event, localFilePath)
              }
            >
              {children}
            </a>
          );
        }
        const isExternal =
          url.startsWith("http://") ||
          url.startsWith("https://") ||
          url.startsWith("mailto:");

        if (!isExternal) {
          return <a href={href}>{children}</a>;
        }

        return (
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void openUrl(url);
            }}
          >
            {children}
          </a>
        );
      },
      code: ({ className: codeClassName, children }) => {
        if (codeClassName) {
          return <code className={codeClassName}>{children}</code>;
        }
        const text = String(children ?? "").trim();
        if (!text || !isLinkableFilePath(text)) {
          return <code>{children}</code>;
        }
        const href = toFileLink(text);
        return (
          <a
            href={href}
            onClick={(event) => handleFileLinkClick(event, text)}
            onContextMenu={(event) => handleFileLinkContextMenu(event, text)}
          >
            <code>{children}</code>
          </a>
        );
      },
      img: ({ src, alt, ...props }) => {
        const imageProps = props as ImgHTMLAttributes<HTMLImageElement>;
        const fallbackLocalPath = normalizeImageLocalPath(src ?? "");
        const normalizedSrc = normalizeMarkdownImageSrc(src ?? "", convertFileSrc);
        if (!normalizedSrc) {
          return null;
        }
        return (
          <LocalImage
            {...imageProps}
            src={normalizedSrc}
            localPath={fallbackLocalPath}
            workspaceId={workspaceId}
            alt={alt ?? "image"}
            loading="lazy"
            onClick={() =>
              setImageFullscreen({
                src: normalizedSrc,
                alt: alt ?? "image",
              })
            }
          />
        );
      },
      table: ({ node, children }) => {
        const rowCount = countMarkdownTableRowsFromNode(node);
        if (!shouldDeferMarkdownHeavyIslands || !shouldDeferMarkdownTable(rowCount)) {
          return <table>{children}</table>;
        }
        return (
          <DeferredMarkdownTable rowCount={rowCount}>
            {children}
          </DeferredMarkdownTable>
        );
      },
    };

    if (codeBlockStyle === "message") {
      result.pre = ({ node, children }) => (
        <PreBlock
          node={node as PreProps["node"]}
          copyUseModifier={codeBlockCopyUseModifier}
          sourceMarkdown={sourceMarkdownRef.current}
          workspaceId={workspaceId}
          onOpenFileLink={onOpenFileLink}
          onOpenFileLinkMenu={onOpenFileLinkMenu}
        >
          {children}
        </PreBlock>
      );
    }

    result.blockquote = ({ children }) => {
      const alertTone = extractAlertToneFromNode(children);
      return (
        <blockquote className={alertTone ? `markdown-alert markdown-alert-${alertTone}` : undefined}>
          {children}
        </blockquote>
      );
    };

    return result;
  }, [
    handleFileLinkClick,
    handleFileLinkContextMenu,
    codeBlockStyle,
    codeBlockCopyUseModifier,
    onOpenFileLink,
    onOpenFileLinkMenu,
    shouldDeferMarkdownHeavyIslands,
    workspaceId,
  ]);

  // keyed 在节流后的 renderValue 上：流式期间每个 token 的紧急渲染不再全文重扫，
  // 数学检测跟随实际渲染内容（KaTeX 只为渲染出的内容加载）。
  const hasMathContent = useMemo(() => detectMathContent(renderValue), [renderValue]);
  const markdownPrecomputeOptionsHash = useMemo(() => createMessageMarkdownOptionsHash({
    codeBlockStyle,
    hasFileLinkHandlers: Boolean(onOpenFileLink || onOpenFileLinkMenu),
    hasMathContent,
    preserveFormatting,
    softBreaks,
  }), [
    codeBlockStyle,
    hasMathContent,
    onOpenFileLink,
    onOpenFileLinkMenu,
    preserveFormatting,
    softBreaks,
  ]);
  useEffect(() => {
    if (liveRenderMode === "lightweight" || codeBlock) {
      return undefined;
    }
    const request = createMessageMarkdownPrecomputeRequest({
      messageId: workspaceId ? `workspace:${workspaceId}` : "message:unknown",
      source: content,
      optionsHash: markdownPrecomputeOptionsHash,
    });
    let cancelled = false;
    void runMessageMarkdownPrecompute(request).then((result) => {
      if (cancelled) {
        return;
      }
      if (isStaleMessageMarkdownPrecomputeResult(result, request)) {
        appendMarkdownPrecomputeDiagnostic({
          mode: result.mode,
          durationMs: result.durationMs,
          contentLength: result.sourceLength,
          contentHash: result.contentHash,
          thresholdReason: result.thresholdReason,
          cacheState: result.cacheState,
          fallbackReason: "stale-drop",
          evidenceClass: "proxy",
          heavyCategoryCounts: markdownHeavyIslandSummary.categoryCounts,
          totalHeadings: result.precomputeResult?.totalHeadings,
          totalHeavyBlocks: result.precomputeResult?.totalHeavyBlocks,
          totalSourceLines: result.precomputeResult?.totalSourceLines,
        });
        return;
      }
      appendMarkdownPrecomputeDiagnostic({
        mode: result.mode,
        durationMs: result.durationMs,
        contentLength: result.sourceLength,
        contentHash: result.contentHash,
        thresholdReason: result.thresholdReason,
        cacheState: result.cacheState,
        fallbackReason: result.fallbackReason,
        evidenceClass: result.evidenceClass,
        heavyCategoryCounts: markdownHeavyIslandSummary.categoryCounts,
        totalHeadings: result.precomputeResult?.totalHeadings,
        totalHeavyBlocks: result.precomputeResult?.totalHeavyBlocks,
        totalSourceLines: result.precomputeResult?.totalSourceLines,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    codeBlock,
    content,
    liveRenderMode,
    markdownPrecomputeOptionsHash,
    markdownHeavyIslandSummary.categoryCounts,
    workspaceId,
  ]);
  const [katexReady, setKatexReady] = useState(
    () => areKatexAssetsReady(),
  );
  useEffect(() => {
    if (!hasMathContent || katexReady) return;
    let cancelled = false;
    loadKatexAssets().then(() => {
      if (cancelled) return;
      startTransition(() => setKatexReady(true));
    });
    return () => {
      cancelled = true;
    };
  }, [hasMathContent, katexReady]);
  const urlTransform = useCallback<FullMarkdownUrlTransform>((url: string) => {
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
    if (
      isFileLinkUrl(url) ||
      url.startsWith("http://") ||
      url.startsWith("https://") ||
      url.startsWith("file://") ||
      url.startsWith("mailto:") ||
      url.startsWith("#") ||
      url.startsWith("/") ||
      url.startsWith("./") ||
      url.startsWith("../") ||
      /^[A-Za-z]:[\\/]/.test(url)
    ) {
      return url;
    }
    if (!hasScheme) {
      return url;
    }
    return "";
  }, []);
  const renderLightweightLink = useCallback<LightweightMarkdownLinkRenderer>(
    ({ href, children }) => {
      const safeHref = urlTransform(href);
      if (!safeHref) {
        return <>{children}</>;
      }
      if (isFileLinkUrl(safeHref)) {
        const path = decodeFileLink(safeHref);
        return (
          <a
            href={safeHref}
            onClick={(event) => handleFileLinkClick(event, path)}
            onContextMenu={(event) => handleFileLinkContextMenu(event, path)}
          >
            {children}
          </a>
        );
      }
      const localFilePath = resolveLocalFileHref(safeHref);
      if (localFilePath) {
        return (
          <a
            href={safeHref}
            onClick={(event) => handleFileLinkClick(event, localFilePath)}
            onContextMenu={(event) => handleFileLinkContextMenu(event, localFilePath)}
          >
            {children}
          </a>
        );
      }
      const isExternal =
        safeHref.startsWith("http://") ||
        safeHref.startsWith("https://") ||
        safeHref.startsWith("mailto:");
      if (!isExternal) {
        return <a href={safeHref}>{children}</a>;
      }
      return (
        <a
          href={safeHref}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void openUrl(safeHref);
          }}
        >
          {children}
        </a>
      );
    },
    [handleFileLinkClick, handleFileLinkContextMenu, urlTransform],
  );

  const renderMarkdownContent = useCallback((nextContent: string) => {
    const hasSyntaxIncompleteInlineCode =
      getMarkdownInlineCodeInfo(nextContent).hasUnclosedInlineCode;
    const shouldUseStreamingInlineCodeFallback =
      streamingThrottleMs !== undefined &&
      hasSyntaxIncompleteInlineCode &&
      TOOL_CALL_XML_CANDIDATE_REGEX.test(nextContent);
    if (liveRenderMode === "lightweight" || shouldUseStreamingInlineCodeFallback) {
      return (
        <LightweightMarkdown
          value={nextContent}
          renderLink={renderLightweightLink}
        />
      );
    }
    return (
      <Suspense
        fallback={(
          <LightweightMarkdown
            value={nextContent}
            renderLink={renderLightweightLink}
          />
        )}
      >
        <FullMarkdownRuntime
          value={nextContent}
          softBreaks={softBreaks}
          katexReady={katexReady}
          urlTransform={urlTransform}
          components={components}
        />
      </Suspense>
    );
  }, [
    components,
    katexReady,
    liveRenderMode,
    renderLightweightLink,
    softBreaks,
    streamingThrottleMs,
    urlTransform,
  ]);

  return (
    <div className={className}>
      <ImageFullscreenViewer
        open={!!imageFullscreen}
        src={imageFullscreen?.src ?? ""}
        alt={imageFullscreen?.alt}
        workspaceId={workspaceId}
        onClose={() => setImageFullscreen(null)}
      />
      {shouldRenderToolCallSegments
        ? toolCallBlocks.map((block, index) => {
          if (block.kind === "md") {
            return (
              <Fragment key={`md-${index}`}>
                {renderMarkdownContent(block.content)}
              </Fragment>
            );
          }
          return (
            <ToolCallBlock
              key={buildToolCallBlockKey(block)}
              raw={block.raw}
              tool={block.tool}
              params={block.params}
              complete={block.complete}
              isLive={!block.complete}
            />
          );
        })
        : renderMarkdownContent(content)}
    </div>
  );
}, areMarkdownPropsEqual);
