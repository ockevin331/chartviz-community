import { describe, expect, it } from 'vitest';
import { ProviderError } from '../src/providers/provider-errors';
import { MODEL_CATALOG_VERSION, curatedModels, getDefaultModel, getModelsForProvider } from '../src/providers/model-catalog';
import { providerRegistry } from '../src/providers/provider-registry';

describe('provider registry and curated catalog', () => {
  it('registers exactly the three working Community adapters', () => {
    expect(providerRegistry.kinds()).toEqual(['openrouter', 'openai', 'gemini']);
    expect(providerRegistry.get('openrouter').kind).toBe('openrouter');
    expect(providerRegistry.get('openai').kind).toBe('openai');
    expect(providerRegistry.get('gemini').kind).toBe('gemini');
    expect(() => providerRegistry.get('future' as any)).toThrowError(ProviderError);
  });

  it('publishes exactly six versioned models with one default per provider', () => {
    expect(MODEL_CATALOG_VERSION).toBe('community-models-1');
    expect(curatedModels).toEqual([
      {
        provider: 'openrouter',
        id: 'google/gemini-3.7-flash',
        label: 'Gemini 3.7 Flash',
        default: true,
      },
      {
        provider: 'openrouter',
        id: 'openai/gpt-5',
        label: 'GPT-5',
        default: false,
      },
      {
        provider: 'openai',
        id: 'gpt-5',
        label: 'GPT-5',
        default: true,
      },
      {
        provider: 'openai',
        id: 'gpt-5-mini',
        label: 'GPT-5 mini',
        default: false,
      },
      {
        provider: 'gemini',
        id: 'gemini-3.7-flash',
        label: 'Gemini 3.7 Flash',
        default: true,
      },
      {
        provider: 'gemini',
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        default: false,
      },
    ]);
    expect(getModelsForProvider('openrouter')).toEqual(curatedModels.slice(0, 2));
    expect(getModelsForProvider('openai')).toEqual(curatedModels.slice(2, 4));
    expect(getModelsForProvider('gemini')).toEqual(curatedModels.slice(4, 6));
    expect(getDefaultModel('openrouter')?.id).toBe('google/gemini-3.7-flash');
    expect(getDefaultModel('openai')?.id).toBe('gpt-5');
    expect(getDefaultModel('gemini')?.id).toBe('gemini-3.7-flash');
  });

  it.each([
    ['openrouter', 'google/gemini-3.7-flash'],
    ['openai', 'gpt-5'],
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
