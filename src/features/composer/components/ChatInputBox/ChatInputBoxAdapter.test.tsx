// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComposerSendReadiness } from '../../utils/composerSendReadiness';
import {
  clearPromptUsageForTests,
  recordPromptUsage,
} from '../../../prompts/promptUsage';
import { composerInputFixture100ime } from '../../../../test-fixtures/perf/composerInputFixture100ime';

const mockState = vi.hoisted(() => ({
  latestProps: null as Record<string, unknown> | null,
  renderCount: 0,
  getClaudeProviders: vi.fn(),
  getClaudeAlwaysThinkingEnabled: vi.fn(),
  setClaudeAlwaysThinkingEnabled: vi.fn(),
  updateClaudeProvider: vi.fn(),
  switchClaudeProvider: vi.fn(),
  getWorkspaceFiles: vi.fn(),
  getWorkspaceDirectoryChildren: vi.fn(),
  getSkillsList: vi.fn(),
  projectMemoryList: vi.fn(),
  noteCardList: vi.fn(),
  appendComposerRenderBudgetDiagnostic: vi.fn(),
  requestCustomPromptsRefresh: vi.fn(),
}));

vi.mock('./ChatInputBox', async () => {
  const React = await import('react');
  const MockChatInputBox = React.forwardRef((props: Record<string, unknown>, ref) => {
    mockState.latestProps = props;
    mockState.renderCount += 1;
    React.useImperativeHandle(ref, () => ({
      getValue: () => '',
      setValue: () => {},
      focus: () => {},
      clear: () => {},
      hasContent: () => false,
      getFileTags: () => [],
    }));
    return <div data-testid="mock-chat-input-box" />;
  });
  MockChatInputBox.displayName = 'MockChatInputBox';
  return { ChatInputBox: MockChatInputBox };
});

vi.mock('../../../../services/tauri', () => ({
  getClaudeProviders: mockState.getClaudeProviders,
  getClaudeAlwaysThinkingEnabled: mockState.getClaudeAlwaysThinkingEnabled,
  setClaudeAlwaysThinkingEnabled: mockState.setClaudeAlwaysThinkingEnabled,
  updateClaudeProvider: mockState.updateClaudeProvider,
  switchClaudeProvider: mockState.switchClaudeProvider,
  getWorkspaceFiles: mockState.getWorkspaceFiles,
  getWorkspaceDirectoryChildren: mockState.getWorkspaceDirectoryChildren,
  getSkillsList: mockState.getSkillsList,
}));

vi.mock('../../../project-memory/services/projectMemoryFacade', () => ({
  projectMemoryFacade: {
    list: mockState.projectMemoryList,
  },
}));

vi.mock('../../../note-cards/services/noteCardsFacade', () => ({
  noteCardsFacade: {
    list: mockState.noteCardList,
  },
}));

vi.mock('../../../../services/rendererDiagnostics', () => ({
  appendComposerRenderBudgetDiagnostic: mockState.appendComposerRenderBudgetDiagnostic,
}));

vi.mock('../../../prompts/promptEvents', () => ({
  requestCustomPromptsRefresh: mockState.requestCustomPromptsRefresh,
}));

import { ChatInputBoxAdapter } from './ChatInputBoxAdapter';

function renderAdapter(
  overrides: Partial<ComponentProps<typeof ChatInputBoxAdapter>> = {},
) {
  return render(
    <ChatInputBoxAdapter
      text=""
      isProcessing={false}
      canStop={false}
      selectedModelId="claude-sonnet-4-6"
      onSend={() => {}}
      onStop={() => {}}
      onTextChange={() => {}}
      selectedEngine="claude"
      {...overrides}
    />,
  );
}

