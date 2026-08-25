/**
 * 读取文件工具块组件
 * Read Tool Block Component - for displaying file read operations
 * 统一 Marker 风格折叠行：灰色描边图标 + 文件名 + 行号范围 + 靠右状态图标
 *
 * 图片读取：展开后用 ImageViewToolContent 真正渲染预览，而非只显示
 * “Read image file: /path/…” 文案路径。
 */
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import type { ConversationItem } from '../../../../types';
import { cn } from '@/lib/utils';
import { isImagePath } from '@/utils/fileRenderProfile';
import {
  asRecord,
  extractToolName,
  parseToolArgs,
  getFirstStringField,
  getFileName,
  resolveToolStatus,
} from './toolConstants';
import { Markdown } from '../Markdown';
import {
  ToolMarkerShell,
  ToolStatusIcon,
  TOOL_MARKER_BODY_CLASS,
} from './ToolMarkerShell';
import { ToolFileTypeIcon } from './ToolFileTypeIcon';
import {
  ImageViewToolContent,
  resolveImageViewPreviewSrc,
} from './ImageViewToolContent';

interface ReadToolBlockProps {
  item: Extract<ConversationItem, { kind: 'tool' }>;
  workspaceId?: string | null;
  isExpanded: boolean;
  onToggle: (id: string) => void;
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);
const FILE_PATH_KEYS = [
  'file_path',
  'filePath',
  'path',
  'target_file',
  'targetFile',
  'filename',
  'file',
];
const DIRECTORY_PATH_KEYS = [
  'target_directory',
  'targetDirectory',
  'directory',
  'dir',
];
/** 与 ReadToolGroupBlock 对齐：list_dir / ls 等目录浏览工具应显示文件夹图标。 */
const DIRECTORY_TOOL_NAMES = new Set([
  'list_dir',
  'listdir',
  'list_directory',
  'ls',
  'list',
  'list_files',
]);
const OUTPUT_KEYS = ['output', 'result', 'content', 'text'];

/** Agent Read 工具读图时常见的占位输出前缀（Claude / Grok 等）。 */
const READ_IMAGE_FILE_PREFIX =
  /^(?:Read\s+image\s+file|Image\s+file|已读取图像文件|读取图片文件)\s*:\s*/i;

function looksLikeMarkdownOutput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return (
    /^#{1,6}\s+/m.test(trimmed) ||
    /^\s*[-*+]\s+\S+/m.test(trimmed) ||
    /^\s*\d+\.\s+\S+/m.test(trimmed) ||
    /^\s*>+\s+\S+/m.test(trimmed) ||
    /```[\s\S]*```/.test(trimmed) ||
    (/^\s*\|.+\|\s*$/m.test(trimmed) && /^\s*\|?\s*[-:]{2,}/m.test(trimmed))
  );
}

function isMarkdownPath(path: string): boolean {
  const normalized = path.trim().replace(/\\/g, '/');
  if (!normalized) {
    return false;
  }
  const fileName = getFileName(normalized).toLowerCase();
  const ext = fileName.includes('.') ? fileName.split('.').pop() ?? '' : '';
  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return true;
  }
  return fileName === 'readme' || fileName.startsWith('readme.');
}

// Claude 的 Read 工具输出为 `行号\t内容`（cat -n 风格）。带行号文本直接喂给
// markdown 会让标题/列表等结构失效（行首都是行号），故渲染前逐行剥掉行首的
// 「数字+制表符」。^\d+\t 只匹配每行开头第一个，正文内的 \t 或以数字开头的
// 内容（Read 会输出为 `5\t42\tfoo`）不受影响。
function stripReadLineNumbers(value: string): string {
  return value.replace(/^\d+\t/gm, '');
}

function decodeMaybeUriPath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 从 Read 工具输出中提取图片本地路径。
 * 典型输出：`Read image file: /Users/.../image.png`
 */
function extractImagePathFromReadOutput(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    return '';
  }
  const firstLine = trimmed.split(/\r?\n/, 1)[0]?.trim() ?? '';
  const withoutPrefix = firstLine.replace(READ_IMAGE_FILE_PREFIX, '').trim();
  const candidate = withoutPrefix || firstLine;
  // 去掉可能包住路径的引号
  const unquoted = candidate.replace(/^['"]|['"]$/g, '').trim();
  if (!unquoted) {
    return '';
  }
  if (isImagePath(unquoted) || isImagePath(decodeMaybeUriPath(unquoted))) {
    return unquoted;
  }
  return '';
}

function isAbsoluteOrRemoteImagePath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed) {
    return false;
  }
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("asset://") ||
    trimmed.startsWith("file://")
  ) {
    return true;
  }
  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed) || /^\\\\[^\\]/.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * 解析 Read 工具的图片路径：优先 output 中的绝对路径（CLI 常把绝对路径
 * 写进 “Read image file: …”），再回退到 args 中的 path。
 */
function resolveReadImageLocalPath(filePath: string, output: string): string {
  const fromOutput = extractImagePathFromReadOutput(output);
  if (fromOutput && isAbsoluteOrRemoteImagePath(fromOutput)) {
    return fromOutput;
  }
  if (filePath && (isImagePath(filePath) || isImagePath(decodeMaybeUriPath(filePath)))) {
    return filePath;
  }
  return fromOutput;
}

