/**
 * MCP 工具块组件 - 用于展示 MCP (Model Context Protocol) 工具调用
 * MCP Tool Block Component - for displaying MCP tool calls
 * 统一 Marker 风格折叠行：灰色描边图标 + 工具名 + 摘要 + 靠右状态图标
 *
 * AskUserQuestion（doge/legacy MCP variants）单独打磨：
 * 不用 raw QUESTIONS / _input JSON，展示本地化标题 + 问题摘要 + 可读答案。
 */
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SearchIcon from 'lucide-react/dist/esm/icons/search';
import Database from 'lucide-react/dist/esm/icons/database';
import Globe from 'lucide-react/dist/esm/icons/globe';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import MessagesSquare from 'lucide-react/dist/esm/icons/messages-square';
import Wrench from 'lucide-react/dist/esm/icons/wrench';
import type { ConversationItem } from '../../../../types';
import {
  parseToolArgs,
  getFirstStringField,
  truncateText,
  resolveToolStatus,
  getToolDisplayName,
  extractToolName,
} from './toolConstants';
import { TOOL_MARKER_BODY_CLASS, ToolMarkerShell, ToolStatusIcon } from './ToolMarkerShell';

interface McpToolBlockProps {
  item: Extract<ConversationItem, { kind: 'tool' }>;
  isExpanded: boolean;
  onToggle: (id: string) => void;
}

/**
 * 格式化 MCP 工具名称
 * mcp__ace-tool__search_context -> Mcp Ace-tool Search Context
 */
function formatMcpToolName(title: string): string {
  const cleanTitle = title.replace(/^Tool:\s*/i, '').trim();
  const parts = cleanTitle.split('__');

  return parts
    .map(part =>
      part.split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('-')
    )
    .join(' ');
}

function isAskUserQuestionMcp(title: string, toolName: string): boolean {
  const compact = (value: string) =>
    value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    compact(toolName) === 'askuserquestion' ||
    compact(toolName).endsWith('askuserquestion') ||
    compact(title).includes('askuserquestion')
  );
}

/**
 * 根据 MCP 工具名称获取 lucide 描边图标
 */
function getMcpIcon(title: string, isAskUserQuestion: boolean) {
  const lower = title.toLowerCase();
  const iconProps = { size: 14 as const, 'aria-hidden': true as const };

  if (isAskUserQuestion) {
    return <MessagesSquare {...iconProps} />;
  }
  if (lower.includes('search') || lower.includes('context') || lower.includes('query')) {
    return <SearchIcon {...iconProps} />;
  }
  if (lower.includes('database') || lower.includes('sql') || lower.includes('db')) {
    return <Database {...iconProps} />;
  }
  if (lower.includes('web') || lower.includes('fetch') || lower.includes('http')) {
    return <Globe {...iconProps} />;
  }
  if (lower.includes('read') || lower.includes('file') || lower.includes('doc')) {
    return <FileText {...iconProps} />;
  }

  return <Wrench {...iconProps} />;
}

/**
 * 获取状态
 */
