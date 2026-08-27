import { beforeEach, describe, expect, it, vi } from 'vitest';

const localState = vi.hoisted(() => ({ value: undefined as unknown }));
const browserMock = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async () => ({ analysisMode: localState.value })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        localState.value = items.analysisMode;
      }),
    },
    session: {
      get: vi.fn(),
      set: vi.fn(),
    },
  },
}));

vi.mock('wxt/browser', () => ({ browser: browserMock }));

import type { ProviderConfig } from '../src/providers/provider-types';
import {
  loadAnalysisMode,
  saveAnalysisMode,
} from '../src/storage/analysis-mode-storage';

const directConfig: ProviderConfig = {
  provider: 'openrouter',
  apiKey: 'session-secret',
  model: 'openai/gpt-5.6-terra',
  customModel: false,
};

describe('analysis mode storage', () => {
  beforeEach(() => {
    localState.value = undefined;
    vi.clearAllMocks();
  });

  it('defaults a new installation to Cloud without persisting an active mode', async () => {
    await expect(loadAnalysisMode(null)).resolves.toBe('cloud');
    expect(browserMock.storage.local.set).not.toHaveBeenCalled();
  });

  it('migrates an existing usable Direct session and persists the result', async () => {
    await expect(loadAnalysisMode(directConfig)).resolves.toBe('direct');
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({ analysisMode: 'direct' });
    expect(browserMock.storage.session.set).not.toHaveBeenCalled();
  });

  it.each(['cloud', 'direct'] as const)('keeps the saved %s mode', async (mode) => {
    localState.value = mode;
    await expect(loadAnalysisMode(mode === 'direct' ? directConfig : null)).resolves.toBe(mode);
    expect(browserMock.storage.local.set).not.toHaveBeenCalled();
  });

  it('ignores malformed local state unless a Direct configuration can migrate it', async () => {
    localState.value = { mode: 'direct', apiKey: 'leak' };
    await expect(loadAnalysisMode(null)).resolves.toBe('cloud');
    expect(browserMock.storage.local.set).not.toHaveBeenCalled();

    await expect(loadAnalysisMode(directConfig)).resolves.toBe('direct');
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({ analysisMode: 'direct' });
  });

  it('persists only the requested non-secret mode', async () => {
    await saveAnalysisMode('cloud');

    expect(browserMock.storage.local.set).toHaveBeenCalledWith({ analysisMode: 'cloud' });
    expect(JSON.stringify(browserMock.storage.local.set.mock.calls)).not.toContain('session-secret');
    expect(browserMock.storage.session.set).not.toHaveBeenCalled();
  });

  it('rejects an invalid mode before writing storage', async () => {
    await expect(saveAnalysisMode('other' as never)).rejects.toBeInstanceOf(TypeError);
    expect(browserMock.storage.local.set).not.toHaveBeenCalled();
  });
});
