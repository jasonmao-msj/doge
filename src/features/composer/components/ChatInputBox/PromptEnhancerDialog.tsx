import { useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { EngineType } from '../../../../types';
import { EngineIcon } from '../../../engine/components/EngineIcon';
import type { ModelInfo } from './types';
import { PROMPT_ENHANCER_ENGINE_OPTIONS } from './hooks/usePromptEnhancer';

interface PromptEnhancerDialogProps {
  isOpen: boolean;
  isLoading: boolean;
  loadingEngine: EngineType;
  selectedEngine: EngineType;
  selectedModel: string;
  modelOptions: ModelInfo[];
  timeoutSeconds: number;
  timeoutLimits: {
    minSeconds: number;
    maxSeconds: number;
  };
  originalPrompt: string;
  enhancedPrompt: string;
  canUseEnhanced: boolean;
  onEngineChange: (engine: EngineType) => void;
  onModelChange: (modelId: string) => void;
  onTimeoutChange: (timeoutSeconds: number) => void;
  onRunEnhancement: () => void;
  onUseEnhanced: () => void;
  onKeepOriginal: () => void;
  onClose: () => void;
}

/**
 * PromptEnhancerDialog - Prompt enhancement dialog
 * Displays original and enhanced prompts, letting the user choose which version to use
 */
export const PromptEnhancerDialog = ({
  isOpen,
  isLoading,
  loadingEngine,
  selectedEngine,
  selectedModel,
  modelOptions,
  timeoutSeconds,
  timeoutLimits,
  originalPrompt,
  enhancedPrompt,
  canUseEnhanced,
  onEngineChange,
  onModelChange,
  onTimeoutChange,
  onRunEnhancement,
  onUseEnhanced,
  onKeepOriginal,
  onClose,
}: PromptEnhancerDialogProps) => {
  const { t } = useTranslation();

  const getEngineLabel = (engine: EngineType) => {
    switch (engine) {
      case 'claude':
        return 'Claude';
      case 'codex':
        return 'Codex';
      case 'gemini':
        return 'Gemini';
      case 'opencode':
        return 'OpenCode';
      default:
        return 'AI';
    }
  };

  const loadingLabel = getEngineLabel(loadingEngine);

  // Handle keyboard events
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && !isLoading && canUseEnhanced) {
      e.preventDefault();
      onUseEnhanced();
    }
  }, [canUseEnhanced, onClose, onUseEnhanced, isLoading]);

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) {
    return null;
  }

  // Close on overlay click
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="prompt-enhancer-overlay" onClick={handleOverlayClick}>
      <div className="prompt-enhancer-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="prompt-enhancer-header">
          <div className="prompt-enhancer-title">
            <span className="codicon codicon-sparkle" />
            <h3>{t('promptEnhancer.title')}</h3>
          </div>
          <button className="prompt-enhancer-close" onClick={onClose}>
            <span className="codicon codicon-close" />
          </button>
        </div>

        {/* Content area */}
        <div className="prompt-enhancer-content">
          <div className="prompt-enhancer-config" aria-label={t('promptEnhancer.runSettings')}>
            <label className="prompt-enhancer-field">
              <span>{t('promptEnhancer.provider')}</span>
              <select
                className="prompt-enhancer-select"
                value={selectedEngine}
                onChange={(event) => onEngineChange(event.target.value as EngineType)}
                disabled={isLoading}
              >
                {PROMPT_ENHANCER_ENGINE_OPTIONS.map((engine) => (
                  <option key={engine} value={engine}>
                    {getEngineLabel(engine)}
                  </option>
                ))}
              </select>
            </label>
            <label className="prompt-enhancer-field">
              <span>{t('promptEnhancer.model')}</span>
              <select
                className="prompt-enhancer-select"
                value={selectedModel}
                onChange={(event) => onModelChange(event.target.value)}
                disabled={isLoading || modelOptions.length === 0}
              >
                {modelOptions.length === 0 ? (
                  <option value="">{t('promptEnhancer.noModel')}</option>
                ) : (
                  modelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label || model.id}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="prompt-enhancer-field">
              <span>{t('promptEnhancer.timeoutSeconds')}</span>
              <input
                className="prompt-enhancer-timeout"
                type="number"
                min={timeoutLimits.minSeconds}
                max={timeoutLimits.maxSeconds}
                step={1}
                value={timeoutSeconds}
                onChange={(event) => onTimeoutChange(Number(event.target.value))}
                disabled={isLoading}
              />
            </label>
            <button
              className="prompt-enhancer-btn primary prompt-enhancer-run-btn"
              onClick={onRunEnhancement}
              disabled={isLoading || !originalPrompt.trim()}
            >
              <span className="codicon codicon-play" />
              {t('promptEnhancer.runEnhancement')}
            </button>
          </div>

          {/* Original prompt */}
          <div className="prompt-section">
            <div className="prompt-section-header">
              <span className="codicon codicon-edit" />
              <span>{t('promptEnhancer.originalPrompt')}</span>
            </div>
            <div className="prompt-text original-prompt">
              {originalPrompt}
            </div>
          </div>

          {/* Enhanced prompt */}
          <div className="prompt-section">
            <div className="prompt-section-header">
              <span className="codicon codicon-sparkle" />
              <span>{t('promptEnhancer.enhancedPrompt')}</span>
            </div>
            <div className="prompt-text enhanced-prompt">
              {isLoading ? (
                <div className="prompt-loading">
                  <EngineIcon
                    engine={loadingEngine}
                    size={16}
                    className="prompt-loading-engine-icon"
                  />
                  <span>{`${loadingLabel} · ${t('promptEnhancer.enhancing')}`}</span>
                </div>
              ) : (
                enhancedPrompt || t('promptEnhancer.readyToEnhance')
              )}
            </div>
          </div>
        </div>

        {/* Footer buttons */}
        <div className="prompt-enhancer-footer">
          <button
            className="prompt-enhancer-btn secondary"
            onClick={onKeepOriginal}
            disabled={isLoading}
          >
            <span className="codicon codicon-close" />
            {t('promptEnhancer.keepOriginal')}
          </button>
          <button
            className="prompt-enhancer-btn primary"
            onClick={onUseEnhanced}
            disabled={isLoading || !canUseEnhanced}
          >
            <span className="codicon codicon-check" />
            {t('promptEnhancer.useEnhanced')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromptEnhancerDialog;
