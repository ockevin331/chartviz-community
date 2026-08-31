import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageState = vi.hoisted(() => ({ value: undefined as unknown }));
const browserMock = vi.hoisted(() => ({
  storage: {
    session: {
      get: vi.fn(async () => ({ providerConfig: storageState.value })),
      remove: vi.fn(async () => { storageState.value = undefined; }),
      set: vi.fn(async (items: Record<string, unknown>) => { storageState.value = items.providerConfig; }),
    },
    local: {
      get: vi.fn(),
      remove: vi.fn(),
      set: vi.fn(),
    },
    sync: {
      get: vi.fn(),
      remove: vi.fn(),
      set: vi.fn(),
    },
  },
}));

vi.mock('wxt/browser', () => ({ browser: browserMock }));

import { ProviderError } from '../src/providers/provider-errors';
import { clearProviderConfig, loadProviderConfig, saveProviderConfig } from '../src/storage/provider-session';

describe('session-only provider configuration', () => {
  beforeEach(() => {
    storageState.value = undefined;
    vi.clearAllMocks();
  });

  it('round-trips a normalized config through storage.session only', async () => {
    await saveProviderConfig({
      provider: 'openrouter',
      apiKey: '  session-secret  ',
      model: '  openai/gpt-5.6-terra  ',
      customModel: false,
    });

    await expect(loadProviderConfig()).resolves.toEqual({
      provider: 'openrouter',
      apiKey: 'session-secret',
      model: 'openai/gpt-5.6-terra',
      customModel: false,
    });
    expect(browserMock.storage.session.set).toHaveBeenCalledTimes(1);
    expect(browserMock.storage.session.get).toHaveBeenCalledTimes(1);
    expect(browserMock.storage.local.set).not.toHaveBeenCalled();
    expect(browserMock.storage.sync.set).not.toHaveBeenCalled();

    await clearProviderConfig();

    await expect(loadProviderConfig()).resolves.toBeNull();
    expect(browserMock.storage.session.remove).toHaveBeenCalledTimes(1);
    expect(browserMock.storage.local.remove).not.toHaveBeenCalled();
    expect(browserMock.storage.sync.remove).not.toHaveBeenCalled();
  });

  it.each([
    [{ provider: 'openrouter', apiKey: '   ', model: 'google/gemini-3.7-flash', customModel: false }, 'apiKey'],
    [{ provider: 'openrouter', apiKey: 'key', model: '   ', customModel: true }, 'model'],
    [{ provider: 'openrouter', apiKey: 'key', model: 'custom/vision-model', customModel: true }, 'model'],
    [{ provider: 'other', apiKey: 'key', model: 'model', customModel: true }, 'model'],
    [{ provider: 'openrouter', apiKey: 'key', model: 'model', customModel: true, origin: 'https://evil.test' }, 'model'],
  ])('rejects invalid or origin-bearing configs before storage', async (config, field) => {
    const operation = saveProviderConfig(config as never);

    await expect(operation).rejects.toMatchObject({ code: 'invalid_config', params: { field } });
    await expect(operation).rejects.toBeInstanceOf(ProviderError);
    expect(browserMock.storage.session.set).not.toHaveBeenCalled();
  });

  it('returns null for malformed session data instead of trusting it', async () => {
    storageState.value = {
      provider: 'openrouter',
      apiKey: 'key',
      model: 'model',
      customModel: false,
      baseUrl: 'https://evil.test',
    };

    await expect(loadProviderConfig()).resolves.toBeNull();
  });
});
