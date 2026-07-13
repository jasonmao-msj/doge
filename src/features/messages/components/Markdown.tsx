import { Fragment, lazy, memo, startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState, isValidElement, type ImgHTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "@tauri-apps/api/core";
import { LocalImage } from "./LocalImage";
import { PluginPreviewEntry } from "../../plugins/components/PluginPreviewEntry";
import { GlossaryTermChip } from "../../plugins/components/GlossaryTermChip";
import { GLOSSARY_TERM_TAG } from "../../plugins/glossary";
import { useGlossaryRehypePlugin } from "../../plugins/glossaryStore";
import { ImageFullscreenViewer } from "../../markdown/imageFullscreen";
import type { MarkdownOutlineEntry } from "../../markdown/fastMarkdownRenderer";
import { extractOutlineFromMarkdown } from "../utils/messageOutlineExtractor";
import type {
  FullMarkdownComponents,
  FullMarkdownUrlTransform,
} from "./FullMarkdownRuntime";
import {
  LightweightMarkdown,
  resolveAdaptiveProgressiveRevealStepMs,
  PROGRESSIVE_REVEAL_CHUNK_CHARS,
  PROGRESSIVE_REVEAL_STEP_MS,
  normalizeProgressiveRevealChunkChars,
  normalizeProgressiveRevealStepMs,
  resolveProgressiveRevealValue,
  type LightweightMarkdownLinkRenderer,
} from "./LiveMarkdown";
import { ToolCallBlock } from "./ToolCallBlock";
import {
  areKatexAssetsReady,
  buildLatexRenderEntries,
  detectMathContent,
  isKatexRenderReady,
  loadKatexAssets,
  normalizeMarkdownMathForMessage,
  renderLatexFormula,
} from "../../markdown/markdownMath";
export { prewarmKatexAssets } from "../../markdown/markdownMath";

const MermaidBlock = lazy(() => import("./MermaidBlock"));
const FullMarkdownRuntime = lazy(() =>
  import("./FullMarkdownRuntime").then((module) => ({
    default: module.FullMarkdownRuntime,
  })),
);
import {
  decodeFileLink,
  isFileLinkUrl,
  isLinkableFilePath,
  toFileLink,
} from "../../../utils/remarkFileLinks";
import {
  getMarkdownInlineCodeInfo,
  normalizeOutsideMarkdownCode,
} from "../../../utils/markdownCodeRegions";
import { highlightLine } from "../../../utils/syntax";
import { CodeBlockCopyButton, CodeBlockLanguageBadge } from "./codeBlockLanguageIcon";
import { detectCodexLeadMarker, type CodexLeadMarkerConfig } from "../constants/codexLeadMarkers";
import { parseToolCallBlocks, type Block } from "../utils/toolCallBlocks";
import {
  createMessageMarkdownOptionsHash,
  createMessageMarkdownPrecomputeRequest,
  isStaleMessageMarkdownPrecomputeResult,
  runMessageMarkdownPrecompute,
} from "../../markdown/messageMarkdownPrecompute";
import {
  classifyMessageMarkdownHeavyIslands,
  EMPTY_MESSAGE_MARKDOWN_HEAVY_ISLAND_SUMMARY,
} from "../../markdown/messageMarkdownHeavyIslands";
import { appendMarkdownPrecomputeDiagnostic } from "../../../services/rendererDiagnostics";
import { useRenderHotspot } from "../../../services/perfBaseline/useRenderHotspot";
import {
  extractCodeFromPre,
  extractLanguageTag,
  extractLatexContent,
  extractMarkdownContent,
  extractMermaidContent,
  extractUrlLines,
  shouldRenderMarkdownFenceAsCard,
  type MarkdownPreNode,
} from "./markdownCodeBlockHelpers";
import {
  normalizeFragmentedLineBreaks,
  normalizeFragmentedParagraphBreaks,
  normalizeGithubBlockquoteAlerts,
  normalizeInlineOrderedListBreaks,
  normalizeListIndentation,
} from "./markdownTextNormalizers";

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
  codexLeadMarkerConfig?: CodexLeadMarkerConfig;
  onOpenFileLink?: (path: string) => void;
  onOpenFileLinkMenu?: (event: React.MouseEvent, path: string) => void;
  onRenderedValueChange?: (value: string) => void;
  onOutlineReady?: (outline: MarkdownOutlineEntry[]) => void;
};

