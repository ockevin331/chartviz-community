import { describe, expect, it, vi } from 'vitest';

const browserMock = vi.hoisted(() => ({
  runtime: { sendMessage: vi.fn() },
  tabs: { sendMessage: vi.fn() },
  storage: {
    session: {
      get: vi.fn(async () => ({})),
      remove: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    },
    local: { set: vi.fn() },
    sync: { set: vi.fn() },
  },
}));

vi.mock('wxt/browser', () => ({ browser: browserMock }));

import { ProviderError } from '../src/providers/provider-errors';
import { saveProviderConfig } from '../src/storage/provider-session';

describe('provider secret boundary', () => {
  it('keeps the API key out of messages, URLs, logs, and safe validation errors', async () => {
    const secret = 'fixture-secret-never-leak';
    const consoleSpies = [
      vi.spyOn(console, 'debug').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    ];

    try {
      await expect(saveProviderConfig({
        provider: 'openrouter',
        apiKey: secret,
        model: 'model',
        customModel: true,
        origin: `https://evil.test/${secret}`,
      } as never)).rejects.toBeInstanceOf(ProviderError);

      expect(browserMock.runtime.sendMessage).not.toHaveBeenCalled();
      expect(browserMock.tabs.sendMessage).not.toHaveBeenCalled();
      expect(browserMock.storage.local.set).not.toHaveBeenCalled();
      expect(browserMock.storage.sync.set).not.toHaveBeenCalled();
      expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);

      let error: unknown;
      try {
        await saveProviderConfig({
          provider: 'openrouter',
          apiKey: secret,
          model: '',
          customModel: true,
        });
      } catch (caught) {
        error = caught;
      }
      expect(`${String(error)} ${JSON.stringify(error)} ${(error as Error).stack}`).not.toContain(secret);
    } finally {
      consoleSpies.forEach((spy) => spy.mockRestore());
    }
  });
});
