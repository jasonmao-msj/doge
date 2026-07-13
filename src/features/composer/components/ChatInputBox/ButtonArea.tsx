import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import DatabaseZap from 'lucide-react/dist/esm/icons/database-zap';
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up';
import Square from 'lucide-react/dist/esm/icons/square';
import Plus from 'lucide-react/dist/esm/icons/plus';
import type { ButtonAreaProps, MemoryReferenceMode, PermissionMode, ReasoningEffort } from './types';
import { ConfigSelect, ModeSelect, PluginsSelect, ReasoningSelect } from './selectors';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Stable no-op callbacks to avoid re-renders when optional handlers are not provided
const NOOP_MODE = (_mode: PermissionMode) => {};
const NOOP_REASONING = (_effort: ReasoningEffort | null) => {};

// Memory reference modes offered inside the vertical tool menu submenu.
const MEMORY_REFERENCE_OPTIONS: ReadonlyArray<{
  mode: MemoryReferenceMode;
  labelKey: string;
  fallback: string;
}> = [
  { mode: 'off', labelKey: 'composer.memoryReferenceDisable', fallback: '关闭' },
  { mode: 'single', labelKey: 'composer.memoryReferenceEnableSingle', fallback: '单次引用' },
  { mode: 'always', labelKey: 'composer.memoryReferenceEnableAlways', fallback: '常开引用' },
];

function ToolGridIcon() {
  return <Plus size={18} className="selector-tool-icon" aria-hidden="true" />;
}

/**
 * ButtonArea - Bottom toolbar component
 * Contains the compact tool dock, permission/reasoning controls, and send/stop actions.
 */