type CodeBlockProps = {
  className?: string;
  value: string;
  copyUseModifier: boolean;
};

type PreProps = {
  node?: MarkdownPreNode;
  children?: ReactNode;
  copyUseModifier: boolean;
  sourceMarkdown: string;
  workspaceId: string | null;
  onOpenFileLink?: (path: string) => void;
  onOpenFileLinkMenu?: (event: React.MouseEvent, path: string) => void;
};

type LinkBlockProps = {
  urls: string[];
};

type DeferredCodeBlockProps = CodeBlockProps & {
  languageLabel: string;
  lineCount: number;
};

type DeferredMarkdownTableProps = {
  children: ReactNode;
  rowCount: number;
};

const HEAVY_CODE_BLOCK_MIN_LINES = 40;
const HEAVY_CODE_BLOCK_MIN_CHARS = 4_000;
const HEAVY_TABLE_MIN_ROWS = 12;
const TOOL_CALL_XML_CANDIDATE_REGEX = /<\s*(?:antml:)?(?:function_calls|invoke)\b/i;
const MARKDOWN_IMAGE_FILE_EXTENSION_REGEX =
  /\.(png|jpe?g|gif|webp|bmp|tiff?|svg|ico|avif)(?:[?#].*)?$/i;

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
    prev.codexLeadMarkerConfig === next.codexLeadMarkerConfig &&
    prev.onOpenFileLink === next.onOpenFileLink &&
    prev.onOpenFileLinkMenu === next.onOpenFileLinkMenu &&
    prev.onRenderedValueChange === next.onRenderedValueChange &&
    prev.onOutlineReady === next.onOutlineReady
  );
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseImageAttributes(raw: string) {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][-\w.:]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(raw)) !== null) {
    const key = match[1]?.toLowerCase();
    if (!key) {
      continue;
    }
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    attributes[key] = value;
  }
  return attributes;
}

function toHtmlImageTag(src: string, alt?: string, title?: string) {
  const safeSrc = escapeHtmlAttribute(src.trim());
  if (!safeSrc) {
    return "";
  }
  const safeAlt = escapeHtmlAttribute((alt ?? "image").trim() || "image");
  const titlePart = title && title.trim()
    ? ` title="${escapeHtmlAttribute(title.trim())}"`
    : "";
  return `<img src="${safeSrc}" alt="${safeAlt}" loading="lazy"${titlePart} />`;
}

function normalizeMarkdownLocalImageSyntax(value: string) {
  return value.replace(
    /!\[([^\]]*)\]\((file:\/\/[^\s)]+|[A-Za-z]:[\\/][^\s)]*)(?:\s+"([^"]*)")?\)/g,
    (match, rawAlt: string, rawSrc: string, rawTitle: string) => {
      const normalizedLocalPath = normalizeImageLocalPath(rawSrc);
      let renderSrc = normalizedLocalPath ?? rawSrc;
      if (/^[A-Za-z]:[\\/]/.test(renderSrc)) {
        renderSrc = `/${renderSrc}`;
      }
      const next = toHtmlImageTag(renderSrc, rawAlt, rawTitle);
      return next || match;
    },
  );
}

function normalizeImageTags(value: string) {
  let changed = false;
  const withLocalMarkdownImages = normalizeMarkdownLocalImageSyntax(value);
  if (withLocalMarkdownImages !== value) {
    changed = true;
  }

  const withBlockTags = withLocalMarkdownImages.replace(
    /<image>\s*([\s\S]*?)\s*<\/image>/gi,
    (_match, body: string) => {
      const src = body.trim();
      const next = toHtmlImageTag(src);
      if (!next) {
        return _match;
      }
      changed = true;
      return next;
    },
  );

  const withSelfClosingTags = withBlockTags.replace(
    /<image\b([^>]*)\/?>/gi,
    (match, rawAttrs: string) => {
      const attrs = parseImageAttributes(rawAttrs ?? "");
      const src = attrs.src?.trim();
      if (!src) {
        return match;
      }
      const next = toHtmlImageTag(src, attrs.alt, attrs.title);
      if (!next) {
        return match;
      }
      changed = true;
      return next;
    },
  );

  return changed ? withSelfClosingTags : value;
}

