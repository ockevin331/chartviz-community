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
  it('does not publish deprecated Qwen models', () => {
    expect(MODEL_CATALOG_VERSION).toBe('community-models-4');
    expect(modelChoices.some(({ vendor, openRouterModel }) => vendor === ('qwen' as never) || /qwen/i.test(openRouterModel))).toBe(false);
    expect(curatedModels.some(({ id }) => /qwen/i.test(id))).toBe(false);
  });
  it('registers exactly the supported Community adapters', () => {
    expect(providerRegistry.kinds()).toEqual(['openrouter', 'openai']);
    expect(providerRegistry.get('openrouter').kind).toBe('openrouter');
    expect(providerRegistry.get('openai').kind).toBe('openai');
    expect(() => providerRegistry.get('gemini' as never)).toThrowError(ProviderError);
    expect(() => providerRegistry.get('future' as any)).toThrowError(ProviderError);
  });

  it('publishes the approved multimodal catalog without Google models', () => {
    expect(MODEL_CATALOG_VERSION).toBe('community-models-4');
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
    ]);
    expect(getModelsForProvider('openrouter')).toEqual(curatedModels.slice(0, 6));
    expect(getModelsForProvider('openai')).toEqual(curatedModels.slice(6, 9));
    expect(getDefaultModel('openrouter')?.id).toBe('openai/gpt-5.6-terra');
    expect(getDefaultModel('openai')?.id).toBe('gpt-5.6-terra');
    expect(curatedModels.some(({ id }) => /google|gemini/i.test(id))).toBe(false);
  });

  it('publishes one model-first catalog and resolves OpenRouter or direct transport details', () => {
    expect(getDefaultModelChoice().key).toBe('openai/gpt-5.6-terra');
    expect(modelChoices.map(({ vendor }) => vendor)).toEqual([
      'openai', 'openai', 'openai',
      'anthropic', 'anthropic', 'anthropic',
    ]);
    expect(modelChoices.every(({ description }) => description.en !== '' && description['zh-CN'] !== '')).toBe(true);
    expect(modelChoices.some(({ openRouterModel }) => /google|gemini/i.test(openRouterModel))).toBe(false);

    const terra = getModelChoice('openai/gpt-5.6-terra');
    const claude = getModelChoice('anthropic/claude-sonnet-5');
    expect(terra).toBeTruthy();
    expect(getModelChoice('google/gemini-3.7-flash')).toBeNull();
    expect(claude).toBeTruthy();
    expect(resolveModelChoice(terra!, true)).toEqual({
      provider: 'openrouter', model: 'openai/gpt-5.6-terra', customModel: false,
    });
    expect(resolveModelChoice(terra!, false)).toEqual({
      provider: 'openai', model: 'gpt-5.6-terra', customModel: false,
    });
    expect(resolveModelChoice(claude!, false)).toEqual({
      provider: 'openrouter', model: 'anthropic/claude-sonnet-5', customModel: false,
    });
    expect(findModelChoiceForConfig({
      provider: 'openai', apiKey: 'key', model: 'gpt-5.6-terra', customModel: false,
    })?.key).toBe(terra!.key);
    expect(findModelChoiceForConfig({
      provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false,
    })).toBeNull();
  });

  it.each([
    ['openrouter', 'openai/gpt-5.6-terra'],
    ['openai', 'gpt-5.6-terra'],
  ] as const)('validates only curated %s models for the selected provider', (kind, curatedModel) => {
    const provider = providerRegistry.get(kind);
    expect(provider.validateConfig({
      provider: kind, apiKey: ' key ', model: ` ${curatedModel} `, customModel: false,
    })).toEqual({ ok: true });
    expect(provider.validateConfig({
      provider: kind, apiKey: ' key ', model: ' custom/vision-model ', customModel: true,
    } as never)).toEqual({ ok: false, field: 'model', code: 'invalid_config' });
    expect(provider.validateConfig({
      provider: kind === 'openai' ? 'openrouter' : 'openai', apiKey: 'key', model: curatedModel, customModel: false,
    })).toEqual({ ok: false, field: 'model', code: 'invalid_config' });
    expect(provider.validateConfig({
      provider: kind, apiKey: 'key', model: 'unlisted/model', customModel: false,
    })).toEqual({ ok: false, field: 'model', code: 'invalid_config' });
    expect(provider.validateConfig({
      provider: kind, apiKey: ' ', model: curatedModel, customModel: false,
    })).toEqual({ ok: false, field: 'apiKey', code: 'invalid_config' });
    expect(provider.validateConfig({
      provider: kind, apiKey: 'key', model: ' ', customModel: true,
    } as never)).toEqual({ ok: false, field: 'model', code: 'invalid_config' });
    expect(provider.validateConfig({
      provider: kind, apiKey: 'key', model: curatedModel, customModel: false, origin: 'https://evil.test',
    } as any)).toEqual({ ok: false, field: 'model', code: 'invalid_config' });
  });
});