export const ReadToolBlock = memo(function ReadToolBlock({
  item,
  workspaceId = null,
  isExpanded: _isExpanded,
  onToggle: _onToggle,
}: ReadToolBlockProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const args = useMemo(() => parseToolArgs(item.detail), [item.detail]);
  const nestedInput = useMemo(() => asRecord(args?.input), [args]);
  const nestedArgs = useMemo(() => asRecord(args?.arguments), [args]);

  const directoryPath =
    getFirstStringField(args, DIRECTORY_PATH_KEYS) ||
    getFirstStringField(nestedInput, DIRECTORY_PATH_KEYS) ||
    getFirstStringField(nestedArgs, DIRECTORY_PATH_KEYS);
  const filePath =
    getFirstStringField(args, FILE_PATH_KEYS) ||
    getFirstStringField(nestedInput, FILE_PATH_KEYS) ||
    getFirstStringField(nestedArgs, FILE_PATH_KEYS) ||
    directoryPath;
  const fileName = getFileName(filePath);
  const toolName = (
    extractToolName(item.title) ||
    (typeof item.toolType === 'string' ? item.toolType : '')
  ).toLowerCase();

  const renderedOutput = useMemo(() => {
    if (item.output && item.output.trim()) {
      return item.output;
    }
    return (
      getFirstStringField(args, OUTPUT_KEYS) ||
      getFirstStringField(nestedInput, OUTPUT_KEYS) ||
      getFirstStringField(nestedArgs, OUTPUT_KEYS)
    );
  }, [args, item.output, nestedArgs, nestedInput]);

  const imageLocalPath = useMemo(
    () => resolveReadImageLocalPath(filePath, renderedOutput),
    [filePath, renderedOutput],
  );
  const imagePreviewSrc = useMemo(
    () => (imageLocalPath ? resolveImageViewPreviewSrc(imageLocalPath) : ''),
    [imageLocalPath],
  );
  const isImageRead = Boolean(imagePreviewSrc);

  const markdownSource = useMemo(
    () => stripReadLineNumbers(renderedOutput),
    [renderedOutput],
  );

  const renderAsMarkdown = useMemo(() => {
    if (isImageRead || !renderedOutput) {
      return false;
    }
    if (isMarkdownPath(filePath)) {
      return true;
    }
    return looksLikeMarkdownOutput(markdownSource);
  }, [filePath, isImageRead, markdownSource, renderedOutput]);

  const offset = args?.offset as number | undefined;
  const limit = args?.limit as number | undefined;
  let lineInfo = '';
  if (typeof offset === 'number' && typeof limit === 'number') {
    const startLine = offset + 1;
    const endLine = offset + limit;
    lineInfo = t("tools.lineRange", { start: startLine, end: endLine });
  }

  // 与 ReadToolGroupBlock 同构：list_dir / target_directory / 尾斜杠都算目录
  const isDirectory =
    Boolean(directoryPath) ||
    DIRECTORY_TOOL_NAMES.has(toolName) ||
    filePath === '.' ||
    filePath === '..' ||
    (filePath?.endsWith('/') ?? false);
  const actionText = isDirectory ? t("tools.readDirectory") : t("tools.readFile");
  const kindLabel = isDirectory ? t("tools.kindList") : t("tools.kindRead");

  const status = resolveToolStatus(
    item.status,
    Boolean(renderedOutput) || isImageRead,
  );
  // 图片读取：有可预览路径即可展开，即使 output 为空（历史回放边界）
  const hasBody = Boolean(renderedOutput) || isImageRead;

  // 行首用与「批量读取」组头同款的单色动作 icon（非彩色文件类型 icon）
  // 彩色文件类型 icon 放在 kind 之后、文件名之前，与 ExploreInlineItemRow 同构
  return (
    <ToolMarkerShell
      kind={kindLabel}
      icon={<FileText size={14} aria-hidden />}
      label={actionText}
      labelHidden
      expanded={expanded && hasBody}
      onToggle={() => setExpanded((prev) => !prev)}
      trailing={<ToolStatusIcon status={status} />}
      body={
        <div className={cn(TOOL_MARKER_BODY_CLASS, 'read-tool-details')}>
          {isImageRead ? (
            <ImageViewToolContent
              previewSrc={imagePreviewSrc}
              workspaceId={workspaceId}
              localPath={imageLocalPath}
              alt={fileName || getFileName(imageLocalPath) || 'image preview'}
            />
          ) : renderAsMarkdown ? (
            <div className="task-content-wrapper read-tool-markdown-wrapper">
              <div className="read-tool-rendered-content">
                <Markdown
                  value={markdownSource}
                  className="markdown read-tool-markdown"
                  liveRenderMode="lightweight"
                />
              </div>
            </div>
          ) : (
            <div className="task-content-wrapper">
              <div className="task-field-content" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {renderedOutput}
              </div>
            </div>
          )}
        </div>
      }
    >
      {filePath ? (
        <span className="tool-marker-file-type-icon inline-flex shrink-0" aria-hidden>
          <ToolFileTypeIcon
            filePath={filePath}
            isFolder={isDirectory}
            size={14}
          />
        </span>
      ) : null}
      {fileName && (
        <span className="truncate" title={filePath}>
          {fileName}
        </span>
      )}
      {lineInfo && (
        <span className="shrink-0 text-muted-foreground/70">{lineInfo}</span>
      )}
    </ToolMarkerShell>
  );
});

export default ReadToolBlock;