function safeDecodeUrl(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripFileScheme(value: string) {
  if (!value.startsWith("file://")) {
    return value;
  }
  const withoutScheme = value.slice("file://".length);
  if (withoutScheme.startsWith("localhost/")) {
    return `/${withoutScheme.slice("localhost/".length)}`;
  }
  if (withoutScheme.startsWith("/")) {
    return withoutScheme;
  }
  return `/${withoutScheme}`;
}

function isLikelyAbsoluteFilePath(value: string) {
  if (!value.startsWith("/")) {
    return false;
  }
  const pathBody = value.slice(1);
  if (!pathBody) {
    return false;
  }
  return pathBody.includes("/") || pathBody.includes(".");
}

function resolveLocalFileHref(url: string) {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const normalized = repairFragmentedResourceToken(
    stripFileScheme(safeDecodeUrl(trimmed)),
  );
  const pathWithoutFragment = normalized.split("#", 1)[0] ?? normalized;
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(normalized)
  ) {
    if (normalized.startsWith("/") && !isLikelyAbsoluteFilePath(pathWithoutFragment)) {
      return null;
    }
    return normalized;
  }
  return isLinkableFilePath(normalized) ? normalized : null;
}

function decodeUrlValueSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function looksLikeResourceReference(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (!compact) {
    return false;
  }
  return (
    /(https?:\/\/|file:\/\/|\/Users\/|data:image\/)/i.test(compact) ||
    /^[A-Za-z]:[\\/]/.test(compact) ||
    MARKDOWN_IMAGE_FILE_EXTENSION_REGEX.test(compact)
  );
}

function repairFragmentedResourceToken(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !looksLikeResourceReference(trimmed)) {
    return trimmed;
  }
  let repaired = trimmed;
  repaired = repaired.replace(/(https?):\s*\/\s*\//gi, "$1://");
  repaired = repaired.replace(/file:\s*\/\s*\//gi, "file://");
  repaired = repaired.replace(/([A-Za-z0-9])\s+([./\\:_-])/g, "$1$2");
  repaired = repaired.replace(/([./\\:_-])\s+([A-Za-z0-9])/g, "$1$2");
  return repaired.trim();
}

function normalizeFragmentedResourceReferences(value: string) {
  const withMarkdownTargets = value.replace(
    /(!?\[[^\]]*]\()([\s\S]*?)(\))/g,
    (match, prefix: string, rawTarget: string, suffix: string) => {
      const repaired = repairFragmentedResourceToken(rawTarget);
      if (!repaired || repaired === rawTarget || !looksLikeResourceReference(repaired)) {
        return match;
      }
      return `${prefix}${repaired}${suffix}`;
    },
  );
  const source = withMarkdownTargets;
  const lines = source.split(/\r?\n/);
  let changed = false;
  const normalized = lines.map((line) => {
    if (!looksLikeResourceReference(line)) {
      return line;
    }
    const repaired = repairFragmentedResourceToken(line);
    if (repaired !== line) {
      changed = true;
    }
    return repaired;
  });
  if (!changed) {
    return source;
  }
  return normalized.join("\n");
}

function normalizeImageLocalPath(src: string) {
  const decoded = repairFragmentedResourceToken(decodeUrlValueSafe(src.trim()));
  if (!decoded) {
    return null;
  }
  if (/^\/[A-Za-z]:[\\/]/.test(decoded)) {
    return decoded.slice(1);
  }
  if (decoded.startsWith("file://")) {
    const withoutScheme = decoded.slice("file://".length);
    const withoutHost = withoutScheme.startsWith("localhost/")
      ? withoutScheme.slice("localhost/".length)
      : withoutScheme;
    if (/^\/[A-Za-z]:[\\/]/.test(withoutHost)) {
      return withoutHost.slice(1);
    }
    if (/^[A-Za-z]:[\\/]/.test(withoutHost)) {
      return withoutHost;
    }
    if (withoutHost.startsWith("/")) {
      return withoutHost;
    }
    return `/${withoutHost}`;
  }
  if (
    decoded.startsWith("/") ||
    decoded.startsWith("./") ||
    decoded.startsWith("../") ||
    decoded.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(decoded) ||
    /^\\\\[^\\]/.test(decoded)
  ) {
    return decoded;
  }
  return null;
}

