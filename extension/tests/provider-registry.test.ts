import { describe, expect, it } from 'vitest';
import { ProviderError } from '../src/providers/provider-errors';
import { MODEL_CATALOG_VERSION, curatedModels, getDefaultModel, getModelsForProvider } from '../src/providers/model-catalog';
import { providerRegistry } from '../src/providers/provider-registry';

describe('provider registry and curated catalog', () => {
  it('registers only the working OpenRouter adapter while preserving all provider kinds in types', () => {
    expect(providerRegistry.kinds()).toEqual(['openrouter']);
    expect(providerRegistry.get('openrouter').kind).toBe('openrouter');
    expect(() => providerRegistry.get('openai')).toThrowError(ProviderError);
    expect(() => providerRegistry.get('gemini')).toThrowError(ProviderError);
  });

  it('publishes the versioned OpenRouter catalog with one exact default', () => {
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
    ]);
    expect(getModelsForProvider('openrouter')).toEqual(curatedModels);
    expect(getModelsForProvider('openai')).toEqual([]);
    expect(getDefaultModel('openrouter')?.id).toBe('google/gemini-3.7-flash');
    expect(getDefaultModel('gemini')).toBeNull();
  });

  it('validates trimmed OpenRouter config and rejects provider mismatch', () => {
    const provider = providerRegistry.get('openrouter');
    expect(provider.validateConfig({
      provider: 'openrouter', apiKey: ' key ', model: ' custom/model ', customModel: true,
    })).toEqual({ ok: true });
    expect(provider.validateConfig({
      provider: 'openai', apiKey: 'key', model: 'gpt-5', customModel: false,
    })).toEqual({ ok: false, field: 'model', code: 'invalid_config' });
    expect(provider.validateConfig({
      provider: 'openrouter', apiKey: ' ', model: 'model', customModel: true,
    })).toEqual({ ok: false, field: 'apiKey', code: 'invalid_config' });
    expect(provider.validateConfig({
      provider: 'openrouter', apiKey: 'key', model: ' ', customModel: true,
    })).toEqual({ ok: false, field: 'model', code: 'invalid_config' });
    expect(provider.validateConfig({
      provider: 'openrouter', apiKey: 'key', model: 'unlisted/model', customModel: false,
    })).toEqual({ ok: false, field: 'model', code: 'invalid_config' });
  });
});