function getStatus(item: Extract<ConversationItem, { kind: 'tool' }>): 'completed' | 'processing' | 'failed' {
  return resolveToolStatus(item.status, Boolean(item.output));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readAskQuestionSummary(args: Record<string, unknown> | null): string {
  if (!args) {
    return '';
  }
  const nested = asRecord(args._input ?? args.input ?? args.arguments) ?? args;
  const questions = Array.isArray(nested.questions) ? nested.questions : [];
  if (questions.length === 0) {
    const single =
      typeof nested.question === 'string'
        ? nested.question
        : typeof nested.prompt === 'string'
          ? nested.prompt
          : '';
    return single.trim();
  }
  const first = asRecord(questions[0]);
  if (!first) {
    return '';
  }
  const text =
    typeof first.question === 'string'
      ? first.question
      : typeof first.prompt === 'string'
        ? first.prompt
        : typeof first.header === 'string'
          ? first.header
          : '';
  if (questions.length <= 1) {
    return text.trim();
  }
  return text.trim() ? `${text.trim()} (+${questions.length - 1})` : '';
}

function readAskAnswerSummary(output: string | undefined): string {
  const raw = (output ?? '').trim();
  if (!raw) {
    return '';
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const nested =
      typeof parsed._output === 'string'
        ? parsed._output
        : typeof parsed.output === 'string'
          ? parsed.output
          : typeof parsed.result === 'string'
            ? parsed.result
            : '';
    if (nested.trim()) {
      return extractHumanAskAnswer(nested.trim());
    }
  } catch {
    // plain text
  }
  return extractHumanAskAnswer(raw);
}

function extractHumanAskAnswer(text: string): string {
  const answered = text.match(
    /^The user answered the AskUserQuestion[:：]\s*([\s\S]*?)(?:[。.]?\s*Please continue based on this selection\.?)?(?:\s*AskUserQuestionResultBase64:.*)?$/i,
  );
  if (answered?.[1]) {
    return answered[1].trim();
  }
  if (/skipped this AskUserQuestion/i.test(text) || /dismissed the question/i.test(text)) {
    return text.slice(0, 80);
  }
  // Strip structured marker noise for short display
  const withoutMarker = text.replace(/\s*AskUserQuestionResultBase64:[A-Za-z0-9+/=]+/g, '').trim();
  return withoutMarker.length > 120 ? `${withoutMarker.slice(0, 117)}…` : withoutMarker;
}

export const McpToolBlock = memo(function McpToolBlock({
  item,
  isExpanded: _isExpanded,
  onToggle: _onToggle,
}: McpToolBlockProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const args = useMemo(() => parseToolArgs(item.detail), [item.detail]);
  const toolName = extractToolName(item.title);
  const isAskUserQuestion = isAskUserQuestionMcp(item.title, toolName);

  const displayName = isAskUserQuestion
    ? getToolDisplayName(toolName || 'askuserquestion', item.title, t)
    : formatMcpToolName(item.title);
  const status = getStatus(item);

  const askSummary = isAskUserQuestion ? readAskQuestionSummary(args) : '';
  const askAnswer = isAskUserQuestion ? readAskAnswerSummary(item.output) : '';
  const genericSummary = getFirstStringField(args, [
    'query',
    'pattern',
    'path',
    'file_path',
    'text',
    'prompt',
  ]);
  const summary = isAskUserQuestion
    ? askAnswer || askSummary
    : genericSummary;
  const displaySummary = truncateText(summary, 60);

  const omitFields = useMemo(() => {
    if (isAskUserQuestion) {
      // Never dump raw questions / nested MCP envelopes into the expanded body.
      return new Set([
        'query',
        'pattern',
        'path',
        'file_path',
        'text',
        'prompt',
        'questions',
        '_input',
        'input',
        'arguments',
      ]);
    }
    return new Set(['query', 'pattern', 'path', 'file_path', 'text', 'prompt']);
  }, [isAskUserQuestion]);

  const otherParams = useMemo(() => {
    if (!args || isAskUserQuestion) return [];
    return Object.entries(args).filter(
      ([key, value]) =>
        !omitFields.has(key) && value !== undefined && value !== null && value !== '',
    );
  }, [args, isAskUserQuestion, omitFields]);

  const hasDetails =
    otherParams.length > 0 ||
    Boolean(item.output && !isAskUserQuestion) ||
    Boolean(isAskUserQuestion && (askSummary || askAnswer));

  return (
    <ToolMarkerShell
      icon={getMcpIcon(item.title, isAskUserQuestion)}
      label={displayName}
      expanded={expanded && hasDetails}
      onToggle={() => setExpanded((prev) => !prev)}
      trailing={<ToolStatusIcon status={status} />}
      body={
        <div className={TOOL_MARKER_BODY_CLASS}>
          {isAskUserQuestion ? (
            <div className="task-content-wrapper">
              {askSummary ? (
                <div className="task-field">
                  <div className="task-field-label">{t('approval.inputRequested')}</div>
                  <div className="task-field-content">{askSummary}</div>
                </div>
              ) : null}
              {askAnswer ? (
                <div className="task-field">
                  <div className="task-field-label">{t('approval.submitted')}</div>
                  <div className="task-field-content">{askAnswer}</div>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              {otherParams.length > 0 && (
                <div className="task-content-wrapper">
                  {otherParams.map(([key, value]) => (
                    <div key={key} className="task-field">
                      <div className="task-field-label">{key}</div>
                      <div className="task-field-content">
                        {typeof value === 'object'
                          ? JSON.stringify(value, null, 2)
                          : String(value)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {item.output && (
                <div style={{ padding: '12px' }}>
                  <div
                    className="task-field-content"
                    style={{ maxHeight: '300px', overflowY: 'auto' }}
                  >
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {item.output}
                    </pre>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      }
    >
      {displaySummary && (
        <span className="truncate" title={summary}>
          {displaySummary}
        </span>
      )}
    </ToolMarkerShell>
  );
});

export default McpToolBlock;
