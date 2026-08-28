import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserMock = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

vi.mock('wxt/browser', () => ({ browser: browserMock }));

import {
  createCloudActiveTaskStorage,
  loadCloudActiveTask,
  type CloudActiveTaskLockManager,
  type StoredCloudActiveTask,
} from '../src/storage/cloud-active-task-storage';

class SharedFakeExclusiveLock implements CloudActiveTaskLockManager {
  readonly requests: Array<{ name: string; mode: 'exclusive' }> = [];
  private readonly tails = new Map<string, Promise<void>>();

  request<T>(
    name: string,
    options: Readonly<{ mode: 'exclusive' }>,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.requests.push({ name, mode: options.mode });
    const result = (this.tails.get(name) ?? Promise.resolve()).then(operation);
    this.tails.set(name, result.then(() => undefined, () => undefined));
    return result;
  }
}

class MemoryStorageArea {
  readonly records = new Map<string, unknown>();
  removeStarted: Promise<void> | null = null;
  private resolveRemoveStarted: (() => void) | null = null;
  private releaseRemove: (() => void) | null = null;
  private setFailure: Error | null = null;

  async get(key: string): Promise<Record<string, unknown>> {
    return this.records.has(key) ? { [key]: structuredClone(this.records.get(key)) } : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    if (this.setFailure) {
      const error = this.setFailure;
      this.setFailure = null;
      throw error;
    }
    for (const [key, value] of Object.entries(items)) {
      this.records.set(key, structuredClone(value));
    }
  }

  async remove(key: string): Promise<void> {
    this.resolveRemoveStarted?.();
    if (this.removeStarted) {
      await new Promise<void>((resolve) => { this.releaseRemove = resolve; });
    }
    this.records.delete(key);
  }

  blockNextRemove(): void {
    this.removeStarted = new Promise<void>((resolve) => {
      this.resolveRemoveStarted = resolve;
    });
  }

  allowRemove(): void {
    this.releaseRemove?.();
    this.removeStarted = null;
    this.resolveRemoveStarted = null;
  }

  failNextSet(error = new Error('storage set failed')): void {
    this.setFailure = error;
  }
}

const sourceImage = {
  mediaType: 'image/png' as const,
  dataUrl: 'data:image/png;base64,AAAA',
  width: 1280,
  height: 720,
};

const activeTask: StoredCloudActiveTask = {
  requestId: 'c_20260828_active',
  tokenFingerprint: 'a'.repeat(64),
  outputLanguage: 'en',
  captures: [
    {
      captureId: 'C01',
      timeframe: '4h',
      role: 'context',
      instrument: 'BTC/USDT',
      site: 'binance',
      exchange: 'Binance',
      pageType: 'spot-trade',
      width: 1280,
      height: 720,
    },
    {
      captureId: 'C02',
      timeframe: '1h',
      role: 'setup_and_trigger',
      instrument: 'BTC/USDT',
      site: 'binance',
      exchange: 'Binance',
      pageType: 'spot-trade',
      width: 1280,
      height: 720,
    },
  ],
};