function normalizeMarkdownImageSrc(src: string) {
  const trimmed = src.trim();
  if (!trimmed) {
    return "";
  }
  const cleaned = repairFragmentedResourceToken(
    trimmed
    .replace(/^<(.+)>$/, "$1")
    .replace(/^['"](.+)['"]$/, "$1")
    .trim(),
  );
  if (!cleaned) {
    return "";
  }
  if (
    cleaned.startsWith("data:") ||
    cleaned.startsWith("http://") ||
    cleaned.startsWith("https://") ||
    cleaned.startsWith("asset://")
  ) {
    return cleaned;
  }
  const localPath = normalizeImageLocalPath(cleaned);
  const imageLikeLocal = MARKDOWN_IMAGE_FILE_EXTENSION_REGEX.test(cleaned);
  if (!localPath && !imageLikeLocal) {
    return "";
  }
  try {
    return convertFileSrc(localPath ?? cleaned);
  } catch {
    return "";
  }
}

function LinkBlock({ urls }: LinkBlockProps) {
  return (
    <div className="markdown-linkblock">
      {urls.map((url, index) => (
        <a
          key={`${url}-${index}`}
          href={url}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void openUrl(url);
          }}
        >
          {url}
        </a>
      ))}
    </div>
  );
}

function renderHighlightedCodeLines(value: string, languageTag: string | null) {
  return value.split("\n").map((line, index) => (
    <span
      key={`${index}:${line.length}`}
      className="markdown-codeblock-line"
      dangerouslySetInnerHTML={{ __html: highlightLine(line, languageTag) }}
    />
  ));
}

function CodeBlock({ className, value, copyUseModifier }: CodeBlockProps) {
  const languageTag = extractLanguageTag(className);
  const languageLabel = languageTag ?? "Code";
  const fencedValue = `\`\`\`${languageTag ?? ""}\n${value}\n\`\`\``;
  const highlightedLines = useMemo(
    () => renderHighlightedCodeLines(value, languageTag),
    [value, languageTag],
  );

  return (
    <div className="markdown-codeblock">
      <div className="markdown-codeblock-header">
        <CodeBlockLanguageBadge languageTag={languageTag} label={languageLabel} />
        <div className="markdown-codeblock-actions">
          <CodeBlockCopyButton
            value={value}
            fencedValue={fencedValue}
            copyUseModifier={copyUseModifier}
          />
        </div>
      </div>
      <pre data-line-numbers>
        <code className={className}>{highlightedLines}</code>
      </pre>
    </div>
  );
}

function DeferredCodeBlock({
  className,
  value,
  copyUseModifier,
  languageLabel,
  lineCount,
}: DeferredCodeBlockProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const languageTag = extractLanguageTag(className);
  const fencedValue = `\`\`\`${languageTag ?? ""}\n${value}\n\`\`\``;

  if (expanded) {
    return (
      <CodeBlock
        className={className}
        value={value}
        copyUseModifier={copyUseModifier}
      />
    );
  }

  return (
    <div className="markdown-codeblock markdown-heavy-island-placeholder">
      <div className="markdown-codeblock-header">
        <CodeBlockLanguageBadge languageTag={languageTag} label={languageLabel} />
        <div className="markdown-codeblock-actions">
          <CodeBlockCopyButton
            value={value}
            fencedValue={fencedValue}
            copyUseModifier={copyUseModifier}
          />
        </div>
      </div>
      <div className="markdown-heavy-island-placeholder-body">
        <strong>{t("messages.markdownHeavyBlockDeferred")}</strong>
        <span>
          {t("messages.markdownHeavyBlockMeta", {
            kind: languageLabel,
            lines: lineCount,
          })}
        </span>
        <button type="button" onClick={() => setExpanded(true)}>
          {t("messages.markdownHeavyBlockShow")}
        </button>
      </div>
    </div>
  );
}

