import { describe, expect, it } from 'vitest';
import { ProviderError } from '../src/providers/provider-errors';
import {
  MODEL_CATALOG_VERSION,
  curatedModels,
  findModelChoiceForConfig,
  getDefaultModel,
  getDefaultModelChoice,
  getModelChoice,
  getModelsForProvider,
  modelChoices,
  resolveModelChoice,
} from '../src/providers/model-catalog';
import { providerRegistry } from '../src/providers/provider-registry';

describe('provider registry and curated catalog', () => {
  it('registers exactly the three working Community adapters', () => {
    expect(providerRegistry.kinds()).toEqual(['openrouter', 'openai', 'gemini']);
    expect(providerRegistry.get('openrouter').kind).toBe('openrouter');
    expect(providerRegistry.get('openai').kind).toBe('openai');
    expect(providerRegistry.get('gemini').kind).toBe('gemini');
    expect(() => providerRegistry.get('future' as any)).toThrowError(ProviderError);
  });

  it('publishes the approved multimodal catalog with full model IDs and no preview model', () => {
    expect(MODEL_CATALOG_VERSION).toBe('community-models-2');
    expect(curatedModels).toEqual([
      {
        provider: 'openrouter',
        id: 'openai/gpt-5.6-terra',
        label: 'openai/gpt-5.6-terra',
        default: true,
      },
      {
        provider: 'openrouter',
        id: 'openai/gpt-5.6-sol',
        label: 'openai/gpt-5.6-sol',
        default: false,
      },
      {
        provider: 'openrouter',
        id: 'openai/gpt-5.6-luna',
        label: 'openai/gpt-5.6-luna',
        default: false,
      },
      {
        provider: 'openrouter',
        id: 'google/gemini-3.7-flash',
        label: 'google/gemini-3.7-flash',
        default: false,
      },
      {
        provider: 'openrouter',
        id: 'anthropic/claude-sonnet-5',
        label: 'anthropic/claude-sonnet-5',
        default: false,
      },
      {
        provider: 'openrouter',
        id: 'anthropic/claude-opus-5',
        label: 'anthropic/claude-opus-5',
        default: false,
      },
      {
        provider: 'openrouter',
        id: 'anthropic/claude-haiku-4.5',
        label: 'anthropic/claude-haiku-4.5',
        default: false,
      },
      {
        provider: 'openrouter',
        id: 'qwen/qwen3.7-plus',
        label: 'qwen/qwen3.7-plus',
        default: false,
      },
      {
        provider: 'openrouter',
        id: 'qwen/qwen3-vl-235b-a22b-instruct',
        label: 'qwen/qwen3-vl-235b-a22b-instruct',
        default: false,
      },
      {
        provider: 'openrouter',
        id: 'qwen/qwen3-vl-8b-instruct',
        label: 'qwen/qwen3-vl-8b-instruct',
        default: false,
      },
      {
        provider: 'openai',
        id: 'gpt-5.6-terra',
        label: 'gpt-5.6-terra',
        default: true,
      },
      {
        provider: 'openai',
        id: 'gpt-5.6-sol',
        label: 'gpt-5.6-sol',
        default: false,
      },
      {
        provider: 'openai',
        id: 'gpt-5.6-luna',
        label: 'gpt-5.6-luna',
        default: false,
      },
      {
        provider: 'gemini',
        id: 'gemini-3.7-flash',
        label: 'gemini-3.7-flash',
        default: true,
      },
    ]);
    expect(getModelsForProvider('openrouter')).toEqual(curatedModels.slice(0, 10));
    expect(getModelsForProvider('openai')).toEqual(curatedModels.slice(10, 13));
    expect(getModelsForProvider('gemini')).toEqual(curatedModels.slice(13, 14));
    expect(getDefaultModel('openrouter')?.id).toBe('openai/gpt-5.6-terra');
    expect(getDefaultModel('openai')?.id).toBe('gpt-5.6-terra');
    expect(getDefaultModel('gemini')?.id).toBe('gemini-3.7-flash');
    expect(curatedModels.some(({ id }) => id === 'gemini-3.1-pro-preview')).toBe(false);
  });

  it('publishes one model-first catalog and resolves OpenRouter or direct transport details', () => {
    expect(getDefaultModelChoice().key).toBe('openai/gpt-5.6-terra');
    expect(modelChoices.map(({ vendor }) => vendor)).toEqual([
      'openai', 'openai', 'openai',
      'google',
      'anthropic', 'anthropic', 'anthropic',
      'qwen', 'qwen', 'qwen',
    ]);
    expect(modelChoices.every(({ description }) => description.en !== '' && description['zh-CN'] !== '')).toBe(true);
    expect(modelChoices.some(({ openRouterModel }) => openRouterModel === 'gemini-3.1-pro-preview')).toBe(false);

    const terra = getModelChoice('openai/gpt-5.6-terra');
    const gemini = getModelChoice('google/gemini-3.7-flash');
    const claude = getModelChoice('anthropic/claude-sonnet-5');
    expect(terra).toBeTruthy();
    expect(gemini).toBeTruthy();
    expect(claude).toBeTruthy();
    expect(resolveModelChoice(terra!, true)).toEqual({
      provider: 'openrouter', model: 'openai/gpt-5.6-terra', customModel: false,
    });
    expect(resolveModelChoice(terra!, false)).toEqual({
      provider: 'openai', model: 'gpt-5.6-terra', customModel: false,
    });
    expect(resolveModelChoice(gemini!, false)).toEqual({
      provider: 'gemini', model: 'gemini-3.7-flash', customModel: false,
    });
    expect(resolveModelChoice(claude!, false)).toEqual({
      provider: 'openrouter', model: 'anthropic/claude-sonnet-5', customModel: false,
    });
    expect(findModelChoiceForConfig({
      provider: 'openai', apiKey: 'key', model: 'gpt-5.6-terra', customModel: false,
    })?.key).toBe(terra!.key);
    expect(findModelChoiceForConfig({
      provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false,
    })?.key).toBe(gemini!.key);
  });

  it.each([
    ['openrouter', 'openai/gpt-5.6-terra'],
    ['openai', 'gpt-5.6-terra'],
    ['gemini', 'gemini-3.7-flash'],
  ] as const)('validates curated and custom %s models only for the selected provider', (kind, curatedModel) => {
    const provider = providerRegistry.get(kind);
    expect(provider.validateConfig({
      provider: kind, apiKey: ' key ', model: ` ${curatedModel} `, customModel: false,
    })).toEqual({ ok: true });
    expect(provider.validateConfig({
      provider: kind, apiKey: ' key ', model: ' custom/vision-model ', customModel: true,
    })).toEqual({ ok: true });
    expect(provider.validateConfig({
      provider: kind === 'gemini' ? 'openai' : 'gemini', apiKey: 'key', model: curatedModel, customModel: false,
    })).toEqual({ ok: false, field: 'model', code: 'invalid_config' });
    expect(provider.validateConfig({
      provider: kind, apiKey: 'key', model: 'unlisted/model', customModel: false,
    })).toEqual({ ok: false, field: 'model', code: 'invalid_config' });
    expect(provider.validateConfig({
      provider: kind, apiKey: ' ', model: curatedModel, customModel: false,
    })).toEqual({ ok: false, field: 'apiKey', code: 'invalid_config' });
    expect(provider.validateConfig({
      provider: kind, apiKey: 'key', model: ' ', customModel: true,
    })).toEqual({ ok: false, field: 'model', code: 'invalid_config' });
    expect(provider.validateConfig({
      provider: kind, apiKey: 'key', model: curatedModel, customModel: false, origin: 'https://evil.test',
    } as any)).toEqual({ ok: false, field: 'model', code: 'invalid_config' });
  });
});
