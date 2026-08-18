// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../../types/provider';
import {
  readModelStorageSnapshot,
  resolveAvailableModels,
  resolveProviderModelGroups,
} from './modelOptions';

const serializeModels = (models: Array<{ id: string; model?: string; label?: string; source?: string }>) =>
  models.map((model) => `${model.id}:${model.model ?? ''}:${model.source ?? ''}:${model.label ?? model.id}`).join(',');

const CODEX_FALLBACK_MODEL_IDS = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
];

describe('ChatInputBox model options', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('reads same-tab custom model updates from storage snapshots', () => {
    expect(serializeModels(resolveAvailableModels({
      currentProvider: 'claude',
      models: [],
      selectedModel: '',
      modelStorageSnapshot: readModelStorageSnapshot(),
    }))).not.toContain('claude-custom-alpha');

    window.localStorage.setItem(
      STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
      JSON.stringify([{ id: 'claude-custom-alpha', label: 'Claude Custom Alpha' }]),
    );

    expect(serializeModels(resolveAvailableModels({
      currentProvider: 'claude',
      models: [],
      selectedModel: '',
      modelStorageSnapshot: readModelStorageSnapshot(),
    }))).toContain('claude-custom-alpha');
  });

  it('preserves Codex managed provider origin when custom models override hydrated catalog rows', () => {
    window.localStorage.setItem(
      STORAGE_KEYS.CODEX_CUSTOM_MODELS,
      JSON.stringify([
        {
          id: 'minimax-m3',
          label: 'MiniMax M3',
          providerProfileId: 'provider-minimax',
        },
      ]),
    );

    const models = resolveAvailableModels({
      currentProvider: 'codex',
      models: [{ id: 'minimax-m3', label: 'Runtime MiniMax M3' }],
      selectedModel: '',
      modelStorageSnapshot: readModelStorageSnapshot(),
    });

    expect(models.filter((model) => model.id === 'minimax-m3')).toHaveLength(1);
    expect(models.find((model) => model.id === 'minimax-m3')).toEqual(
      expect.objectContaining({
        label: 'MiniMax M3',
        providerProfileId: 'provider-minimax',
      }),
    );
  });

  it('keeps public and matching Codex models while excluding other provider origins', () => {
    window.localStorage.setItem(
      STORAGE_KEYS.CODEX_CUSTOM_MODELS,
      JSON.stringify([
        { id: 'public-model', label: 'Public Model' },
        {
          id: 'provider-a-model',
          label: 'Provider A Model',
          providerProfileId: 'provider-a',
        },
        {
          id: 'provider-b-model',
          label: 'Provider B Model',
          providerProfileId: 'provider-b',
        },
      ]),
    );

    const models = resolveAvailableModels({
      currentProvider: 'codex',
      currentProviderProfileId: 'provider-a',
      models: [
        {
          id: 'provider-a-model',
          label: 'Runtime Provider A',
          providerProfileId: 'provider-a',
        },
        { id: 'gpt-public', label: 'GPT Public' },
      ],
      selectedModel: '',
      modelStorageSnapshot: readModelStorageSnapshot(),
    });

    expect(models.map((model) => model.id)).toEqual([
      'provider-a-model',
      'gpt-public',
      'public-model',
      ...CODEX_FALLBACK_MODEL_IDS,
    ]);
    expect(models[0]).toEqual(
      expect.objectContaining({
        label: 'Provider A Model',
        providerProfileId: 'provider-a',
      }),
    );
    expect(models.some((model) => model.id === 'provider-b-model')).toBe(false);
  });

  it('preserves user-entered Claude custom model ids without regex filtering', () => {
    window.localStorage.setItem(
      STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
      JSON.stringify([
        { id: 'Haiku 4.5', label: 'Haiku 4.5' },
        { id: 'bad model with spaces', label: 'Bad' },
        { id: '\u6a21\u578b 666', label: '\u6a21\u578b 666' },
        { id: 'Cxn[1m]', label: 'Cxn[1m]' },
        { id: '   ', label: 'Blank' },
        { label: 'Missing id' },
      ]),
    );

    const modelList = serializeModels(resolveAvailableModels({
      currentProvider: 'claude',
      models: [],
      selectedModel: '',
      modelStorageSnapshot: readModelStorageSnapshot(),
    }));

    expect(modelList).toContain('Haiku 4.5:Haiku 4.5:custom:Haiku 4.5');
    expect(modelList).toContain('bad model with spaces:bad model with spaces:custom:Bad');
    expect(modelList).toContain('\u6a21\u578b 666:\u6a21\u578b 666:custom:\u6a21\u578b 666');
    expect(modelList).toContain('Cxn[1m]:Cxn[1m]:custom:Cxn[1m]');
    expect(modelList).not.toContain('Blank');
    expect(modelList).not.toContain('Missing id');
  });

  it('does not render Claude alias fallback when config and custom models are empty', () => {
    const modelList = serializeModels(resolveAvailableModels({
      currentProvider: 'claude',
      models: [],
      selectedModel: 'sonnet',
      modelStorageSnapshot: readModelStorageSnapshot(),
    }));

    expect(modelList).not.toContain('sonnet:Sonnet');
    expect(modelList).not.toContain('opus:Opus');
    expect(modelList).not.toContain('haiku:Haiku');
    expect(modelList).not.toContain('claude-sonnet-4-6');
  });

  it('deduplicates a partial Codex runtime catalog and fills generated models', () => {
    window.localStorage.setItem(
      STORAGE_KEYS.CODEX_CUSTOM_MODELS,
      JSON.stringify([
        { id: 'user-custom-codex', label: 'User Custom Codex' },
        { id: 'demo', label: 'Demo Override' },
      ]),
    );

    const modelList = serializeModels(resolveAvailableModels({
      currentProvider: 'codex',
      models: [
        {
          id: 'gpt-5.5',
          model: 'gpt-5.5',
          label: 'gpt-5.5 (config)',
          source: 'settings-override',
        },
        {
          id: 'demo',
          model: 'demo',
          label: 'Demo',
          source: 'custom',
        },
        {
          id: 'gpt-5.6-luna',
          model: 'gpt-5.6-luna',
          label: 'gpt-5.6-luna',
          source: 'catalog',
        },
      ],
      selectedModel: 'gpt-5.5',
      modelStorageSnapshot: readModelStorageSnapshot(),
    }));
    const modelEntries = modelList.split(',').filter(Boolean);

    expect(modelList).toContain('gpt-5.5:gpt-5.5:settings-override:gpt-5.5 (config)');
    expect(modelList).toContain('demo:demo:custom:Demo Override');
    expect(modelList).toContain('gpt-5.6-luna:gpt-5.6-luna:catalog:gpt-5.6-luna');
    expect(modelList).toContain('user-custom-codex::custom:User Custom Codex');
    expect(modelEntries.filter((entry) => entry.startsWith('gpt-5.5:'))).toHaveLength(1);
    expect(modelEntries.filter((entry) => entry.startsWith('demo:'))).toHaveLength(1);
    expect(modelEntries.filter((entry) => entry.startsWith('user-custom-codex:'))).toHaveLength(1);
    expect(modelList).toContain('gpt-5.6-sol::fallback:gpt-5.6-sol');
    expect(modelList).toContain('gpt-5.6-terra::fallback:gpt-5.6-terra');
    expect(modelList).not.toContain('gpt-5.4::fallback:gpt-5.4');
    expect(modelList).not.toContain('gpt-5.4-mini::fallback:gpt-5.4-mini');
    expect(modelList).not.toContain(
      'gpt-5.3-codex-spark::fallback:gpt-5.3-codex-spark',
    );
  });

  it('falls back to built-in Codex models when the parent provides none', () => {
    const modelList = serializeModels(resolveAvailableModels({
      currentProvider: 'codex',
      models: [],
      selectedModel: '',
      modelStorageSnapshot: readModelStorageSnapshot(),
    }));
    const modelEntries = modelList.split(',').filter(Boolean);

    expect(modelList).toContain('gpt-5.6-sol::fallback:gpt-5.6-sol');
    expect(modelList).toContain('gpt-5.6-terra::fallback:gpt-5.6-terra');
    expect(modelList).toContain('gpt-5.6-luna::fallback:gpt-5.6-luna');
    expect(modelList).toContain('gpt-5.5::fallback:gpt-5.5');
    expect(modelList).not.toContain('gpt-5.4::fallback:gpt-5.4');
    expect(modelList).not.toContain('gpt-5.4-mini::fallback:gpt-5.4-mini');
    expect(
      modelEntries.some((entry) => entry.startsWith('gpt-5.3-codex')),
    ).toBe(false);
    expect(modelList).not.toContain('gpt-5.2');
  });

  it('keeps custom Codex model labels while deduplicating built-in matches', () => {
    window.localStorage.setItem(
      STORAGE_KEYS.CODEX_CUSTOM_MODELS,
      JSON.stringify([{ id: 'gpt-5.5', label: 'My GPT 5.5' }]),
    );

    const modelList = serializeModels(resolveAvailableModels({
      currentProvider: 'codex',
      models: [],
      selectedModel: '',
      modelStorageSnapshot: readModelStorageSnapshot(),
    }));

    expect(modelList).toContain('gpt-5.5::custom:My GPT 5.5');
    expect(modelList.match(/gpt-5\.5:/g)).toHaveLength(1);
    expect(modelList).toContain('gpt-5.6-sol::fallback:gpt-5.6-sol');
  });

  it('does not apply legacy Claude mapping to dynamic backend models', () => {
    window.localStorage.setItem(
      STORAGE_KEYS.CLAUDE_MODEL_MAPPING,
      JSON.stringify({ sonnet: 'MiniMax-M3[1m]', opus: 'MiniMax-M4[1m]' }),
    );

    const modelList = serializeModels(resolveAvailableModels({
      currentProvider: 'claude',
      models: [
        { id: 'settings-main', label: 'MiniMax-M1[1m]' },
        { id: 'claude-sonnet-4-6', label: 'Sonnet' },
      ],
      selectedModel: 'settings-main',
      modelStorageSnapshot: readModelStorageSnapshot(),
    }));

    expect(modelList).toContain('settings-main:::MiniMax-M1[1m]');
    expect(modelList).toContain('claude-sonnet-4-6:::Sonnet');
    expect(modelList).not.toContain('MiniMax-M3[1m]');
    expect(modelList).not.toContain('MiniMax-M4[1m]');
  });

  it('builds compact provider groups from current runtime models and provider fallbacks', () => {
    const groups = resolveProviderModelGroups({
      currentProvider: 'codex',
      models: [{ id: 'gpt-5.5', label: 'GPT-5.5 runtime' }],
      selectedModel: 'gpt-5.5',
      modelStorageSnapshot: readModelStorageSnapshot(),
      providerAvailability: { claude: true, codex: true, gemini: false, opencode: true },
      resolveProviderLabel: (_providerId, fallbackLabel) => fallbackLabel,
    });

    expect(groups.map((group) => group.providerId)).toEqual(['codex']);
    expect(groups[0]?.providerLabel).toBe('Codex');
    expect(
      groups.find((group) => group.providerId === 'codex')?.models.map((model) => model.id),
    ).toEqual([
      'gpt-5.5',
      ...CODEX_FALLBACK_MODEL_IDS.filter((id) => id !== 'gpt-5.5'),
    ]);
  });

  it('does not synthesize Claude provider group when settings and custom models are empty', () => {
    const groups = resolveProviderModelGroups({
      currentProvider: 'codex',
      models: [{ id: 'gpt-5.5', label: 'GPT-5.5 runtime' }],
      selectedModel: 'gpt-5.5',
      modelStorageSnapshot: readModelStorageSnapshot(),
      providerAvailability: { claude: true, codex: true, gemini: false, opencode: true },
      resolveProviderLabel: (_providerId, fallbackLabel) => fallbackLabel,
    });

    expect(groups.find((group) => group.providerId === 'claude')).toBeUndefined();
  });

  it('includes detected Gemini with fallback models when runtime models are unavailable', () => {
    const groups = resolveProviderModelGroups({
      currentProvider: 'codex',
      models: [{ id: 'gpt-5.5', label: 'GPT-5.5 runtime' }],
      selectedModel: 'gpt-5.5',
      modelStorageSnapshot: readModelStorageSnapshot(),
      providerAvailability: { claude: true, codex: true, gemini: true, opencode: true },
      resolveProviderLabel: (_providerId, fallbackLabel) => fallbackLabel,
    });

    const geminiGroup = groups.find((group) => group.providerId === 'gemini');

    expect(groups.map((group) => group.providerId)).toEqual(['codex', 'gemini']);
    expect(geminiGroup?.models.map((model) => model.id)).toEqual([
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ]);
  });

  it('builds non-active provider groups from provider-scoped catalogs', () => {
    window.localStorage.setItem(
      STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
      JSON.stringify([{ id: 'Claude Custom [1m]', label: 'Claude Custom [1m]' }]),
    );

    const groups = resolveProviderModelGroups({
      currentProvider: 'opencode',
      models: [],
      selectedModel: '',
      modelStorageSnapshot: readModelStorageSnapshot(),
      providerModelCatalogs: {
        claude: [{ id: 'claude-from-settings', label: 'Claude From Settings' }],
        codex: [{ id: 'codex-from-config', label: 'Codex From Config' }],
      },
      providerAvailability: { claude: true, codex: true, gemini: false, opencode: true },
      resolveProviderLabel: (_providerId, fallbackLabel) => fallbackLabel,
    });

    expect(groups.map((group) => group.providerId)).toEqual(['claude', 'codex']);
    expect(groups.find((group) => group.providerId === 'claude')?.models).toEqual([
      {
        id: 'Claude Custom [1m]',
        model: 'Claude Custom [1m]',
        label: 'Claude Custom [1m]',
        description: undefined,
        source: 'custom',
      },
      { id: 'claude-from-settings', label: 'Claude From Settings' },
    ]);
    expect(
      groups.find((group) => group.providerId === 'codex')?.models.map((model) => model.id),
    ).toEqual(['codex-from-config', ...CODEX_FALLBACK_MODEL_IDS]);
  });
});