function MarkdownBlock({
  className,
  value,
  copyUseModifier,
  workspaceId,
  onOpenFileLink,
  onOpenFileLinkMenu,
}: CodeBlockProps & Pick<PreProps, "workspaceId" | "onOpenFileLink" | "onOpenFileLinkMenu">) {
  const languageTag = extractLanguageTag(className);
  const languageLabel = (languageTag ?? "markdown").toUpperCase();
  const fencedValue = `\`\`\`${languageTag ?? "markdown"}\n${value}\n\`\`\``;

  return (
    <div className="markdown-codeblock markdown-codeblock-markdown">
      <div className="markdown-codeblock-header">
        <CodeBlockLanguageBadge languageTag={languageTag} label={languageLabel} />
        <div className="markdown-codeblock-actions">
          <CodeBlockCopyButton
            value={value}
            fencedValue={fencedValue}
            copyUseModifier={copyUseModifier}
          />
        </div>
      </div>
      <div className="markdown-codeblock-markdown-content">
        <Markdown
          value={value}
          className="markdown markdown-codeblock-markdown-rendered"
          workspaceId={workspaceId}
          codeBlockStyle="message"
          codeBlockCopyUseModifier={copyUseModifier}
          streamingThrottleMs={0}
          onOpenFileLink={onOpenFileLink}
          onOpenFileLinkMenu={onOpenFileLinkMenu}
        />
      </div>
    </div>
  );
}

function LatexBlock({ className, value, copyUseModifier }: CodeBlockProps) {
  const languageTag = extractLanguageTag(className);
  const languageLabel = languageTag ? languageTag.toUpperCase() : "LaTeX";
  const fencedValue = `\`\`\`${languageTag ?? "latex"}\n${value}\n\`\`\``;
  const entries = useMemo(
    () => buildLatexRenderEntries(value),
    [value],
  );
  const [katexReady, setKatexReady] = useState(
    () => isKatexRenderReady(),
  );
  useEffect(() => {
    if (katexReady) return;
    let cancelled = false;
    loadKatexAssets().then(() => {
      if (cancelled) return;
      startTransition(() => setKatexReady(true));
    });
    return () => {
      cancelled = true;
    };
  }, [katexReady]);
  const renderedEntries = useMemo(
    () => entries.map((entry) => (
      entry.kind === "label"
        ? { ...entry }
        : { ...entry, html: katexReady ? renderLatexFormula(entry.source) : null }
    )),
    [entries, katexReady],
  );
  const hasFormulaRenderFailure = renderedEntries.some(
    (entry) => entry.kind === "formula" && !entry.html,
  );

  if (hasFormulaRenderFailure) {
    return (
      <CodeBlock
        className={className}
        value={value}
        copyUseModifier={copyUseModifier}
      />
    );
  }

  return (
    <div className="markdown-codeblock markdown-latexblock">
      <div className="markdown-codeblock-header">
        <CodeBlockLanguageBadge languageTag={languageTag} label={languageLabel} />
        <div className="markdown-codeblock-actions">
          <CodeBlockCopyButton
            value={value}
            fencedValue={fencedValue}
            copyUseModifier={copyUseModifier}
          />
        </div>
      </div>
      <div className="markdown-latexblock-content">
        {renderedEntries.map((entry, index) => (
          entry.kind === "label" ? (
            <p
              key={`latex-label-${index}-${entry.text}`}
              className="markdown-latexblock-label"
            >
              {entry.text}
            </p>
          ) : (
            <div
              key={`latex-formula-${index}`}
              className="markdown-latexblock-formula"
              dangerouslySetInnerHTML={{ __html: entry.html ?? "" }}
            />
          )
        ))}
      </div>
    </div>
  );
}

function MermaidFallback() {
  return (
    <div className="markdown-codeblock markdown-mermaidblock">
      <div className="markdown-codeblock-header">
        <CodeBlockLanguageBadge languageTag="mermaid" label="Mermaid" />
      </div>
      <div className="markdown-mermaidblock-loading">Loading...</div>
    </div>
  );
}

function flattenNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flattenNodeText).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return flattenNodeText(node.props?.children);
  }
  return "";
}

function countMarkdownTableRowsFromNode(node: unknown): number {
  if (!node || typeof node !== "object") {
    return 0;
  }
  const record = node as {
    tagName?: string;
    children?: unknown[];
  };
  const ownCount = record.tagName === "tr" ? 1 : 0;
  const childCount = Array.isArray(record.children)
    ? record.children.reduce<number>(
      (total, child) => total + countMarkdownTableRowsFromNode(child),
      0,
    )
    : 0;
  return ownCount + childCount;
}

