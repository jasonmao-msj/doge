import type { TFunction } from 'i18next';
import type { Attachment, QueuedMessage } from './types.js';
import { AttachmentList } from './AttachmentList.js';
import { MessageQueue } from './MessageQueue.js';

type ChatInputBoxHeaderProps = {
  sdkInstalled: boolean;
  sdkStatusLoading: boolean;
  currentProvider: string;
  onInstallSdk?: () => void;
  t: TFunction;
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  messageQueue?: QueuedMessage[];
  onRemoveFromQueue?: (id: string) => void;
  onFuseFromQueue?: (id: string) => void;
  canFuseFromQueue?: boolean;
  fuseDisabledReasonKey?: string | null;
  fusingQueueMessageId?: string | null;
  dailyPoetryText?: string | null;
  onDismissDailyPoetry?: () => void;
};

export function ChatInputBoxHeader({
  sdkStatusLoading,
  sdkInstalled,
  currentProvider,
  onInstallSdk,
  t,
  attachments,
  onRemoveAttachment,
  messageQueue,
  onRemoveFromQueue,
  onFuseFromQueue,
  canFuseFromQueue = false,
  fuseDisabledReasonKey = null,
  fusingQueueMessageId = null,
  dailyPoetryText,
  onDismissDailyPoetry,
}: ChatInputBoxHeaderProps) {
  const hasDailyPoetry = typeof dailyPoetryText === 'string' && dailyPoetryText.length > 0;
  // Check if there's any content to render
  const hasContent =
    hasDailyPoetry ||
    sdkStatusLoading ||
    !sdkInstalled ||
    (messageQueue && messageQueue.length > 0) ||
    attachments.length > 0;

  if (!hasContent) {
    return null;
  }

  return (
    <>
      {/* Daily classical Chinese poetry banner */}
      {hasDailyPoetry && (
        <div className="daily-poetry-banner">
          <span className="banner-text">{dailyPoetryText}</span>
          <button
            className="banner-close"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={(e) => {
              e.stopPropagation();
              onDismissDailyPoetry?.();
            }}
          >
            &#x2715;
          </button>
        </div>
      )}

      {/* SDK status loading or not installed warning bar */}
      {(sdkStatusLoading || !sdkInstalled) && (
        <div className={`sdk-warning-bar ${sdkStatusLoading ? 'sdk-loading' : ''}`}>
          <span
            className={`codicon ${sdkStatusLoading ? 'codicon-loading codicon-modifier-spin' : 'codicon-warning'}`}
          />
          <span className="sdk-warning-text">
            {sdkStatusLoading
              ? t('chat.sdkStatusLoading')
              : t('chat.sdkNotInstalled', {
                  provider: currentProvider === 'codex' ? 'Codex' : 'Claude Code',
                })}
          </span>
          {!sdkStatusLoading && (
            <button
              className="sdk-install-btn"
              onClick={(e) => {
                e.stopPropagation();
                onInstallSdk?.();
              }}
            >
              {t('chat.goInstallSdk')}
            </button>
          )}
        </div>
      )}

      {/* Message queue */}
      {messageQueue && messageQueue.length > 0 && (
        <MessageQueue
          queue={messageQueue}
          onRemove={onRemoveFromQueue ?? (() => {})}
          onFuse={onFuseFromQueue}
          canFuse={canFuseFromQueue}
          fuseDisabledReasonKey={fuseDisabledReasonKey}
          fusingMessageId={fusingQueueMessageId}
        />
      )}

      {/* Attachment list */}
      {attachments.length > 0 && (
        <AttachmentList attachments={attachments} onRemove={onRemoveAttachment} />
      )}
    </>
  );
}
