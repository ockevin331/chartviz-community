import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ value: undefined as unknown, readError: false }));
const browserMock = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async () => {
        if (state.readError) throw new Error('storage unavailable');
        return { 'chartviz:language': state.value };
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        state.value = items['chartviz:language'];
      }),
    },
  },
}));

vi.mock('wxt/browser', () => ({ browser: browserMock }));

async function storageModule() {
  return import('../src/storage/language-storage').catch(() => null);
}

describe('language storage', () => {
  beforeEach(() => {
    state.value = undefined;
    state.readError = false;
    vi.clearAllMocks();
  });

  it('falls back to English when local storage cannot be read', async () => {
    const storage = await storageModule();
    expect(storage).not.toBeNull();
    if (!storage) return;
    state.readError = true;

    await expect(storage.loadLanguage()).resolves.toBe('en');
  });

  it('defaults missing or malformed state to English', async () => {
    const storage = await storageModule();
    expect(storage).not.toBeNull();
    if (!storage) return;

    await expect(storage.loadLanguage()).resolves.toBe('en');
    state.value = 'fr';
    await expect(storage.loadLanguage()).resolves.toBe('en');
  });

  it('round-trips a supported language through local storage', async () => {
    const storage = await storageModule();
    expect(storage).not.toBeNull();
    if (!storage) return;

    await storage.saveLanguage('zh-CN');

    expect(browserMock.storage.local.set).toHaveBeenCalledWith({ 'chartviz:language': 'zh-CN' });
    await expect(storage.loadLanguage()).resolves.toBe('zh-CN');
  });

  it('rejects unsupported languages before writing', async () => {
    const storage = await storageModule();
    expect(storage).not.toBeNull();
    if (!storage) return;

    await expect(storage.saveLanguage('fr' as never)).rejects.toBeInstanceOf(TypeError);
    expect(browserMock.storage.local.set).not.toHaveBeenCalled();
  });
});