function DeferredMarkdownTable({ children, rowCount }: DeferredMarkdownTableProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (expanded) {
    return <table>{children}</table>;
  }
  return (
    <div className="markdown-heavy-island-placeholder markdown-heavy-table-placeholder">
      <div className="markdown-heavy-island-placeholder-body">
        <strong>{t("messages.markdownHeavyBlockDeferred")}</strong>
        <span>
          {t("messages.markdownHeavyBlockMeta", {
            kind: t("messages.markdownHeavyBlockTable"),
            lines: rowCount,
          })}
        </span>
        <button type="button" onClick={() => setExpanded(true)}>
          {t("messages.markdownHeavyBlockShow")}
        </button>
      </div>
    </div>
  );
}

function extractAlertToneFromNode(node: ReactNode): string | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const tone = extractAlertToneFromNode(child);
      if (tone) {
        return tone;
      }
    }
    return null;
  }
  if (!isValidElement<{ className?: string; children?: ReactNode }>(node)) {
    return null;
  }
  const className = typeof node.props?.className === "string" ? node.props.className : "";
  const toneMatch = className.match(/\bmarkdown-alert-label-(note|tip|important|warning|caution)\b/);
  if (toneMatch?.[1]) {
    return toneMatch[1];
  }
  return extractAlertToneFromNode(node.props?.children);
}

