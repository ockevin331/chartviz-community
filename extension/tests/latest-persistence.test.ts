import { describe, expect, it, vi } from 'vitest';
import { createLatestPersistenceCoordinator } from '../src/storage/latest-persistence';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('latest persistence ownership', () => {
  it('exposes a failed supersession and accepts a retry', async () => {
    const staleWrite = deferred<void>();
    const compensation = deferred<void>();
    const values: string[] = [];
    let cloudAttempts = 0;
    const write = vi.fn(async (value: string) => {
      if (value === 'direct') await staleWrite.promise;
      if (value === 'cloud' && cloudAttempts++ === 0) await compensation.promise;
      values.push(value);
    });
    const coordinator = createLatestPersistenceCoordinator(write);

    const stale = coordinator.persist('direct');
    const restoring = coordinator.supersedeWith('cloud');
    staleWrite.resolve();
    await expect(stale).resolves.toBe('superseded');
    compensation.reject(new Error('compensation failed'));

    await expect(restoring).rejects.toThrow('compensation failed');
    await expect(coordinator.persist('cloud')).resolves.toBe('persisted');
    expect(values).toEqual(['direct', 'cloud']);
  });

  it('owns a superseded compensation rejection without rejecting its completion', async () => {
    const staleWrite = deferred<void>();
    const compensation = deferred<void>();
    const values: string[] = [];
    const write = vi.fn(async (value: string) => {
      if (value === 'direct' && values.length === 0) await staleWrite.promise;
      if (value === 'cloud') await compensation.promise;
      values.push(value);
    });
    const coordinator = createLatestPersistenceCoordinator(write);

    const stale = coordinator.persist('direct');
    const restoring = coordinator.supersedeWith('cloud');
    staleWrite.resolve();
    await expect(stale).resolves.toBe('superseded');
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith('cloud'));
    const newest = coordinator.persist('direct');
    compensation.reject(new Error('superseded compensation failed'));

    await expect(restoring).resolves.toBe('superseded');
    await expect(newest).resolves.toBe('persisted');
    expect(values).toEqual(['direct', 'direct']);
  });
});