describe('local Cloud active task storage', () => {
  let area: MemoryStorageArea;
  let lock: SharedFakeExclusiveLock;

  beforeEach(() => {
    area = new MemoryStorageArea();
    lock = new SharedFakeExclusiveLock();
    vi.clearAllMocks();
  });

  it('round-trips descriptors and clears the local active-task key idempotently', async () => {
    const storage = createCloudActiveTaskStorage(area, lock);

    await expect(storage.load()).resolves.toBeNull();
    await storage.save(activeTask);

    await expect(storage.load()).resolves.toEqual(activeTask);
    expect([...area.records.keys()]).toEqual(['chartvizCloudActiveTask']);
    expect(JSON.stringify([...area.records.values()])).not.toMatch(/data:image|cv_live_/i);

    await storage.clear();
    await storage.clear();
    await expect(storage.load()).resolves.toBeNull();
    expect(lock.requests).toHaveLength(6);
    expect(lock.requests).toEqual(lock.requests.map(() => ({
      name: 'chartviz-cloud-active-task', mode: 'exclusive',
    })));
  });

  it.each([
    { ...activeTask, image: sourceImage },
    { ...activeTask, dataUrl: sourceImage.dataUrl },
    { ...activeTask, captures: [{ ...activeTask.captures[0], image: sourceImage }] },
    { ...activeTask, captures: [{ ...activeTask.captures[0], imageBase64: 'AAAA' }] },
  ])('rejects screenshot-bearing unknown fields before writing', async (value) => {
    const storage = createCloudActiveTaskStorage(area, lock);

    await expect(storage.save(value as never)).rejects.toBeInstanceOf(TypeError);
    expect(area.records.size).toBe(0);
  });

  it.each([
    { ...activeTask, image: sourceImage },
    { ...activeTask, dataUrl: sourceImage.dataUrl },
    { ...activeTask, captures: [{ ...activeTask.captures[0], image: sourceImage }] },
    { ...activeTask, captures: [{ ...activeTask.captures[0], imageBase64: 'AAAA' }] },
  ])('deletes screenshot-bearing malformed records before rejecting them', async (value) => {
    const storage = createCloudActiveTaskStorage(area, lock);
    area.records.set('chartvizCloudActiveTask', value);

    await expect(storage.load()).rejects.toBeInstanceOf(TypeError);
    expect(area.records.has('chartvizCloudActiveTask')).toBe(false);
    await expect(storage.load()).resolves.toBeNull();
  });

  it('deletes records with malformed descriptor values or unknown keys', async () => {
    const storage = createCloudActiveTaskStorage(area, lock);
    area.records.set('chartvizCloudActiveTask', {
      ...activeTask,
      captures: [{ ...activeTask.captures[0], captureId: 'C04', extra: true }],
    });

    await expect(storage.load()).rejects.toBeInstanceOf(TypeError);
    expect(area.records.size).toBe(0);
  });

  it.each([
    {
      invariant: 'unsupported timeframes',
      captures: [
        { ...activeTask.captures[0], timeframe: '10m' },
        activeTask.captures[1],
      ],
    },
    {
      invariant: 'duplicate timeframes',
      captures: [
        activeTask.captures[0],
        { ...activeTask.captures[1], timeframe: '4h' },
      ],
    },
    {
      invariant: 'non-sequential capture IDs',
      captures: [
        { ...activeTask.captures[0], captureId: 'C02' },
        { ...activeTask.captures[1], captureId: 'C01' },
      ],
    },
    {
      invariant: 'duplicate capture IDs',
      captures: [
        activeTask.captures[0],
        { ...activeTask.captures[1], captureId: 'C01' },
      ],
    },
    {
      invariant: 'a role inconsistent with capture count',
      captures: [{ ...activeTask.captures[0], role: 'context' }],
    },
    {
      invariant: 'roles inconsistent with canonical timeframe ordering',
      captures: [
        { ...activeTask.captures[0], role: 'setup_and_trigger' },
        { ...activeTask.captures[1], role: 'context' },
      ],
    },
  ])('deletes stored descriptors with $invariant', async ({ captures }) => {
    const storage = createCloudActiveTaskStorage(area, lock);
    area.records.set('chartvizCloudActiveTask', { ...activeTask, captures });

    await expect(storage.load()).rejects.toBeInstanceOf(TypeError);
    expect(area.records.has('chartvizCloudActiveTask')).toBe(false);
    await expect(storage.load()).resolves.toBeNull();
  });

  it('clears only the expected request ID', async () => {
    const storage = createCloudActiveTaskStorage(area, lock);
    await storage.save(activeTask);

    await storage.clear('c_20260828_stale');
    await expect(storage.load()).resolves.toEqual(activeTask);

    await storage.clear(activeTask.requestId);
    await expect(storage.load()).resolves.toBeNull();
  });

  it('rechecks clear ownership after waiting for the shared lock', async () => {
    const storage = createCloudActiveTaskStorage(area, lock);
    await storage.save(activeTask);
    const blockerEntered = deferred<void>();
    const releaseBlocker = deferred<void>();
    const blocker = lock.request(
      'chartviz-cloud-active-task',
      { mode: 'exclusive' },
      async () => {
        blockerEntered.resolve();
        await releaseBlocker.promise;
      },
    );
    await blockerEntered.promise;
    let ownsClear = true;

    const clearing = storage.clear(activeTask.requestId, () => ownsClear);
    expect(lock.requests).toHaveLength(3);
    ownsClear = false;
    releaseBlocker.resolve();
    await Promise.all([blocker, clearing]);

    await expect(storage.load()).resolves.toEqual(activeTask);
  });

  it('serializes an older conditional clear before a newer save', async () => {
    const panelA = createCloudActiveTaskStorage(area, lock);
    const panelB = createCloudActiveTaskStorage(area, lock);
    const newerTask = { ...activeTask, requestId: 'c_20260828_newer' };
    await panelA.save(activeTask);
    area.blockNextRemove();

    const clearing = panelA.clear(activeTask.requestId);
    await area.removeStarted;
    const saving = panelB.save(newerTask);
    await Promise.resolve();

    expect(area.records.get('chartvizCloudActiveTask')).toEqual(activeTask);
    area.allowRemove();
    await Promise.all([clearing, saving]);

    await expect(panelB.load()).resolves.toEqual(newerTask);
    expect(lock.requests.length).toBeGreaterThan(0);
  });

  it('serializes malformed cleanup before a valid replacement from another panel', async () => {
    const panelA = createCloudActiveTaskStorage(area, lock);
    const panelB = createCloudActiveTaskStorage(area, lock);
    area.records.set('chartvizCloudActiveTask', { ...activeTask, dataUrl: sourceImage.dataUrl });
    area.blockNextRemove();

    const cleaning = panelA.load();
    await area.removeStarted;
    const replacing = panelB.save(activeTask);
    await Promise.resolve();

    expect(area.records.get('chartvizCloudActiveTask')).toMatchObject({
      requestId: activeTask.requestId,
      dataUrl: sourceImage.dataUrl,
    });
    area.allowRemove();
    await expect(cleaning).rejects.toBeInstanceOf(TypeError);
    await replacing;

    await expect(panelA.load()).resolves.toEqual(activeTask);
    expect(JSON.stringify([...area.records.values()])).not.toMatch(/data:image|cv_live_/i);
    expect(lock.requests.length).toBeGreaterThan(0);
  });

  it('releases the shared lock after rejection so every operation remains usable', async () => {
    const panelA = createCloudActiveTaskStorage(area, lock);
    const panelB = createCloudActiveTaskStorage(area, lock);
    area.failNextSet();

    await expect(panelA.save(activeTask)).rejects.toThrow('storage set failed');
    await expect(panelB.save(activeTask)).resolves.toBeUndefined();
    await expect(panelA.load()).resolves.toEqual(activeTask);
    await expect(panelB.clear(activeTask.requestId)).resolves.toBeUndefined();
    await expect(panelA.load()).resolves.toBeNull();
  });

  it('fails closed with a sanitized error when production Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', {});
    try {
      await expect(loadCloudActiveTask()).rejects.toThrow(
        'ChartViz Cloud active-task storage is unavailable.',
      );
      expect(browserMock.storage.local.get).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('contains no IndexedDB or image-payload implementation', () => {
    const sourcePath = fileURLToPath(new URL(
      '../src/storage/cloud-active-task-storage.ts',
      import.meta.url,
    ));
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:indexedDB|IDBDatabase|IDBTransaction|dataUrl)\b/);
  });
});