export const ButtonArea = ({
  disabled = false,
  hasInputContent = false,
  isLoading = false,
  streamActivityPhase = 'idle',
  permissionMode = 'bypassPermissions',
  currentProvider = 'claude',
  providerProfileLabel = null,
  providerAvailability,
  providerVersions,
  reasoningEffort = null,
  reasoningOptions,
  accountRateLimits,
  usageShowRemaining = false,
  onRefreshAccountRateLimits,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  codexSpeedMode,
  onCodexSpeedModeChange,
  onCodexReviewQuickStart,
  onForkQuickStart,
  memoryReferenceMode = 'off',
  onSetMemoryReferenceMode,
  onSubmit,
  onStop,
  onModeSelect,
  onProviderSelect,
  onReasoningChange,
  alwaysThinkingEnabled = false,
  onToggleThinking,
  streamingEnabled = true,
  onStreamingEnabledChange,
  sendShortcut = 'enter',
  selectedAgent,
  onAgentSelect,
  onOpenAgentSettings,
  readinessSurface,
  mainSurface,
  toolSurface,
  panelToggleSurface,
  curatedSkillSurface,
  onSelectSkill,
}: ButtonAreaProps) => {
  const { t } = useTranslation();
  const supportsStreamActivityPhaseFx =
    currentProvider === 'codex' ||
    currentProvider === 'claude' ||
    currentProvider === 'gemini';
  const resolvedStopButtonPhase =
    supportsStreamActivityPhaseFx ? streamActivityPhase : 'idle';

  const [isToolDockOpen, setIsToolDockOpen] = useState(false);
  const toolDockId = useId();
  const buttonAreaRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The tool menu should read as a panel attached to the input box's top edge:
  // full input width, left edge aligned to the box. Radix anchors the popover
  // to the "+" trigger, so we measure the box width and the trigger's offset
  // to derive an equivalent width + negative alignOffset.
  const [menuMetrics, setMenuMetrics] = useState<{
    width: number;
    alignOffset: number;
    sideOffset: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!isToolDockOpen) {
      return;
    }
    const buttonArea = buttonAreaRef.current;
    const trigger = triggerRef.current;
    if (!buttonArea || !trigger || typeof window === 'undefined') {
      return;
    }
    // Gap between the menu's bottom edge and the input box's top edge.
    const MENU_GAP = 8;
    const inputBox = buttonArea.closest('.chat-input-box') as HTMLElement | null;
    const measure = () => {
      const boxRect = buttonArea.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      const width = Math.round(boxRect.width);
      if (width <= 0) {
        return;
      }
      const alignOffset = -Math.round(triggerRect.left - boxRect.left);
      // Lift the menu fully above the input box (not just the "+" trigger), so
      // it never overlaps the text area. sideOffset is measured from the
      // trigger's top edge up to the box's top edge, plus a small gap.
      const anchorTop = inputBox
        ? inputBox.getBoundingClientRect().top
        : boxRect.top;
      const sideOffset = Math.max(8, Math.round(triggerRect.top - anchorTop) + MENU_GAP);
      setMenuMetrics((prev) =>
        prev &&
        prev.width === width &&
        prev.alignOffset === alignOffset &&
        prev.sideOffset === sideOffset
          ? prev
          : { width, alignOffset, sideOffset },
      );
    };
    measure();
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    resizeObserver?.observe(buttonArea);
    window.addEventListener('resize', measure);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isToolDockOpen]);
  const memoryReferenceStateLabel =
    memoryReferenceMode === 'always'
      ? t('composer.memoryReferenceAlwaysOn')
      : memoryReferenceMode === 'single'
        ? t('composer.memoryReferenceSingleOn')
        : t('composer.memoryReferenceToggle');

  /**
   * Handle submit button click
   */
  const handleSubmitClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSubmit?.();
  }, [onSubmit]);

  /**
   * Handle stop button click
   */
  const handleStopClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onStop?.();
  }, [onStop]);

  /**
   * Handle provider selection
   */
  const handleProviderSelect = useCallback((providerId: string) => {
    onProviderSelect?.(providerId);
  }, [onProviderSelect]);

  const toolDockToggleLabel = t('chat.toolDockToggle', {
    defaultValue: isToolDockOpen ? '收起工具' : '展开工具',
  });

  return (
    <div
      ref={buttonAreaRef}
      className={`button-area${isToolDockOpen ? ' is-tool-dock-open' : ''}`}
      data-provider={currentProvider}
    >
      <div className="button-area-primary-row">
        <div className="button-area-left button-area-left--primary">
          <DropdownMenu open={isToolDockOpen} onOpenChange={setIsToolDockOpen}>
            <DropdownMenuTrigger asChild>
              <button
                ref={triggerRef}
                type="button"
                className="selector-button selector-tool-dock-toggle"
                title={toolDockToggleLabel}
                aria-label={toolDockToggleLabel}
                aria-controls={toolDockId}
              >
                <ToolGridIcon />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              id={toolDockId}
              side="top"
              align="start"
              sideOffset={menuMetrics?.sideOffset ?? 12}
              alignOffset={menuMetrics?.alignOffset ?? 0}
              avoidCollisions={false}
              className="composer-tool-menu"
              aria-label={toolDockToggleLabel}
              style={menuMetrics ? { width: menuMetrics.width } : undefined}
            >
              {(toolSurface || panelToggleSurface || curatedSkillSurface) ? (
                <>
                  <div className="composer-tool-menu-surface-row">
                    {toolSurface ? (
                      <div className="button-area-tool-surface">
                        {toolSurface}
                      </div>
                    ) : null}
                    {curatedSkillSurface ? (
                      <div className="button-area-curated-surface">
                        {curatedSkillSurface}
                      </div>
                    ) : null}
                    {panelToggleSurface}
                  </div>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <ConfigSelect
                inline
                currentProvider={currentProvider}
                onProviderChange={handleProviderSelect}
                providerAvailability={providerAvailability}
                providerVersions={providerVersions}
                alwaysThinkingEnabled={alwaysThinkingEnabled}
                onToggleThinking={onToggleThinking}
                streamingEnabled={streamingEnabled}
                onStreamingEnabledChange={onStreamingEnabledChange}
                accountRateLimits={accountRateLimits}
                usageShowRemaining={usageShowRemaining}
                onRefreshAccountRateLimits={onRefreshAccountRateLimits}
                selectedCollaborationModeId={selectedCollaborationModeId}
                onSelectCollaborationMode={onSelectCollaborationMode}
                codexSpeedMode={codexSpeedMode}
                onCodexSpeedModeChange={onCodexSpeedModeChange}
                onCodexReviewQuickStart={onCodexReviewQuickStart}
                onForkQuickStart={onForkQuickStart}
                selectedAgent={selectedAgent}
                onAgentSelect={onAgentSelect}
                onOpenAgentSettings={onOpenAgentSettings}
              />
              <DropdownMenuSeparator />
              {onSetMemoryReferenceMode ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="composer-tool-menu-sub-trigger">
                    <span className="composer-tool-menu-item-icon" aria-hidden>
                      <DatabaseZap size={16} />
                    </span>
                    <span className="composer-tool-menu-item-body">
                      <span className="composer-tool-menu-item-label">
                        {t('composer.memoryReferenceToggle')}
                      </span>
                      <span className="composer-tool-menu-item-value">
                        {memoryReferenceStateLabel}
                      </span>
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="composer-tool-menu-sub-content">
                    {MEMORY_REFERENCE_OPTIONS.map((option) => (
                      <DropdownMenuItem
                        key={option.mode}
                        className={`composer-tool-menu-option${
                          memoryReferenceMode === option.mode ? ' is-selected' : ''
                        }`}
                        onSelect={() => onSetMemoryReferenceMode?.(option.mode)}
                      >
                        <span className="composer-tool-menu-option-body">
                          <span className="composer-tool-menu-option-label">
                            {t(option.labelKey, { defaultValue: option.fallback })}
                          </span>
                        </span>
                        {memoryReferenceMode === option.mode && (
                          <span className="codicon codicon-check composer-tool-menu-option-check" aria-hidden="true" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {readinessSurface ? (
          <div className="button-area-readiness-surface">
            {readinessSurface}
          </div>
        ) : null}

        <div className="button-area-inline-controls">
          <PluginsSelect onSelectSkill={onSelectSkill} />
          <ModeSelect
            value={permissionMode}
            onChange={onModeSelect ?? NOOP_MODE}
            provider={currentProvider}
            selectedCollaborationModeId={selectedCollaborationModeId}
            onSelectCollaborationMode={onSelectCollaborationMode}
          />
          {(currentProvider === 'codex' || currentProvider === 'claude') && (
            <ReasoningSelect
              value={reasoningEffort}
              onChange={onReasoningChange ?? NOOP_REASONING}
              options={reasoningOptions}
              showDefaultOption={currentProvider === 'claude'}
              defaultLabel={
                currentProvider === 'claude'
                  ? t('reasoning.claudeDefault', { defaultValue: '默认' })
                  : undefined
              }
            />
          )}
        </div>

        <div className="button-area-right">
          {mainSurface ? (
            <div className="button-area-main-surface">
              {mainSurface}
            </div>
          ) : null}
          {providerProfileLabel ? (
            <span className="button-area-provider-tag" title={providerProfileLabel}>
              {providerProfileLabel}
            </span>
          ) : null}
          {isLoading ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={`submit-button stop-button is-${resolvedStopButtonPhase}`}
              onClick={handleStopClick}
              title={t('chat.stopGeneration')}
              data-stream-phase={resolvedStopButtonPhase}
            >
              <Square aria-hidden fill="currentColor" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="submit-button"
              onClick={handleSubmitClick}
              disabled={disabled || !hasInputContent}
              title={
                sendShortcut === 'cmdEnter'
                  ? t('chat.sendMessageCmdEnter')
                  : t('chat.sendMessageEnter')
              }
            >
              <ArrowUp aria-hidden />
            </Button>
          )}
        </div>
      </div>

    </div>
  );
};

export default ButtonArea;
