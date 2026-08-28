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

import * as cloudConnectionStorage from '../src/storage/cloud-connection-storage';
import {
  clearCloudConnection,
  loadCloudConnection,
  saveCloudConnection,
} from '../src/storage/cloud-connection-storage';

type CleanupStorageFactory = (area: Readonly<{
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}>) => Readonly<{
  load(): Promise<unknown>;
  save(value: unknown): Promise<void>;
  clear(): Promise<void>;
}>;

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
    await expect(saveCloudConnection('website-session', account)).rejects.toBeInstanceOf(TypeError);
    expect(browserMock.storage.local.set).not.toHaveBeenCalled();
  });

  it('derives a deterministic lowercase SHA-256 grant fingerprint', async () => {
    const fingerprint = (cloudConnectionStorage as unknown as {
      cloudGrantFingerprint?: (token: string) => Promise<string>;
    }).cloudGrantFingerprint;
    expect(fingerprint).toBeTypeOf('function');
    if (!fingerprint) return;

    await expect(fingerprint('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('strictly round-trips a cleanup tombstone without token or image data', async () => {
    const create = (cloudConnectionStorage as unknown as {
      createCloudCleanupPendingStorage?: CleanupStorageFactory;
    }).createCloudCleanupPendingStorage;
    expect(create).toBeTypeOf('function');
    if (!create) return;
    let stored: unknown;
    const area = {
      get: vi.fn(async (key: string) => ({ [key]: stored })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        stored = items.chartvizCloudCleanupPending;
      }),
      remove: vi.fn(async () => { stored = undefined; }),
    };
    const cleanup = create(area);
    const tombstone = {
      requestId: 'c_20260828_cleanup',
      tokenFingerprint: 'b'.repeat(64),
    };

    await cleanup.save(tombstone);

    await expect(cleanup.load()).resolves.toEqual(tombstone);
    expect(JSON.stringify(stored)).not.toMatch(/cv_live_|data:image/i);
    await expect(cleanup.save({ ...tombstone, token: `cv_live_${'x'.repeat(43)}` }))
      .rejects.toBeInstanceOf(TypeError);
    await expect(cleanup.save({ ...tombstone, captures: [{ image: 'data:image/png;base64,AAAA' }] }))
      .rejects.toBeInstanceOf(TypeError);
  });

  it('deletes a malformed cleanup tombstone before rejecting it', async () => {
    const create = (cloudConnectionStorage as unknown as {
      createCloudCleanupPendingStorage?: CleanupStorageFactory;
    }).createCloudCleanupPendingStorage;
    expect(create).toBeTypeOf('function');
    if (!create) return;
    let stored: unknown = {
      requestId: 'c_20260828_cleanup',
      tokenFingerprint: 'not-sha256',
    };
    const area = {
      get: vi.fn(async (key: string) => ({ [key]: stored })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        stored = items.chartvizCloudCleanupPending;
      }),
      remove: vi.fn(async () => { stored = undefined; }),
    };
    const cleanup = create(area);

    await expect(cleanup.load()).rejects.toBeInstanceOf(TypeError);
    expect(stored).toBeUndefined();
    await expect(cleanup.load()).resolves.toBeNull();
  });
});
