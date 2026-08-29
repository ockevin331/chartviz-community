import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ value: undefined as unknown }));
const browserMock = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async () => ({ chartvizCloudConnection: state.value })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        state.value = items.chartvizCloudConnection;
      }),
      remove: vi.fn(async () => { state.value = undefined; }),
    },
    session: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
    sync: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
  },
}));

vi.mock('wxt/browser', () => ({ browser: browserMock }));

import {
  clearCloudConnection,
  loadCloudConnection,
  saveCloudConnection,
} from '../src/storage/cloud-connection-storage';

const account = {
  emailMasked: 'k***n@example.com', plan: 'pro' as const,
  currentPeriodEnd: '2026-09-28T00:00:00+00:00',
  quota: { limit: 50, used: 7, remaining: 43, unlimited: false },
  selectedModel: { id: 'openai/gpt-5.6-terra', name: 'GPT-5.6 Terra', quotaCost: 1 },
  entitlements: { multiTimeframe: false, maxCaptures: 1 },
};

describe('local-only Cloud connection storage', () => {
  beforeEach(() => {
    state.value = undefined;
    vi.clearAllMocks();
  });

  it('round-trips the credential and account through storage.local only', async () => {
    const token = `cv_live_${'x'.repeat(43)}`;
    await saveCloudConnection(token, account);

    await expect(loadCloudConnection()).resolves.toEqual({ token, account });
    expect(browserMock.storage.local.set).toHaveBeenCalledTimes(1);
    expect(browserMock.storage.session.set).not.toHaveBeenCalled();
    expect(browserMock.storage.sync.set).not.toHaveBeenCalled();

    await clearCloudConnection();
    await expect(loadCloudConnection()).resolves.toBeNull();
    expect(browserMock.storage.local.remove).toHaveBeenCalledWith('chartvizCloudConnection');
    expect(browserMock.storage.session.remove).not.toHaveBeenCalled();
    expect(browserMock.storage.sync.remove).not.toHaveBeenCalled();
  });

  it('does not return malformed or origin-bearing stored data', async () => {
    state.value = {
      token: `cv_live_${'x'.repeat(43)}`,
      account,
      baseUrl: 'https://evil.example',
    };

    await expect(loadCloudConnection()).resolves.toBeNull();
  });

  it('rejects invalid credentials before writing local storage', async () => {
    await expect(saveCloudConnection('website-session', account))
      .rejects.toBeInstanceOf(TypeError);
    expect(browserMock.storage.local.set).not.toHaveBeenCalled();
  });
});