describe('ChatInputBoxAdapter toggle bridge', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockState.latestProps = null;
    mockState.requestCustomPromptsRefresh.mockReset();
    mockState.requestCustomPromptsRefresh.mockResolvedValue([]);
    mockState.renderCount = 0;
    mockState.getClaudeProviders.mockReset().mockResolvedValue([
      {
        id: 'provider-1',
        name: 'Claude',
        isActive: true,
        settingsConfig: { alwaysThinkingEnabled: false },
      },
    ]);
    mockState.getClaudeAlwaysThinkingEnabled.mockReset().mockResolvedValue(false);
    mockState.setClaudeAlwaysThinkingEnabled.mockReset().mockResolvedValue(undefined);
    mockState.updateClaudeProvider.mockReset().mockResolvedValue(undefined);
    mockState.switchClaudeProvider.mockReset().mockResolvedValue(undefined);
    mockState.getWorkspaceFiles.mockReset().mockResolvedValue({
      files: [],
      directories: [],
    });
    mockState.getWorkspaceDirectoryChildren.mockReset().mockResolvedValue({
      files: [],
      directories: [],
    });
    mockState.getSkillsList.mockReset().mockResolvedValue([]);
    mockState.projectMemoryList.mockReset().mockResolvedValue({ items: [], total: 0 });
    mockState.noteCardList.mockReset().mockResolvedValue({ items: [], total: 0 });
    mockState.appendComposerRenderBudgetDiagnostic.mockReset();
    window.localStorage.clear();
    clearPromptUsageForTests();
  });

  it('provides internal thinking and streaming handlers by default', async () => {
    renderAdapter();

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      alwaysThinkingEnabled?: boolean;
      streamingEnabled?: boolean;
      onToggleThinking?: (enabled: boolean) => void | Promise<void>;
      onStreamingEnabledChange?: (enabled: boolean) => void;
    };

    await waitFor(() => expect(latest.alwaysThinkingEnabled).toBe(false));
    expect(latest.streamingEnabled).toBe(true);
    expect(typeof latest.onToggleThinking).toBe('function');
    expect(typeof latest.onStreamingEnabledChange).toBe('function');

    await act(async () => {
      await Promise.resolve(latest.onToggleThinking?.(true));
    });

    expect(mockState.updateClaudeProvider).toHaveBeenCalledTimes(1);
    expect(mockState.switchClaudeProvider).not.toHaveBeenCalled();
    expect(mockState.updateClaudeProvider).toHaveBeenCalledWith(
      'provider-1',
      expect.objectContaining({
        settingsConfig: expect.objectContaining({
          alwaysThinkingEnabled: true,
        }),
      }),
    );

    act(() => {
      latest.onStreamingEnabledChange?.(false);
    });
    expect(window.localStorage.getItem('doge.composer.streaming-enabled')).toBe('0');
  });

  it('reports resolved Claude thinking state to parent surfaces', async () => {
    const onResolvedAlwaysThinkingChange = vi.fn();
    renderAdapter({ onResolvedAlwaysThinkingChange });

    await waitFor(() => {
      expect(onResolvedAlwaysThinkingChange).toHaveBeenLastCalledWith(false);
    });

    const latest = mockState.latestProps as {
      onToggleThinking?: (enabled: boolean) => void | Promise<void>;
    };
    await act(async () => {
      await Promise.resolve(latest.onToggleThinking?.(true));
    });

    await waitFor(() => {
      expect(onResolvedAlwaysThinkingChange).toHaveBeenLastCalledWith(true);
    });
  });

  it('does not report the same resolved Claude thinking value repeatedly', async () => {
    const onResolvedAlwaysThinkingChange = vi.fn();
    renderAdapter({ onResolvedAlwaysThinkingChange });

    await waitFor(() => {
      expect(onResolvedAlwaysThinkingChange).toHaveBeenCalledWith(false);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onResolvedAlwaysThinkingChange).toHaveBeenCalledTimes(1);
  });

  it('does not report unresolved Claude thinking as disabled before settings load', async () => {
    let resolveProviders: (
      value: Array<{
        id: string;
        name: string;
        isActive: boolean;
        settingsConfig: { alwaysThinkingEnabled: boolean };
      }>,
    ) => void = () => {};
    mockState.getClaudeProviders.mockReturnValue(
      new Promise((resolve) => {
        resolveProviders = resolve;
      }),
    );
    const onResolvedAlwaysThinkingChange = vi.fn();
    renderAdapter({ onResolvedAlwaysThinkingChange });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    expect(onResolvedAlwaysThinkingChange).not.toHaveBeenCalled();

    await act(async () => {
      resolveProviders([
        {
          id: 'provider-1',
          name: 'Claude',
          isActive: true,
          settingsConfig: { alwaysThinkingEnabled: false },
        },
      ]);
    });

    await waitFor(() => {
      expect(onResolvedAlwaysThinkingChange).toHaveBeenCalledWith(false);
    });
  });

  it('forces codex thinking and streaming to stay enabled and skips claude setting reads', async () => {
    window.localStorage.setItem('doge.composer.streaming-enabled', '0');

    renderAdapter({
      selectedEngine: 'codex',
      alwaysThinkingEnabled: false,
      streamingEnabled: false,
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      alwaysThinkingEnabled?: boolean;
      streamingEnabled?: boolean;
    };

    expect(latest.alwaysThinkingEnabled).toBe(true);
    expect(latest.streamingEnabled).toBe(true);
    expect(mockState.getClaudeProviders).not.toHaveBeenCalled();
    expect(mockState.getClaudeAlwaysThinkingEnabled).not.toHaveBeenCalled();
  });

  it('forwards file-reference open callbacks to ChatInputBox', async () => {
    const onOpenFileReference = vi.fn();

    renderAdapter({
      onOpenFileReference,
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      onOpenFileReference?: (path: string) => void;
    };

    expect(latest.onOpenFileReference).toBe(onOpenFileReference);
  });

  it('normalizes and deduplicates root file-reference completion sources', async () => {
    renderAdapter({
      directories: ['src', 'src/', '', '   ', 42],
      files: ['README.md', 'README.md', 'src\\App.tsx', null],
    } as Partial<ComponentProps<typeof ChatInputBoxAdapter>>);

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      fileCompletionProvider?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<Array<{ name: string; path: string; type: string }>>;
    };

    const results = await latest.fileCompletionProvider?.('', new AbortController().signal);

    expect(results).toEqual([
      expect.objectContaining({
        name: 'src',
        path: 'src/',
        type: 'directory',
      }),
      expect.objectContaining({
        name: 'README.md',
        path: 'README.md',
        type: 'file',
      }),
    ]);
  });

  it('searches full workspace file references for non-scoped @ queries', async () => {
    mockState.getWorkspaceFiles.mockResolvedValue({
      directories: ['src', 'src-tauri', 'src-tauri/src'],
      files: ['README.md', 'build.rs', 'src-tauri/src/build_config.rs'],
    });

    renderAdapter({
      workspaceId: 'workspace-1',
      directories: ['src', 'src-tauri'],
      files: ['README.md'],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      fileCompletionProvider?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<Array<{ name: string; path: string; type: string }>>;
    };

    const results = await latest.fileCompletionProvider?.('build', new AbortController().signal);

    expect(mockState.getWorkspaceFiles).toHaveBeenCalledWith('workspace-1');
    expect(results).toEqual([
      expect.objectContaining({
        name: 'build.rs',
        path: 'build.rs',
        type: 'file',
      }),
      expect.objectContaining({
        name: 'build_config.rs',
        path: 'src-tauri/src/build_config.rs',
        type: 'file',
      }),
    ]);
  });

  it('reuses the full workspace file-reference cache across non-scoped queries', async () => {
    mockState.getWorkspaceFiles.mockResolvedValue({
      directories: ['src', 'src/features'],
      files: ['src/features/Composer.tsx', 'src/features/ContextBar.tsx'],
    });

    renderAdapter({
      workspaceId: 'workspace-1',
      directories: ['src'],
      files: [],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      fileCompletionProvider?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<Array<{ name: string; path: string; type: string }>>;
    };

    const firstResults = await latest.fileCompletionProvider?.('Composer', new AbortController().signal);
    const secondResults = await latest.fileCompletionProvider?.('Context', new AbortController().signal);

    expect(mockState.getWorkspaceFiles).toHaveBeenCalledTimes(1);
    expect(firstResults?.map((item) => item.path)).toContain('src/features/Composer.tsx');
    expect(secondResults?.map((item) => item.path)).toContain('src/features/ContextBar.tsx');
  });

  it('skips malformed lazy workspace children without dropping valid matches', async () => {
    mockState.getWorkspaceDirectoryChildren.mockResolvedValue({
      directories: ['src/components', 'src/components/', '', 99],
      files: ['src/index.ts', 'src/index.ts', {}, '  '],
    });

    renderAdapter({
      workspaceId: 'workspace-1',
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      fileCompletionProvider?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<Array<{ name: string; path: string; type: string }>>;
    };

    const results = await latest.fileCompletionProvider?.('src/', new AbortController().signal);

    expect(mockState.getWorkspaceDirectoryChildren).toHaveBeenCalledWith(
      'workspace-1',
      'src',
    );
    expect(results).toEqual([
      expect.objectContaining({
        name: 'components',
        path: 'src/components/',
        type: 'directory',
      }),
      expect.objectContaining({
        name: 'index.ts',
        path: 'src/index.ts',
        type: 'file',
      }),
    ]);
  });

  it('forwards send readiness projection to ChatInputBox', async () => {
    const sendReadiness: ComposerSendReadiness = {
      target: {
        engine: 'codex',
        providerLabel: 'Codex',
        modelLabel: 'gpt-5.5',
        modeLabel: 'Auto Mode',
        modeImpactLabel: 'Full access',
        accessModeLabel: 'full-access',
      },
      contextSummary: {
        chips: ['files:1'],
        compactLabel: 'files:1',
        detailLabel: 'Sending with files:1',
      },
      readiness: {
        canSend: true,
        canQueue: false,
        canStop: false,
        disabledReason: null,
        primaryAction: 'send',
      },
      activity: {
        kind: 'idle',
        severity: 'neutral',
        shortLabel: 'ready',
        detailLabel: 'Ready to send.',
        actionHint: null,
      },
      requestPointer: null,
    };

    renderAdapter({
      selectedEngine: 'codex',
      sendReadiness,
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      sendReadiness?: typeof sendReadiness;
    };

    expect(latest.sendReadiness).toBe(sendReadiness);
  });

  it('avoids rerendering ChatInputBox when adapter props stay referentially stable', async () => {
    const stableProps: ComponentProps<typeof ChatInputBoxAdapter> = {
      text: '',
      isProcessing: false,
      canStop: false,
      selectedModelId: 'claude-sonnet-4-6',
      onSend: () => {},
      onStop: () => {},
      onTextChange: () => {},
      selectedEngine: 'claude',
    };

    const view = render(<ChatInputBoxAdapter {...stableProps} />);
    await waitFor(() => expect(mockState.latestProps).toBeTruthy());
    expect(mockState.renderCount).toBe(1);

    view.rerender(<ChatInputBoxAdapter {...stableProps} />);
    expect(mockState.renderCount).toBe(1);
  });

  it('avoids rerendering ChatInputBox when stream-facing object props are structurally unchanged', async () => {
    const stableProps: ComponentProps<typeof ChatInputBoxAdapter> = {
      text: '',
      isProcessing: true,
      canStop: false,
      selectedModelId: 'claude-sonnet-4-6',
      onSend: () => {},
      onStop: () => {},
      onTextChange: () => {},
      selectedEngine: 'codex',
      contextUsage: {
        used: 512,
        total: 8192,
      },
      claudeContextUsage: {
        usedTokens: 256,
        contextWindow: 8192,
        totalTokens: 768,
        inputTokens: 512,
        cachedInputTokens: 128,
        outputTokens: 128,
        usedPercent: 3.125,
        remainingPercent: 96.875,
        freshness: 'live',
        source: 'runtime',
        hasUsage: true,
      },
      accountRateLimits: {
        primary: {
          usedPercent: 12,
          windowDurationMins: 5,
          resetsAt: 123456789,
        },
        secondary: null,
        credits: {
          hasCredits: true,
          unlimited: false,
          balance: '42',
        },
        planType: 'pro',
      },
      selectedManualMemoryIds: ['memory-1', 'memory-2'],
      selectedNoteCardIds: ['note-1', 'note-2'],
      customSkillDirectories: ['/repo/.codex/skills', '/repo/.agents/skills'],
    };

    const view = render(<ChatInputBoxAdapter {...stableProps} />);
    await waitFor(() => expect(mockState.latestProps).toBeTruthy());
    expect(mockState.renderCount).toBe(1);

    view.rerender(
      <ChatInputBoxAdapter
        {...stableProps}
        contextUsage={{ used: 512, total: 8192 }}
        claudeContextUsage={{
          usedTokens: 256,
          contextWindow: 8192,
          totalTokens: 768,
          inputTokens: 512,
          cachedInputTokens: 128,
          outputTokens: 128,
          usedPercent: 3.125,
          remainingPercent: 96.875,
          freshness: 'live',
          source: 'runtime',
          hasUsage: true,
        }}
        accountRateLimits={{
          primary: {
            usedPercent: 12,
            windowDurationMins: 5,
            resetsAt: 123456789,
          },
          secondary: null,
          credits: {
            hasCredits: true,
            unlimited: false,
            balance: '42',
          },
          planType: 'pro',
        }}
        selectedManualMemoryIds={['memory-1', 'memory-2']}
        selectedNoteCardIds={['note-1', 'note-2']}
        customSkillDirectories={['/repo/.codex/skills', '/repo/.agents/skills']}
      />,
    );

    expect(mockState.renderCount).toBe(1);
  });

  it('avoids rerendering ChatInputBox when advisory lists are structurally unchanged', async () => {
    const stableProps: ComponentProps<typeof ChatInputBoxAdapter> = {
      text: '',
      isProcessing: true,
      canStop: false,
      selectedModelId: 'claude-sonnet-4-6',
      onSend: () => {},
      onStop: () => {},
      onTextChange: () => {},
      selectedEngine: 'codex',
      selectedContextChips: [
        {
          type: 'skill',
          name: 'perf-audit',
          description: 'Performance audit',
          path: '/skills/perf-audit',
          source: 'workspace',
        },
      ],
      queuedMessages: [
        {
          id: 'queued-1',
          text: 'queued text',
          createdAt: 123,
        },
      ],
      commands: [
        {
          name: 'review',
          path: '/commands/review.md',
          description: 'Review command',
          argumentHint: '<target>',
          content: 'review content',
          source: 'workspace',
        },
      ],
      prompts: [
        {
          name: 'summarize',
          path: '/prompts/summarize.md',
          description: 'Summarize prompt',
          argumentHint: '<input>',
          content: 'summarize content',
          scope: 'workspace',
        },
      ],
    };

    const view = render(<ChatInputBoxAdapter {...stableProps} />);
    await waitFor(() => expect(mockState.latestProps).toBeTruthy());
    expect(mockState.renderCount).toBe(1);

    view.rerender(
      <ChatInputBoxAdapter
        {...stableProps}
        selectedContextChips={[
          {
            type: 'skill',
            name: 'perf-audit',
            description: 'Performance audit',
            path: '/skills/perf-audit',
            source: 'workspace',
          },
        ]}
        queuedMessages={[
          {
            id: 'queued-1',
            text: 'queued text',
            createdAt: 123,
          },
        ]}
        commands={[
          {
            name: 'review',
            path: '/commands/review.md',
            description: 'Review command',
            argumentHint: '<target>',
            content: 'review content',
            source: 'workspace',
          },
        ]}
        prompts={[
          {
            name: 'summarize',
            path: '/prompts/summarize.md',
            description: 'Summarize prompt',
            argumentHint: '<input>',
            content: 'summarize content',
            scope: 'workspace',
          },
        ]}
      />,
    );

    expect(mockState.renderCount).toBe(1);
  });

  it('rerenders ChatInputBox when advisory list content changes', async () => {
    const stableProps: ComponentProps<typeof ChatInputBoxAdapter> = {
      text: '',
      isProcessing: true,
      canStop: false,
      selectedModelId: 'claude-sonnet-4-6',
      onSend: () => {},
      onStop: () => {},
      onTextChange: () => {},
      selectedEngine: 'codex',
      queuedMessages: [
        {
          id: 'queued-1',
          text: 'queued text',
          createdAt: 123,
        },
      ],
    };

    const view = render(<ChatInputBoxAdapter {...stableProps} />);
    await waitFor(() => expect(mockState.latestProps).toBeTruthy());
    expect(mockState.renderCount).toBe(1);

    view.rerender(
      <ChatInputBoxAdapter
        {...stableProps}
        queuedMessages={[
          {
            id: 'queued-1',
            text: 'changed queued text',
            createdAt: 123,
          },
        ]}
      />,
    );

    expect(mockState.renderCount).toBe(2);
  });

  it('rerenders ChatInputBox when custom commands are loaded after mount', async () => {
    const stableProps: ComponentProps<typeof ChatInputBoxAdapter> = {
      text: '',
      isProcessing: false,
      canStop: false,
      selectedModelId: 'claude-sonnet-4-6',
      onSend: () => {},
      onStop: () => {},
      onTextChange: () => {},
      selectedEngine: 'claude',
      commands: [],
    };

    const view = render(<ChatInputBoxAdapter {...stableProps} />);
    await waitFor(() => expect(mockState.latestProps).toBeTruthy());
    expect(mockState.renderCount).toBe(1);

    view.rerender(
      <ChatInputBoxAdapter
        {...stableProps}
        commands={[
          {
            name: 'next',
            path: '/repo/.claude/commands/next.md',
            description: 'continue with next step',
            content: 'next',
          },
        ]}
      />,
    );

    expect(mockState.renderCount).toBe(2);
  });

  it('matches project custom slash commands by slash name', async () => {
    renderAdapter({
      commands: [
        {
          name: 'next',
          path: '/repo/.claude/commands/next.md',
          description: 'continue with next step',
          content: 'next',
        },
      ],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      commandCompletionProvider?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<Array<{ id: string; label: string; category?: string }>>;
    };

    const results = await latest.commandCompletionProvider?.('next', new AbortController().signal);

    expect(results).toContainEqual(
      expect.objectContaining({
        id: 'next',
        label: '/next',
        category: 'custom',
      }),
    );
  });

  it('skips malformed project custom slash command entries', async () => {
    renderAdapter({
      commands: [
        {
          name: 'next',
          path: '/repo/.claude/commands/next.md',
          description: 'continue with next step',
          content: 'next',
        },
        { name: 42, description: 'bad name' },
        { description: 'missing name' },
        null,
      ],
    } as Partial<ComponentProps<typeof ChatInputBoxAdapter>>);

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      commandCompletionProvider?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<Array<{ id: string; label: string; category?: string }>>;
    };

    const results = await latest.commandCompletionProvider?.('next', new AbortController().signal);

    expect(results).toEqual([
      expect.objectContaining({
        id: 'next',
        label: '/next',
        category: 'custom',
      }),
    ]);
  });

  it('surfaces all locally handled slash commands in the command popup', async () => {
    renderAdapter();

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      commandCompletionProvider?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<Array<{ id: string; label: string; category?: string }>>;
    };

    const claudeResults = await latest.commandCompletionProvider?.('', new AbortController().signal);
    const claudeLabels = new Set((claudeResults ?? []).map((entry) => entry.label));

    expect([...claudeLabels]).toEqual(
      expect.arrayContaining([
        '/compact',
        '/context',
        '/export',
        '/import',
        '/lsp',
        '/share',
        '/spec-root',
      ]),
    );
    expect(claudeLabels.has('/plan')).toBe(false);
    expect(claudeLabels.has('/mode')).toBe(false);
  });

  it('surfaces Codex-only mode commands in the command popup', async () => {
    renderAdapter({ selectedEngine: 'codex' });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      commandCompletionProvider?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<Array<{ id: string; label: string; category?: string }>>;
    };

    const codexResults = await latest.commandCompletionProvider?.('', new AbortController().signal);
    const codexLabels = new Set((codexResults ?? []).map((entry) => entry.label));

    expect([...codexLabels]).toEqual(
      expect.arrayContaining([
        '/code',
        '/default',
        '/fast',
        '/goal',
        '/goal pause',
        '/goal resume',
        '/goal clear',
        '/mode',
        '/plan',
      ]),
    );
    expect(codexLabels.has('/compact')).toBe(false);
  });

  it('uses external thinking callback when supplied', async () => {
    const onToggleThinking = vi.fn();
    renderAdapter({
      alwaysThinkingEnabled: true,
      onToggleThinking,
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      onToggleThinking?: (enabled: boolean) => void | Promise<void>;
    };
    await act(async () => {
      await Promise.resolve(latest.onToggleThinking?.(false));
    });

    expect(onToggleThinking).toHaveBeenCalledWith(false);
    expect(mockState.updateClaudeProvider).not.toHaveBeenCalled();
    expect(mockState.switchClaudeProvider).not.toHaveBeenCalled();
  });

  it('falls back to direct claude settings when no active provider exists', async () => {
    mockState.getClaudeProviders.mockResolvedValue([]);
    mockState.getClaudeAlwaysThinkingEnabled.mockResolvedValue(true);

    renderAdapter();

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());
    const getLatest = () => mockState.latestProps as {
      alwaysThinkingEnabled?: boolean;
      onToggleThinking?: (enabled: boolean) => void | Promise<void>;
    };

    await waitFor(() => expect(getLatest().alwaysThinkingEnabled).toBe(true));

    await act(async () => {
      await Promise.resolve(getLatest().onToggleThinking?.(false));
    });

    expect(mockState.updateClaudeProvider).not.toHaveBeenCalled();
    expect(mockState.switchClaudeProvider).not.toHaveBeenCalled();
    expect(mockState.setClaudeAlwaysThinkingEnabled).toHaveBeenCalledWith(false);
  });

  it('falls back to direct claude settings when active provider lacks thinking field', async () => {
    mockState.getClaudeProviders.mockResolvedValue([
      {
        id: '__local_settings_json__',
        name: '本地配置',
        isActive: true,
        isLocalProvider: true,
        settingsConfig: {},
      },
    ]);
    mockState.getClaudeAlwaysThinkingEnabled.mockResolvedValue(true);

    renderAdapter();

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());
    const getLatest = () => mockState.latestProps as {
      alwaysThinkingEnabled?: boolean;
    };
    await waitFor(() => expect(getLatest().alwaysThinkingEnabled).toBe(true));
    expect(mockState.getClaudeAlwaysThinkingEnabled).toHaveBeenCalledTimes(1);
  });

  it('uses direct claude settings write when local provider is active', async () => {
    mockState.getClaudeProviders.mockResolvedValue([
      {
        id: '__local_settings_json__',
        name: '本地配置',
        isActive: true,
        isLocalProvider: true,
        settingsConfig: {},
      },
    ]);

    renderAdapter();

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());
    const latest = mockState.latestProps as {
      onToggleThinking?: (enabled: boolean) => void | Promise<void>;
    };

    await act(async () => {
      await Promise.resolve(latest.onToggleThinking?.(true));
    });

    expect(mockState.setClaudeAlwaysThinkingEnabled).toHaveBeenCalledWith(true);
    expect(mockState.updateClaudeProvider).not.toHaveBeenCalled();
    expect(mockState.switchClaudeProvider).not.toHaveBeenCalled();
  });

  it('rolls back a failed managed-provider update without writing global settings', async () => {
    mockState.updateClaudeProvider.mockRejectedValueOnce(new Error('write failed'));

    renderAdapter();

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());
    const getLatest = () => mockState.latestProps as {
      alwaysThinkingEnabled?: boolean;
      onToggleThinking?: (enabled: boolean) => void | Promise<void>;
    };

    await act(async () => {
      await Promise.resolve(getLatest().onToggleThinking?.(true));
    });

    expect(mockState.updateClaudeProvider).toHaveBeenCalledTimes(1);
    expect(mockState.setClaudeAlwaysThinkingEnabled).not.toHaveBeenCalled();
    expect(getLatest().alwaysThinkingEnabled).toBe(false);
  });

  it('forwards send shortcut to ChatInputBox', async () => {
    renderAdapter({ sendShortcut: 'cmdEnter' });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      sendShortcut?: 'enter' | 'cmdEnter';
    };
    expect(latest.sendShortcut).toBe('cmdEnter');
  });

  it('keeps ultra while dropping unknown reasoning effort values', async () => {
    renderAdapter({
      selectedEffort: 'ultra',
      reasoningOptions: ['high', 'ultra', 'turbo', 'max'],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      reasoningEffort?: string | null;
      reasoningOptions?: string[];
    };
    expect(latest.reasoningEffort).toBe('ultra');
    expect(latest.reasoningOptions).toEqual(['high', 'ultra', 'max']);
  });

  it('preserves explicit empty reasoning options instead of falling back to every level', async () => {
    renderAdapter({
      selectedEngine: 'codex',
      selectedEffort: null,
      reasoningOptions: [],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      reasoningOptions?: string[];
    };
    expect(latest.reasoningOptions).toEqual([]);
  });

  it('forwards queue fusion props to ChatInputBox', async () => {
    const onFuseQueued = vi.fn();

    renderAdapter({
      queuedMessages: [
        {
          id: 'queued-1',
          text: 'queue full text',
          createdAt: 123,
        },
      ],
      onFuseQueued,
      canFuseQueuedMessages: true,
      fusingQueuedMessageId: 'queued-1',
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      messageQueue?: Array<{
        id: string;
        content: string;
        fullContent?: string;
        queuedAt: number;
        isFusing?: boolean;
      }>;
      onFuseFromQueue?: (id: string) => void;
      canFuseFromQueue?: boolean;
      fusingQueueMessageId?: string | null;
    };

    expect(latest.messageQueue).toEqual([
      {
        id: 'queued-1',
        content: 'queue full text',
        fullContent: 'queue full text',
        queuedAt: 123,
        isFusing: true,
        isPendingAck: false,
      },
    ]);
    expect(latest.canFuseFromQueue).toBe(true);
    expect(latest.fusingQueueMessageId).toBe('queued-1');

    act(() => {
      latest.onFuseFromQueue?.('queued-1');
    });

    expect(onFuseQueued).toHaveBeenCalledWith('queued-1');
  });

  it('maps Shared pending-ack queue state for UI labeling', async () => {
    renderAdapter({
      queuedMessages: [
        {
          id: 'queued-ack',
          text: 'follow-up already sent',
          createdAt: 456,
          sharedDispatchState: 'pending-ack',
        },
      ],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      messageQueue?: Array<{ id: string; isPendingAck?: boolean }>;
    };

    expect(latest.messageQueue).toEqual([
      expect.objectContaining({
        id: 'queued-ack',
        isPendingAck: true,
      }),
    ]);
  });

  it('forwards input text changes without runtime errors', async () => {
    const onTextChange = vi.fn();
    renderAdapter({ onTextChange });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      onInput?: (content: string) => void;
    };
    expect(typeof latest.onInput).toBe('function');

    expect(() => {
      latest.onInput?.('hello');
    }).not.toThrow();
    expect(onTextChange).toHaveBeenCalledWith('hello', null);
  });

  it('records content-safe composer render budget diagnostics', async () => {
    renderAdapter({
      text: 'secret prompt text must not be sent to diagnostics',
      workspaceId: 'workspace-1',
      isProcessing: true,
      streamActivityPhase: 'ingress',
    });

    await waitFor(() =>
      expect(mockState.appendComposerRenderBudgetDiagnostic).toHaveBeenCalled(),
    );

    const [payload] = mockState.appendComposerRenderBudgetDiagnostic.mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      surfaceId: 'chat-input-adapter',
      evidenceKind: 'proxy',
      workspaceId: 'workspace-1',
      isProcessing: true,
      disabled: false,
      streamActivityPhase: 'ingress',
      textLength: 'secret prompt text must not be sent to diagnostics'.length,
    });
    expect(JSON.stringify(payload)).not.toContain('secret prompt text');
  });

  it("forwards submitted content snapshot to parent send handler", async () => {
    const onSend = vi.fn();
    renderAdapter({ onSend });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      onSubmit?: (content: string) => void;
    };
    expect(typeof latest.onSubmit).toBe("function");

    act(() => {
      latest.onSubmit?.("fresh child snapshot");
    });

    expect(onSend).toHaveBeenCalledWith("fresh child snapshot", undefined);
  });

  it("converts submitted attachments into image inputs for parent send handler", async () => {
    const onSend = vi.fn();
    renderAdapter({ onSend });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      onSubmit?: (
        content: string,
        attachments?: Array<{
          id: string;
          fileName: string;
          mediaType: string;
          data: string;
        }>,
      ) => void;
    };

    act(() => {
      latest.onSubmit?.("fresh child snapshot", [
        {
          id: "att-1",
          fileName: "image.png",
          mediaType: "image/png",
          data: "ZmFrZS1pbWFnZQ==",
        },
      ]);
    });

    expect(onSend).toHaveBeenCalledWith(
      "fresh child snapshot",
      ["data:image/png;base64,ZmFrZS1pbWFnZQ=="],
    );
  });

  it("keeps streaming IME draft and submit payload on the immediate child snapshot path", async () => {
    const onSend = vi.fn();
    const finalizedImeDraft = composerInputFixture100ime
      .filter((step) => step.kind === "input")
      .map((step) => step.value)
      .join("");
    const stableProps: ComponentProps<typeof ChatInputBoxAdapter> = {
      text: "",
      isProcessing: true,
      streamActivityPhase: "waiting",
      canStop: true,
      selectedModelId: "codex-gpt-5",
      onSend,
      onStop: () => {},
      onTextChange: () => {},
      selectedEngine: "codex",
      contextUsage: { used: 512, total: 8192 },
      accountRateLimits: {
        primary: {
          usedPercent: 12,
          windowDurationMins: 5,
          resetsAt: 123456789,
        },
        secondary: null,
        credits: {
          hasCredits: true,
          unlimited: false,
          balance: "42",
        },
        planType: "pro",
      },
      attachments: ["file:///tmp/immediate-before.png"],
      queuedMessages: [
        {
          id: "queued-1",
          text: "advisory queue",
          createdAt: 123,
        },
      ],
    };

    const view = render(<ChatInputBoxAdapter {...stableProps} />);
    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    view.rerender(
      <ChatInputBoxAdapter
        {...stableProps}
        streamActivityPhase="ingress"
        contextUsage={{ used: 512, total: 8192 }}
        accountRateLimits={{
          primary: {
            usedPercent: 12,
            windowDurationMins: 5,
            resetsAt: 123456789,
          },
          secondary: null,
          credits: {
            hasCredits: true,
            unlimited: false,
            balance: "42",
          },
          planType: "pro",
        }}
        attachments={["file:///tmp/immediate-after.png"]}
        queuedMessages={[
          {
            id: "queued-1",
            text: "advisory queue",
            createdAt: 123,
          },
        ]}
      />,
    );

    const latest = mockState.latestProps as {
      onSubmit?: (
        content: string,
        attachments?: Array<{
          id: string;
          fileName: string;
          mediaType: string;
          data: string;
        }>,
      ) => void;
    };

    act(() => {
      latest.onSubmit?.(finalizedImeDraft, [
        {
          id: "att-ime",
          fileName: "ime.png",
          mediaType: "image/png",
          data: "ZmFrZS1pbWU=",
        },
      ]);
    });

    expect(finalizedImeDraft).toContain("ime baseline");
    expect(onSend).toHaveBeenCalledWith(finalizedImeDraft, [
      "data:image/png;base64,ZmFrZS1pbWU=",
    ]);
  });

  it("falls back to external attachments when submit callback omits attachments", async () => {
    const onSend = vi.fn();
    renderAdapter({
      onSend,
      attachments: ["file:///tmp/fallback-image.png"],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      onSubmit?: (content: string) => void;
    };

    act(() => {
      latest.onSubmit?.("fresh child snapshot");
    });

    expect(onSend).toHaveBeenCalledWith("fresh child snapshot", [
      "file:///tmp/fallback-image.png",
    ]);
  });

  it("keeps file URI attachments unchanged for claude sends", async () => {
    const onSend = vi.fn();
    renderAdapter({ onSend });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      onSubmit?: (
        content: string,
        attachments?: Array<{
          id: string;
          fileName: string;
          mediaType: string;
          data: string;
        }>,
      ) => void;
    };

    act(() => {
      latest.onSubmit?.("fresh child snapshot", [
        {
          id: "att-2",
          fileName: "image.png",
          mediaType: "image/png",
          data: "file:///tmp/a%20b.png",
        },
      ]);
    });

    expect(onSend).toHaveBeenCalledWith("fresh child snapshot", ["file:///tmp/a%20b.png"]);
  });

  it("normalizes file URI attachments into host paths for gemini sends", async () => {
    const onSend = vi.fn();
    renderAdapter({ onSend, selectedEngine: "gemini" });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      onSubmit?: (
        content: string,
        attachments?: Array<{
          id: string;
          fileName: string;
          mediaType: string;
          data: string;
        }>,
      ) => void;
    };

    act(() => {
      latest.onSubmit?.("fresh child snapshot", [
        {
          id: "att-2b",
          fileName: "image.png",
          mediaType: "image/png",
          data: "file:///tmp/a%20b.png",
        },
      ]);
    });

    expect(onSend).toHaveBeenCalledWith("fresh child snapshot", ["/tmp/a b.png"]);
  });

  it("keeps miswrapped data URL payload containing file URI for claude sends", async () => {
    const onSend = vi.fn();
    renderAdapter({ onSend });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      onSubmit?: (
        content: string,
        attachments?: Array<{
          id: string;
          fileName: string;
          mediaType: string;
          data: string;
        }>,
      ) => void;
    };

    act(() => {
      latest.onSubmit?.("fresh child snapshot", [
        {
          id: "att-3",
          fileName: "image.png",
          mediaType: "image/png",
          data: "data:image/png;base64,file:///tmp/c%20d.png",
        },
      ]);
    });

    expect(onSend).toHaveBeenCalledWith("fresh child snapshot", [
      "data:image/png;base64,file:///tmp/c%20d.png",
    ]);
  });

  it("keeps localhost file URI attachments unchanged for claude sends", async () => {
    const onSend = vi.fn();
    renderAdapter({ onSend });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      onSubmit?: (
        content: string,
        attachments?: Array<{
          id: string;
          fileName: string;
          mediaType: string;
          data: string;
        }>,
      ) => void;
    };

    act(() => {
      latest.onSubmit?.("fresh child snapshot", [
        {
          id: "att-4",
          fileName: "image.png",
          mediaType: "image/png",
          data: "file://localhost/tmp/e%20f.png",
        },
      ]);
    });

    expect(onSend).toHaveBeenCalledWith("fresh child snapshot", ["file://localhost/tmp/e%20f.png"]);
  });

  it("keeps UNC-like file URI host attachments unchanged for claude sends", async () => {
    const onSend = vi.fn();
    renderAdapter({ onSend });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      onSubmit?: (
        content: string,
        attachments?: Array<{
          id: string;
          fileName: string;
          mediaType: string;
          data: string;
        }>,
      ) => void;
    };

    act(() => {
      latest.onSubmit?.("fresh child snapshot", [
        {
          id: "att-5",
          fileName: "image.png",
          mediaType: "image/png",
          data: "file://server/share/folder/a%20b.png",
        },
      ]);
    });

    expect(onSend).toHaveBeenCalledWith("fresh child snapshot", [
      "file://server/share/folder/a%20b.png",
    ]);
  });

  it("extracts a Windows basename when adapting external attachment paths", async () => {
    renderAdapter({
      attachments: ["C:\\Users\\demo\\Desktop\\Bug Shot.PNG"],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      attachments?: Array<{
        fileName: string;
        mediaType: string;
        data: string;
      }>;
    };

    expect(latest.attachments).toEqual([
      expect.objectContaining({
        fileName: "Bug Shot.PNG",
        mediaType: "image/png",
        data: "C:\\Users\\demo\\Desktop\\Bug Shot.PNG",
      }),
    ]);
  });

  it('keeps Codex dual usage presentation out of the ChatInputBox adapter path', async () => {
    renderAdapter({
      contextUsage: { used: 120_000, total: 256_000 },
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      usageUsedTokens?: number;
      usageMaxTokens?: number;
    };

    expect(latest).not.toHaveProperty('contextDualViewEnabled');
    expect(latest).not.toHaveProperty('dualContextUsage');
    expect(latest.usageUsedTokens).toBe(120_000);
    expect(latest.usageMaxTokens).toBe(256_000);
  });

  it('maps queued messages to preview content while preserving full text metadata', async () => {
    const longMessage = '队列消息'.repeat(60);
    renderAdapter({
      queuedMessages: [
        {
          id: 'queue-1',
          text: longMessage,
          createdAt: 1_700_000_000_000,
        },
      ],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      messageQueue?: Array<{
        id: string;
        content: string;
        fullContent?: string;
        queuedAt: number;
      }>;
    };

    const mapped = latest.messageQueue?.[0];
    expect(mapped?.id).toBe('queue-1');
    expect(mapped?.queuedAt).toBe(1_700_000_000_000);
    expect(mapped?.content).toBe(longMessage);
    expect(mapped?.fullContent).toBe(longMessage);
  });

  it('bridges @@ manual memory provider and selection callback', async () => {
    const onManualMemorySelect = vi.fn();
    mockState.projectMemoryList.mockResolvedValue({
      items: [
        {
          id: 'm-1',
          title: '发布步骤',
          summary: '先构建再发布',
          detail: '用户输入：发布\n助手输出摘要：先构建再发布',
          cleanText: '发布 clean text',
          kind: 'conversation',
          importance: 'high',
          tags: ['release'],
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_100,
        },
      ],
      total: 1,
    });

    renderAdapter({
      workspaceId: 'ws-1',
      onManualMemorySelect,
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      manualMemoryCompletionProvider?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<
        Array<{
          id: string;
          title: string;
          summary: string;
          detail: string;
          kind: string;
          importance: string;
          tags: string[];
          updatedAt: number;
        }>
      >;
      onSelectManualMemory?: (memory: {
        id: string;
        title: string;
      }) => void;
    };

    expect(typeof latest.manualMemoryCompletionProvider).toBe('function');
    const signal = new AbortController().signal;
    const results = await latest.manualMemoryCompletionProvider?.('发布', signal);
    expect(mockState.projectMemoryList).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        query: '发布',
      }),
    );
    expect(results?.[0]).toEqual(
      expect.objectContaining({
        id: 'm-1',
        title: '发布步骤',
        summary: '先构建再发布',
        kind: 'conversation',
        importance: 'high',
      }),
    );

    latest.onSelectManualMemory?.({
      id: 'm-1',
      title: '发布步骤',
    });
    expect(onManualMemorySelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'm-1',
        title: '发布步骤',
      }),
    );
  });

  it('bridges @# note card provider and selection callback', async () => {
    const onNoteCardSelect = vi.fn();
    mockState.noteCardList
      .mockResolvedValueOnce({
        items: [
          {
            id: 'note-active-1',
            title: '发布检查清单',
            plainTextExcerpt: '确认构建、回归和发布顺序',
            bodyMarkdown: '## 发布检查清单\n确认构建、回归和发布顺序',
            updatedAt: 1_700_000_000_200,
            createdAt: 1_700_000_000_100,
            archived: false,
            imageCount: 1,
            previewAttachments: [
              {
                id: 'attachment-1',
                fileName: 'deploy.png',
                contentType: 'image/png',
                absolutePath: '/tmp/demo/deploy.png',
              },
            ],
          },
        ],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'note-archive-1',
            title: '旧回滚手册',
            plainTextExcerpt: '归档版本的回滚说明',
            updatedAt: 1_700_000_000_050,
            createdAt: 1_700_000_000_010,
            archived: true,
            imageCount: 0,
          },
        ],
        total: 1,
      });

    renderAdapter({
      workspaceId: 'ws-1',
      workspaceName: 'demo-workspace',
      workspacePath: '/tmp/demo-workspace',
      onNoteCardSelect,
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      noteCardCompletionProvider?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<
        Array<{
          id: string;
          title: string;
          plainTextExcerpt: string;
          bodyMarkdown: string;
          archived: boolean;
          imageCount: number;
          previewAttachments: Array<{
            id: string;
            fileName: string;
            contentType: string;
            absolutePath: string;
          }>;
        }>
      >;
      onSelectNoteCard?: (noteCard: {
        id: string;
        title: string;
        plainTextExcerpt: string;
        bodyMarkdown: string;
        updatedAt: number;
        archived: boolean;
        imageCount: number;
        previewAttachments: Array<{
          id: string;
          fileName: string;
          contentType: string;
          absolutePath: string;
        }>;
      }) => void;
    };

    expect(typeof latest.noteCardCompletionProvider).toBe('function');
    const signal = new AbortController().signal;
    const results = await latest.noteCardCompletionProvider?.('发布', signal);
    expect(mockState.noteCardList).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        workspaceId: 'ws-1',
        workspaceName: 'demo-workspace',
        workspacePath: '/tmp/demo-workspace',
        archived: false,
        query: '发布',
      }),
    );
    expect(mockState.noteCardList).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        workspaceId: 'ws-1',
        archived: true,
        query: '发布',
      }),
    );
    expect(results?.map((item) => item.id)).toEqual([
      'note-active-1',
      'note-archive-1',
    ]);
    expect(results?.[0]?.bodyMarkdown).toBe('## 发布检查清单\n确认构建、回归和发布顺序');
    expect(results?.[1]?.bodyMarkdown).toBe('归档版本的回滚说明');
    expect(results?.[0]?.previewAttachments).toEqual([
      {
        id: 'attachment-1',
        fileName: 'deploy.png',
        contentType: 'image/png',
        absolutePath: '/tmp/demo/deploy.png',
      },
    ]);

    latest.onSelectNoteCard?.({
      id: 'note-active-1',
      title: '发布检查清单',
      plainTextExcerpt: '确认构建、回归和发布顺序',
      bodyMarkdown: '确认构建、回归和发布顺序',
      updatedAt: 1_700_000_000_200,
      archived: false,
      imageCount: 1,
      previewAttachments: [
        {
          id: 'attachment-1',
          fileName: 'deploy.png',
          contentType: 'image/png',
          absolutePath: '/tmp/demo/deploy.png',
        },
      ],
    });
    expect(onNoteCardSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'note-active-1',
        title: '发布检查清单',
      }),
    );
  });

  it('bridges prompt completion data and settings opener', async () => {
    const onOpenPromptSettings = vi.fn();
    renderAdapter({
      prompts: [
        {
          path: '/tmp/workspace/.ccgui/prompts/review.md',
          name: 'review',
          content: '请审查这段代码',
          description: '代码评审',
          argumentHint: undefined,
          scope: 'workspace',
        },
      ],
      onOpenPromptSettings,
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      promptCompletionProvider?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<
        Array<{
          id: string;
          name: string;
          content: string;
          description?: string;
        }>
      >;
      onOpenPromptSettings?: () => void;
    };

    expect(typeof latest.promptCompletionProvider).toBe('function');
    expect(latest.onOpenPromptSettings).toBe(onOpenPromptSettings);

    const results = await latest.promptCompletionProvider?.('rev', new AbortController().signal);
    expect(results).toEqual([
      expect.objectContaining({
        name: 'review',
        content: '请审查这段代码',
        description: '代码评审',
        usageCount: 0,
        heatLevel: 0,
      }),
      expect.objectContaining({
        id: '__create_new__',
      }),
    ]);
    // 非空内存不触发 revalidate
    expect(mockState.requestCustomPromptsRefresh).not.toHaveBeenCalled();
  });

  it('revalidates prompts on bang empty state and uses refreshed list', async () => {
    mockState.requestCustomPromptsRefresh.mockResolvedValue([
      {
        path: '/tmp/workspace/.ccgui/prompts/review.md',
        name: 'review',
        content: '请审查这段代码',
        description: '代码评审',
        argumentHint: undefined,
        scope: 'workspace',
      },
    ]);

    renderAdapter({
      prompts: [],
      workspaceId: 'ws-1',
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      promptCompletionProvider?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<Array<{ name: string; id: string }>>;
    };

    const results = await latest.promptCompletionProvider?.('', new AbortController().signal);

    expect(mockState.requestCustomPromptsRefresh).toHaveBeenCalledWith(
      'ws-1',
      'on-demand',
      { skipIfAuthoritative: true },
    );
    expect(results).toEqual([
      expect.objectContaining({ name: 'review' }),
      expect.objectContaining({ id: '__create_new__' }),
    ]);
  });

  it('passes fork quick handler to ChatInputBox', async () => {
    const onForkQuickStart = vi.fn();

    renderAdapter({ onForkQuickStart });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());
    expect(mockState.latestProps?.onForkQuickStart).toBe(onForkQuickStart);
  });

  it('sorts prompt completion by usage heat', async () => {
    recordPromptUsage('/tmp/workspace/.ccgui/prompts/review.md');
    recordPromptUsage('/tmp/workspace/.ccgui/prompts/review.md');
    recordPromptUsage('/tmp/workspace/.ccgui/prompts/review.md');
    recordPromptUsage('/tmp/workspace/.ccgui/prompts/fix.md');

    renderAdapter({
      prompts: [
        {
          path: '/tmp/workspace/.ccgui/prompts/fix.md',
          name: 'fix',
          content: '帮我修复问题',
          description: '修复',
          argumentHint: undefined,
          scope: 'workspace',
        },
        {
          path: '/tmp/workspace/.ccgui/prompts/review.md',
          name: 'review',
          content: '请审查这段代码',
          description: '代码评审',
          argumentHint: undefined,
          scope: 'workspace',
        },
      ],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      promptCompletionProvider?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<
        Array<{
          id: string;
          name: string;
          usageCount?: number;
          heatLevel?: number;
        }>
      >;
    };

    const results = await latest.promptCompletionProvider?.('', new AbortController().signal);
    expect(results?.[0]).toEqual(
      expect.objectContaining({
        name: 'review',
        usageCount: 3,
        heatLevel: 1,
      }),
    );
    expect(results?.[1]).toEqual(
      expect.objectContaining({
        name: 'fix',
        usageCount: 1,
        heatLevel: 1,
      }),
    );
  });

  it('matches prompt completion query against argument hint and scope metadata', async () => {
    renderAdapter({
      prompts: [
        {
          path: '/tmp/workspace/.ccgui/prompts/deploy.md',
          name: 'deploy',
          content: '帮我生成部署步骤',
          description: '部署流程',
          argumentHint: 'ticket, env',
          scope: 'global',
        },
      ],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      promptCompletionProvider?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<Array<{ name: string }>>;
    };

    const byHint = await latest.promptCompletionProvider?.('ticket', new AbortController().signal);
    expect(byHint?.[0]).toEqual(expect.objectContaining({ name: 'deploy' }));

    const byScope = await latest.promptCompletionProvider?.('global', new AbortController().signal);
    expect(byScope?.[0]).toEqual(expect.objectContaining({ name: 'deploy' }));
  });

  it('uses current engine model fallback when selected model is empty', async () => {
    renderAdapter({
      selectedEngine: 'gemini',
      selectedModelId: null,
      models: [
        {
          id: 'gemini-2.5-pro',
          displayName: 'Gemini 2.5 Pro',
          model: 'gemini-2.5-pro',
        },
        {
          id: 'gemini-2.5-flash',
          displayName: 'Gemini 2.5 Flash',
          model: 'gemini-2.5-flash',
        },
      ],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      selectedModel?: string;
      models?: Array<{ id: string; model?: string; label: string; description?: string; source?: string }>;
    };

    expect(latest.selectedModel).toBe('gemini-2.5-pro');
    expect(latest.models).toEqual([
      {
        id: 'gemini-2.5-pro',
        model: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        description: 'gemini-2.5-pro',
        source: undefined,
      },
      {
        id: 'gemini-2.5-flash',
        model: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        description: 'gemini-2.5-flash',
        source: undefined,
      },
    ]);
  });

  it('does not fallback to claude model when gemini has no models yet', async () => {
    renderAdapter({
      selectedEngine: 'gemini',
      selectedModelId: null,
      models: [],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      selectedModel?: string;
    };

    expect(latest.selectedModel).toBe('');
  });

  it('does not fallback to the first Codex model before persisted selection is ready', async () => {
    renderAdapter({
      selectedEngine: 'codex',
      selectedModelId: null,
      models: [
        {
          id: 'gpt-5.5',
          displayName: 'gpt-5.5',
          model: 'gpt-5.5',
        },
        {
          id: 'custom-model',
          displayName: 'Custom Model',
          model: 'custom-model',
        },
      ],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      selectedModel?: string;
    };

    expect(latest.selectedModel).toBe('');
  });

  it('does not synthesize a claude model when claude has no models yet', async () => {
    renderAdapter({
      selectedEngine: 'claude',
      selectedModelId: null,
      models: [],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      selectedModel?: string;
    };

    expect(latest.selectedModel).toBe('');
  });

  it('enables the five supported provider options inside shared sessions', async () => {
    renderAdapter({
      isSharedSession: true,
      engines: [
        { type: 'claude', installed: true, version: '1.0.0' },
        { type: 'codex', installed: true, version: '1.0.0' },
        { type: 'gemini', installed: true, version: '1.0.0' },
        { type: 'opencode', installed: true, version: '1.0.0' },
        { type: 'kimi', installed: true, version: '1.0.0' },
        { type: 'grok', installed: true, version: '1.0.0' },
      ],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      providerAvailability?: Record<string, boolean>;
    };

    expect(latest.providerAvailability).toMatchObject({
      claude: true,
      codex: true,
      gemini: false,
      opencode: true,
      kimi: true,
      grok: true,
    });
  });

  it('keeps gemini and opencode provider options enabled outside shared sessions', async () => {
    renderAdapter({
      isSharedSession: false,
      engines: [
        { type: 'claude', installed: true, version: '1.0.0' },
        { type: 'codex', installed: true, version: '1.0.0' },
        { type: 'gemini', installed: true, version: '1.0.0' },
        { type: 'opencode', installed: true, version: '1.0.0' },
      ],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      providerAvailability?: Record<string, boolean>;
    };

    expect(latest.providerAvailability).toMatchObject({
      claude: true,
      codex: true,
      gemini: true,
      opencode: true,
    });
  });

  it('does not expose legacy engine/model callbacks inside shared sessions', async () => {
    renderAdapter({
      isSharedSession: true,
      onExecutionTargetChange: vi.fn(),
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      onProviderSelect?: (providerId: string) => void;
      onModelSelect?: (modelId: string) => void;
      providerTargetPickerMode?: string;
    };
    expect(latest.onProviderSelect).toBeUndefined();
    expect(latest.onModelSelect).toBeUndefined();
    expect(latest.providerTargetPickerMode).toBe('shared');
  });

  it('uses the atomic double-column picker without shared session semantics on Home', async () => {
    renderAdapter({
      isSharedSession: false,
      providerTargetPickerMode: 'create-session',
      onExecutionTargetChange: vi.fn(),
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      providerTargetPickerMode?: string;
      onProviderSelect?: (providerId: string) => void;
      onModelSelect?: (modelId: string) => void;
      onExecutionTargetChange?: (target: unknown) => void;
    };
    expect(latest.providerTargetPickerMode).toBe('create-session');
    expect(latest.onProviderSelect).toBeUndefined();
    expect(latest.onModelSelect).toBeUndefined();
    expect(latest.onExecutionTargetChange).toEqual(expect.any(Function));
  });

  it('defaults conversation sessions to the home-style atomic create-session picker', async () => {
    renderAdapter({
      isSharedSession: false,
      onExecutionTargetChange: vi.fn(),
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      providerTargetPickerMode?: string;
      onProviderSelect?: (providerId: string) => void;
      onModelSelect?: (modelId: string) => void;
    };
    expect(latest.providerTargetPickerMode).toBe('create-session');
    expect(latest.onProviderSelect).toBeUndefined();
    expect(latest.onModelSelect).toBeUndefined();
  });

  it('reports kimi as the current provider when the kimi engine is selected', async () => {
    renderAdapter({ selectedEngine: 'kimi' });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as { currentProvider?: string };

    expect(latest.currentProvider).toBe('kimi');
  });
});