function PreBlock({
  node,
  children,
  copyUseModifier,
  sourceMarkdown,
  workspaceId,
  onOpenFileLink,
  onOpenFileLinkMenu,
}: PreProps) {
  const { className, value } = extractCodeFromPre(node);
  if (!className && !value && children) {
    return <pre>{children}</pre>;
  }
  const urlLines = extractUrlLines(value);
  if (urlLines) {
    return <LinkBlock urls={urlLines} />;
  }
  const languageTag = extractLanguageTag(className);
  const markdownContent = extractMarkdownContent(languageTag, value ?? "");
  if (markdownContent && shouldRenderMarkdownFenceAsCard(node, sourceMarkdown)) {
    return (
      <MarkdownBlock
        className={className}
        value={markdownContent}
        copyUseModifier={copyUseModifier}
        workspaceId={workspaceId}
        onOpenFileLink={onOpenFileLink}
        onOpenFileLinkMenu={onOpenFileLinkMenu}
      />
    );
  }
  // ```ccgui-preview 围栏：插件声明的产物预览入口（显式触发器，见 features/plugins）
  if (languageTag?.toLowerCase() === "ccgui-preview") {
    return <PluginPreviewEntry value={value ?? ""} />;
  }
  const mermaidContent = extractMermaidContent(languageTag, value ?? "");
  if (mermaidContent) {
    return (
      <Suspense fallback={<MermaidFallback />}>
        <MermaidBlock value={mermaidContent} copyUseModifier={copyUseModifier} />
      </Suspense>
    );
  }
  const latexContent = extractLatexContent(languageTag, value ?? "");
  if (latexContent) {
    return (
      <LatexBlock
        className={className}
        value={latexContent}
        copyUseModifier={copyUseModifier}
      />
    );
  }
  const isSingleLine = !value.includes("\n");
  if (isSingleLine) {
    const highlightedHtml = highlightLine(value, languageTag);
    return (
      <pre className="markdown-codeblock-single">
        <code
          className={className}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      </pre>
    );
  }
  const codeLineCount = value.split(/\r?\n/).length;
  if (
    codeLineCount >= HEAVY_CODE_BLOCK_MIN_LINES ||
    value.length >= HEAVY_CODE_BLOCK_MIN_CHARS
  ) {
    return (
      <DeferredCodeBlock
        className={className}
        value={value}
        copyUseModifier={copyUseModifier}
        languageLabel={languageTag ?? "Code"}
        lineCount={codeLineCount}
      />
    );
  }
  return (
    <CodeBlock
      className={className}
      value={value}
      copyUseModifier={copyUseModifier}
    />
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
  codexLeadMarkerConfig,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onRenderedValueChange,
  onOutlineReady,
}: MarkdownProps) {
  // Throttle rapid value changes during streaming to reduce expensive
  // ReactMarkdown re-parses that block the main thread and cause input lag.
  //
  // Strategy: keep the latest value in a ref and schedule a single timer
  // that fires every THROTTLE_MS. The timer reads from the ref so it
  // always renders the most recent content, even if many updates arrived
  // between ticks. This prevents the timer-cancellation starvation that
  // occurs when every value change cancels and reschedules the timer
  // (on Windows the events can arrive faster than the throttle window,
  // causing the deferred update to never execute).
  const [throttledValue, setThrottledValue] = useState(value);
  const [imageFullscreen, setImageFullscreen] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const lastUpdateRef = useRef(Date.now());
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
  const throttleTimerRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const latestValueRef = useRef(value);
  const previousThrottleMsRef = useRef(Math.max(0, streamingThrottleMs));
  const resolvedThrottleMs = Math.max(0, streamingThrottleMs);
  latestValueRef.current = value;
  const scheduleThrottledValueUpdate = useCallback((nextValue: string) => {
    startTransition(() => {
      setThrottledValue((currentValue) => (
        currentValue === nextValue ? currentValue : nextValue
      ));
    });
  }, []);

  useEffect(() => {
    const now = Date.now();
    if (previousThrottleMsRef.current !== resolvedThrottleMs) {
      previousThrottleMsRef.current = resolvedThrottleMs;
      if (throttleTimerRef.current) {
        window.clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = 0;
      }
      scheduleThrottledValueUpdate(value);
      lastUpdateRef.current = now;
      return;
    }
    const elapsed = now - lastUpdateRef.current;
    if (resolvedThrottleMs === 0) {
      scheduleThrottledValueUpdate(value);
      lastUpdateRef.current = now;
      return;
    }
    // If enough time has passed, update immediately
    if (elapsed >= resolvedThrottleMs) {
      scheduleThrottledValueUpdate(value);
      lastUpdateRef.current = now;
      return;
    }
    // A timer is already pending — it will read latestValueRef when it fires,
    // so there is nothing else to do.
    if (throttleTimerRef.current) {
      return;
    }
    // Schedule a deferred flush. This timer is NOT cancelled when value
    // changes; it will fire once and read the latest value from the ref.
    throttleTimerRef.current = window.setTimeout(() => {
      throttleTimerRef.current = 0;
      if (!mountedRef.current || typeof window === "undefined") {
        return;
      }
      scheduleThrottledValueUpdate(latestValueRef.current);
      lastUpdateRef.current = Date.now();
    }, resolvedThrottleMs - elapsed);
  }, [resolvedThrottleMs, scheduleThrottledValueUpdate, value]);

  // Clean up only on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (throttleTimerRef.current) {
        window.clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = 0;
      }
    };
  }, []);

  const resolvedProgressiveStepMs = normalizeProgressiveRevealStepMs(
    progressiveRevealStepMs,
  );
  const resolvedProgressiveChunkChars = normalizeProgressiveRevealChunkChars(
    progressiveRevealChunkChars,
  );
  const [progressiveValue, setProgressiveValue] = useState(() => (
    progressiveReveal
      ? resolveProgressiveRevealValue(
        "",
        value,
        resolvedProgressiveChunkChars,
      )
      : value
  ));
  const progressiveTimerRef = useRef<number>(0);
  const latestProgressiveTargetRef = useRef(value);
  const previousProgressiveRevealRef = useRef(progressiveReveal);
  const scheduleProgressiveValueUpdate = useCallback(
    (
      updater: string | ((currentValue: string) => string),
    ) => {
      startTransition(() => {
        setProgressiveValue((currentValue) => {
          const nextValue = typeof updater === "function"
            ? updater(currentValue)
            : updater;
          return nextValue === currentValue ? currentValue : nextValue;
        });
      });
    },
    [],
  );

  useEffect(() => {
    if (!progressiveReveal) {
      if (progressiveTimerRef.current) {
        window.clearTimeout(progressiveTimerRef.current);
        progressiveTimerRef.current = 0;
      }
      latestProgressiveTargetRef.current = throttledValue;
      scheduleProgressiveValueUpdate(throttledValue);
      previousProgressiveRevealRef.current = false;
      return;
    }

    latestProgressiveTargetRef.current = throttledValue;
    scheduleProgressiveValueUpdate((currentValue) => {
      const wasProgressiveReveal = previousProgressiveRevealRef.current;
      previousProgressiveRevealRef.current = true;
      if (!wasProgressiveReveal) {
        return resolveProgressiveRevealValue(
          "",
          throttledValue,
          resolvedProgressiveChunkChars,
        );
      }
      const nextValue = resolveProgressiveRevealValue(
        currentValue,
        throttledValue,
        resolvedProgressiveChunkChars,
      );
      return nextValue === currentValue ? currentValue : nextValue;
    });
  }, [
    progressiveReveal,
    resolvedProgressiveChunkChars,
    scheduleProgressiveValueUpdate,
    throttledValue,
  ]);

  useEffect(() => {
    if (!progressiveReveal) {
      return undefined;
    }
    if (progressiveValue === latestProgressiveTargetRef.current) {
      return undefined;
    }
    if (progressiveTimerRef.current) {
      return undefined;
    }
    const pendingTextLength = Math.max(
      0,
      latestProgressiveTargetRef.current.length - progressiveValue.length,
    );
    const adaptiveStepMs = resolveAdaptiveProgressiveRevealStepMs(
      progressiveValue.length,
      pendingTextLength,
      resolvedProgressiveStepMs,
    );
    progressiveTimerRef.current = window.setTimeout(() => {
      progressiveTimerRef.current = 0;
      if (!mountedRef.current) {
        return;
      }
      scheduleProgressiveValueUpdate((currentValue) => {
        const nextValue = resolveProgressiveRevealValue(
          currentValue,
          latestProgressiveTargetRef.current,
          resolvedProgressiveChunkChars,
        );
        return nextValue === currentValue ? currentValue : nextValue;
      });
    }, adaptiveStepMs);
    return undefined;
  }, [
    progressiveReveal,
    progressiveValue,
    resolvedProgressiveChunkChars,
    resolvedProgressiveStepMs,
    scheduleProgressiveValueUpdate,
  ]);

  useEffect(() => {
    return () => {
      if (progressiveTimerRef.current) {
        window.clearTimeout(progressiveTimerRef.current);
        progressiveTimerRef.current = 0;
      }
    };
  }, []);

  const renderValue = progressiveReveal ? progressiveValue : throttledValue;

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
        normalizeMarkdownMathForMessage(
          normalizeFragmentedResourceReferences(
            normalizeListIndentation(
              normalizeInlineOrderedListBreaks(
                normalizeGithubBlockquoteAlerts(
                  normalizeFragmentedLineBreaks(normalizeFragmentedParagraphBreaks(text)),
                ),
              ),
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
  const enableCodexLeadEnhancement = className?.includes("markdown-codex-canvas") ?? false;
  // glossary 插件未安装时恒为 null：不进 rehype 管线，渲染链零开销。
  // 匹配器仅在安装/卸载词库插件时变化（事件驱动，无轮询）。
  const glossaryPlugin = useGlossaryRehypePlugin();
  const components = useMemo<FullMarkdownComponents>(() => {
    const result: FullMarkdownComponents = {
      // glossary 插件标注的技术名词（rehype 阶段包裹的自定义元素）
      [GLOSSARY_TERM_TAG]: ({ children }) => (
        <GlossaryTermChip>{children}</GlossaryTermChip>
      ),
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
        const normalizedSrc = normalizeMarkdownImageSrc(src ?? "");
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
        if (!shouldDeferMarkdownHeavyIslands || rowCount < HEAVY_TABLE_MIN_ROWS) {
          return <table>{children}</table>;
        }
        return (
          <DeferredMarkdownTable rowCount={rowCount}>
            {children}
          </DeferredMarkdownTable>
        );
      },
    };

    if (enableCodexLeadEnhancement) {
      result.p = ({ children }) => {
        const plainText = flattenNodeText(children);
        const lead = detectCodexLeadMarker(plainText, codexLeadMarkerConfig);
        if (!lead) {
          return <p>{children}</p>;
        }
        return (
          <p className={`markdown-lead-paragraph markdown-lead-${lead.tone}`}>
            <span className="markdown-lead-icon" aria-hidden>{lead.icon}</span>
            <span className="markdown-lead-text">{children}</span>
          </p>
        );
      };
    }

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
    enableCodexLeadEnhancement,
    codexLeadMarkerConfig,
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
    codexLeadEnhanced: enableCodexLeadEnhancement,
    codeBlockStyle,
    hasFileLinkHandlers: Boolean(onOpenFileLink || onOpenFileLinkMenu),
    hasMathContent,
    preserveFormatting,
    softBreaks,
  }), [
    codeBlockStyle,
    enableCodexLeadEnhancement,
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
          glossaryPlugin={glossaryPlugin}
        />
      </Suspense>
    );
  }, [
    components,
    glossaryPlugin,
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
