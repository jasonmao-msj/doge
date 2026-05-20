/**
 * 单个编辑文件工具块组件
 * Edit Tool Block Component - for displaying a single file edit operation with diff stats
 * 使用 task-container 样式 + codicon 图标（匹配参考项目）
 */
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConversationItem } from '../../../../types';
import {
  parseToolArgs,
  getFileName,
  resolveToolStatus,
  asRecord,
  pickStringField,
  EDIT_PATH_KEYS,
  EDIT_OLD_KEYS,
  EDIT_NEW_KEYS,
  EDIT_CONTENT_KEYS,
} from './toolConstants';
import { computeDiff } from '../../utils/diffUtils';
import { FileIcon } from './FileIcon';
import { ToolStatusIndicator } from './ToolStatusIndicator';

interface EditToolBlockProps {
  item: Extract<ConversationItem, { kind: 'tool' }>;
}

export const EditToolBlock = memo(function EditToolBlock({
  item,
}: EditToolBlockProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const args = useMemo(() => parseToolArgs(item.detail), [item.detail]);
  const nestedInput = useMemo(() => asRecord(args?.input), [args]);
  const nestedArgs = useMemo(() => asRecord(args?.arguments), [args]);

  const filePath = pickStringField(args, nestedInput, nestedArgs, EDIT_PATH_KEYS);
  const fileName = getFileName(filePath);
  const displayPath = fileName || filePath;

  const { diff, hasStructuredDiff, changeKind } = useMemo(() => {
    if (!args && !nestedInput && !nestedArgs) {
      return {
        diff: { lines: [], additions: 0, deletions: 0 },
        hasStructuredDiff: false,
        changeKind: 'modified' as const,
      };
    }

    const oldString = pickStringField(args, nestedInput, nestedArgs, EDIT_OLD_KEYS);
    const newString = pickStringField(args, nestedInput, nestedArgs, EDIT_NEW_KEYS);
    if (oldString || newString) {
      return {
        diff: computeDiff(oldString, newString),
        hasStructuredDiff: true,
        changeKind: oldString ? ('modified' as const) : ('added' as const),
      };
    }

    const content = pickStringField(args, nestedInput, nestedArgs, EDIT_CONTENT_KEYS);
    if (content) {
      return {
        diff: computeDiff('', content),
        hasStructuredDiff: true,
        changeKind: 'added' as const,
      };
    }

    return {
      diff: { lines: [], additions: 0, deletions: 0 },
      hasStructuredDiff: false,
      changeKind: 'modified' as const,
    };
  }, [args, nestedArgs, nestedInput]);

  const kindCode = changeKind === 'added' ? 'A' : 'M';

  const status = resolveToolStatus(item.status, Boolean(item.output));
  const isCompleted = status === 'completed';
  const isError = status === 'failed';

  return (
    <div className="task-container">
      <div
        className="task-header"
        onClick={() => setExpanded((prev) => !prev)}
        style={{
          borderBottom: expanded ? '1px solid var(--border-primary)' : undefined,
        }}
      >
        <div className="task-title-section">
          <span className="codicon codicon-diff tool-title-icon tool-title-icon-file-change" />
          <span className="tool-title-text">{t("tools.editFile")}</span>
          {displayPath && (
            <span className="tool-change-summary">
              <span>1 files</span>
              <span className="diff-stat-add">+{diff.additions}</span>
              <span className="diff-stat-del">-{diff.deletions}</span>
              <span className="tool-change-collapsed-preview" title={filePath || fileName}>
                <FileIcon fileName={fileName || filePath} size={14} />
                <span className="tool-change-collapsed-file-name">
                  {displayPath}
                </span>
              </span>
            </span>
          )}
        </div>
        <ToolStatusIndicator compact tone={isError ? 'error' : isCompleted ? 'completed' : 'pending'} />
      </div>

      {expanded && (
        <div className="task-details tool-change-details edit-tool-change-details" style={{ border: 'none' }}>
          <div className="task-content-wrapper">
            {displayPath ? (
              <div className="tool-change-entry">
                <div className="tool-change-row">
                  <span className={`tool-change-kind-badge ${changeKind}`}>
                    {kindCode}
                  </span>
                  <FileIcon fileName={fileName || filePath} size={14} />
                  <span className="tool-change-file-name" title={filePath || fileName}>
                    {displayPath}
                  </span>
                  <span className="tool-change-file-diff-stats">
                    <span className="diff-stat-add">+{diff.additions}</span>
                    <span className="diff-stat-del">-{diff.deletions}</span>
                  </span>
                </div>

                {hasStructuredDiff && diff.lines.length > 0 ? (
                  <div className="tool-change-inline-diff edit-diff-viewer">
                    {diff.lines.map((line, index) => {
                      const lineClass =
                        line.type === 'deleted'
                          ? 'is-deleted'
                          : line.type === 'added'
                            ? 'is-added'
                            : '';

                      return (
                        <div
                          key={`${line.type}-${index}`}
                          className={`edit-diff-line ${lineClass}`}
                        >
                          <div className="edit-diff-gutter" />
                          <div className={`edit-diff-sign ${lineClass}`}>
                            {line.type === 'deleted' ? '-' : line.type === 'added' ? '+' : ' '}
                          </div>
                          <pre className="edit-diff-content">
                            {line.content}
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                ) : item.output ? (
                  <div style={{ padding: '6px 4px 8px' }}>
                    <div className="task-field-content" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                      {item.output}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              hasStructuredDiff && diff.lines.length > 0 ? (
                <div className="edit-diff-viewer">
                  {diff.lines.map((line, index) => {
                    const lineClass =
                      line.type === 'deleted'
                        ? 'is-deleted'
                        : line.type === 'added'
                          ? 'is-added'
                          : '';

                    return (
                      <div
                        key={`${line.type}-${index}`}
                        className={`edit-diff-line ${lineClass}`}
                      >
                        <div className="edit-diff-gutter" />
                        <div className={`edit-diff-sign ${lineClass}`}>
                          {line.type === 'deleted' ? '-' : line.type === 'added' ? '+' : ' '}
                        </div>
                        <pre className="edit-diff-content">
                          {line.content}
                        </pre>
                      </div>
                    );
                  })}
                </div>
              ) : item.output ? (
                <div className="task-field-content" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  {item.output}
                </div>
              ) : null
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default EditToolBlock;
