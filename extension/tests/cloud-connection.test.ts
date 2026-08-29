import { describe, expect, it, vi } from 'vitest';
import { CloudConnectionError } from '../src/cloud/cloud-client';
import { createCloudConnectionManager } from '../src/cloud/cloud-connection';
import type { ExtensionAccount } from '../src/cloud/contracts/extension-cloud-v1';

const account: ExtensionAccount = {
  emailMasked: 'k***n@example.com', plan: 'advance' as const,
  currentPeriodEnd: '2026-09-28T00:00:00+00:00',
  quota: { limit: 150, used: 7, remaining: 143, unlimited: false },
  selectedModel: { id: 'openai/gpt-5.4', name: 'GPT-5.4', quotaCost: 1 },
  entitlements: { multiTimeframe: true, maxCaptures: 3 },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

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
    const refreshed = {
      ...account,
      plan: 'pro' as const,
      quota: { limit: 50, used: 7, remaining: 43, unlimited: false },
      entitlements: { multiTimeframe: true, maxCaptures: 3 },
    };
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

  it.each([
    ['oldest first', ['oldest', 'newest']],
    ['newest validation first', ['newest', 'oldest']],
  ] as const)('persists the newest invoked connection when %s resolves', async (_name, releaseOrder) => {
    const tokens = {
      oldest: `cv_live_${'a'.repeat(43)}`,
      newest: `cv_live_${'b'.repeat(43)}`,
    };
    const accounts: Record<'oldest' | 'newest', ExtensionAccount> = {
      oldest: account,
      newest: { ...account, emailMasked: 'n***w@example.com', plan: 'pro' as const },
    };
    const validations = {
      oldest: deferred<ExtensionAccount>(),
      newest: deferred<ExtensionAccount>(),
    };
    let stored: { token: string; account: ExtensionAccount } | null = null;
    const manager = createCloudConnectionManager({
      client: {
        connect: vi.fn((token: string) => (
          token === tokens.oldest ? validations.oldest.promise : validations.newest.promise
        )),
        account: vi.fn(),
      },
      storage: {
        load: vi.fn(),
        save: vi.fn(async (token, savedAccount) => { stored = { token, account: savedAccount }; }),
        clear: vi.fn(),
      },
    });

    const oldest = manager.connect(tokens.oldest);
    const newest = manager.connect(tokens.newest);
    for (const name of releaseOrder) {
      validations[name].resolve(accounts[name]);
      await validations[name].promise;
      await Promise.resolve();
    }

    await expect(Promise.all([oldest, newest])).resolves.toEqual([
      { status: 'connected', account: accounts.oldest, errorCode: null },
      { status: 'connected', account: accounts.newest, errorCode: null },
    ]);
    expect(stored).toEqual({ token: tokens.newest, account: accounts.newest });
  });

  it('persists a disconnect invoked after an in-flight connection', async () => {
    const token = `cv_live_${'c'.repeat(43)}`;
    const validation = deferred<typeof account>();
    let stored: { token: string; account: ExtensionAccount } | null = null;
    const manager = createCloudConnectionManager({
      client: { connect: vi.fn(() => validation.promise), account: vi.fn() },
      storage: {
        load: vi.fn(),
        save: vi.fn(async (savedToken, savedAccount) => {
          stored = { token: savedToken, account: savedAccount };
        }),
        clear: vi.fn(async () => { stored = null; }),
      },
    });

    const connecting = manager.connect(token);
    const disconnecting = manager.disconnect();
    validation.resolve(account);

    await expect(connecting).resolves.toEqual({ status: 'connected', account, errorCode: null });
    await expect(disconnecting).resolves.toEqual({
      status: 'disconnected', account: null, errorCode: null,
    });
    expect(stored).toBeNull();
  });

  it('continues with the next connection after a mutation rejects', async () => {
    const token = `cv_live_${'d'.repeat(43)}`;
    let stored: { token: string; account: ExtensionAccount } | null = null;
    const manager = createCloudConnectionManager({
      client: { connect: vi.fn(async () => account), account: vi.fn() },
      storage: {
        load: vi.fn(),
        save: vi.fn(async (savedToken, savedAccount) => {
          stored = { token: savedToken, account: savedAccount };
        }),
        clear: vi.fn(async () => { throw new Error('storage unavailable'); }),
      },
    });

    const disconnecting = manager.disconnect();
    const connecting = manager.connect(token);

    await expect(disconnecting).rejects.toThrow('storage unavailable');
    await expect(connecting).resolves.toEqual({ status: 'connected', account, errorCode: null });
    expect(stored).toEqual({ token, account });
  });
});
