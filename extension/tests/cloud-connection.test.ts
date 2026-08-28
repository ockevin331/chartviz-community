import { describe, expect, it, vi } from 'vitest';
import { CloudConnectionError } from '../src/cloud/cloud-client';
import { createCloudConnectionManager } from '../src/cloud/cloud-connection';

const account = {
  emailMasked: 'k***n@example.com', plan: 'advance' as const,
  currentPeriodEnd: '2026-09-28T00:00:00+00:00',
  quota: { limit: null, used: 7, remaining: null, unlimited: true },
  selectedModel: { id: 'openai/gpt-5.4', name: 'GPT-5.4', quotaCost: 2 },
  entitlements: { multiTimeframe: true, maxCaptures: 3 },
};

describe('Cloud connection lifecycle', () => {
  it('validates before persistence and exposes only the account', async () => {
    const events: string[] = [];
    const save = vi.fn(async () => { events.push('save'); });
    const manager = createCloudConnectionManager({
      client: {
        connect: vi.fn(async () => { events.push('connect'); return account; }),
        account: vi.fn(),
      },
      storage: { load: vi.fn(), save, clear: vi.fn() },
    });

    await expect(manager.connect(`  cv_live_${'x'.repeat(43)}  `)).resolves.toEqual({
      status: 'connected', account, errorCode: null,
    });
    expect(events).toEqual(['connect', 'save']);
    expect(JSON.stringify(await manager.connect(`cv_live_${'y'.repeat(43)}`))).not.toContain('cv_live_');
  });

  it('refreshes a stored account and updates the cache before reporting connected', async () => {
    const token = `cv_live_${'x'.repeat(43)}`;
    const refreshed = { ...account, plan: 'pro' as const, entitlements: { multiTimeframe: false, maxCaptures: 1 } };
    const save = vi.fn(async () => undefined);
    const manager = createCloudConnectionManager({
      client: { connect: vi.fn(), account: vi.fn(async () => refreshed) },
      storage: {
        load: vi.fn(async () => ({ token, account })), save, clear: vi.fn(),
      },
    });

    await expect(manager.load()).resolves.toEqual({
      status: 'connected', account: refreshed, errorCode: null,
    });
    expect(save).toHaveBeenCalledWith(token, refreshed);
  });

  it('keeps cached account metadata on refresh failure without exposing the token', async () => {
    const token = `cv_live_${'x'.repeat(43)}`;
    const manager = createCloudConnectionManager({
      client: {
        connect: vi.fn(),
        account: vi.fn(async () => { throw new CloudConnectionError('token_expired'); }),
      },
      storage: {
        load: vi.fn(async () => ({ token, account })), save: vi.fn(), clear: vi.fn(),
      },
    });

    const result = await manager.load();
    expect(result).toEqual({ status: 'error', account, errorCode: 'token_expired' });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('reports local storage failures as a stable service error', async () => {
    const manager = createCloudConnectionManager({
      client: { connect: vi.fn(), account: vi.fn() },
      storage: {
        load: vi.fn(async () => { throw new Error('storage unavailable'); }),
        save: vi.fn(),
        clear: vi.fn(),
      },
    });

    await expect(manager.load()).resolves.toEqual({
      status: 'error', account: null, errorCode: 'service_unavailable',
    });
  });

  it('disconnects locally without calling the service or revoking the website token', async () => {
    const clear = vi.fn(async () => undefined);
    const client = { connect: vi.fn(), account: vi.fn() };
    const manager = createCloudConnectionManager({
      client,
      storage: { load: vi.fn(), save: vi.fn(), clear },
    });

    await expect(manager.disconnect()).resolves.toEqual({
      status: 'disconnected', account: null, errorCode: null,
    });
    expect(clear).toHaveBeenCalledTimes(1);
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.account).not.toHaveBeenCalled();
  });
});
