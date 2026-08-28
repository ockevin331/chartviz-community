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

vi.mock('wxt/browser', () => ({ browser: browserMock }));

import {
  createCloudActiveTaskStorage,
  type StoredCloudActiveTask,
} from '../src/storage/cloud-active-task-storage';

class MemoryStorageArea {
  readonly records = new Map<string, unknown>();
  getStarted: Promise<void> | null = null;
  removeStarted: Promise<void> | null = null;
  private resolveGetStarted: (() => void) | null = null;
  private resolveRemoveStarted: (() => void) | null = null;
  private releaseGet: (() => void) | null = null;
  private releaseRemove: (() => void) | null = null;
  private setFailure: Error | null = null;

  async get(key: string): Promise<Record<string, unknown>> {
    this.resolveGetStarted?.();
    if (this.getStarted) {
      await new Promise<void>((resolve) => { this.releaseGet = resolve; });
    }
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

  blockNextGet(): void {
    this.getStarted = new Promise<void>((resolve) => {
      this.resolveGetStarted = resolve;
    });
  }

  allowGet(): void {
    this.releaseGet?.();
    this.getStarted = null;
    this.resolveGetStarted = null;
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

  beforeEach(() => {
    area = new MemoryStorageArea();
    vi.clearAllMocks();
  });

  it('round-trips descriptors and clears the local active-task key idempotently', async () => {
    const storage = createCloudActiveTaskStorage(area);

    await expect(storage.load()).resolves.toBeNull();
    await storage.save(activeTask);

    await expect(storage.load()).resolves.toEqual(activeTask);
    expect([...area.records.keys()]).toEqual(['chartvizCloudActiveTask']);
    expect(JSON.stringify([...area.records.values()])).not.toMatch(/data:image|cv_live_/i);

    await storage.clear();
    await storage.clear();
    await expect(storage.load()).resolves.toBeNull();
  });

  it.each([
    { ...activeTask, image: sourceImage },
    { ...activeTask, dataUrl: sourceImage.dataUrl },
    { ...activeTask, captures: [{ ...activeTask.captures[0], image: sourceImage }] },
    { ...activeTask, captures: [{ ...activeTask.captures[0], imageBase64: 'AAAA' }] },
  ])('rejects screenshot-bearing unknown fields before writing', async (value) => {
    const storage = createCloudActiveTaskStorage(area);

    await expect(storage.save(value as never)).rejects.toBeInstanceOf(TypeError);
    expect(area.records.size).toBe(0);
  });

  it.each([
    { ...activeTask, image: sourceImage },
    { ...activeTask, dataUrl: sourceImage.dataUrl },
    { ...activeTask, captures: [{ ...activeTask.captures[0], image: sourceImage }] },
    { ...activeTask, captures: [{ ...activeTask.captures[0], imageBase64: 'AAAA' }] },
  ])('deletes screenshot-bearing malformed records before rejecting them', async (value) => {
    const storage = createCloudActiveTaskStorage(area);
    area.records.set('chartvizCloudActiveTask', value);

    await expect(storage.load()).rejects.toBeInstanceOf(TypeError);
    expect(area.records.has('chartvizCloudActiveTask')).toBe(false);
    await expect(storage.load()).resolves.toBeNull();
  });

  it('deletes records with malformed descriptor values or unknown keys', async () => {
    const storage = createCloudActiveTaskStorage(area);
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
    const storage = createCloudActiveTaskStorage(area);
    area.records.set('chartvizCloudActiveTask', { ...activeTask, captures });

    await expect(storage.load()).rejects.toBeInstanceOf(TypeError);
    expect(area.records.has('chartvizCloudActiveTask')).toBe(false);
    await expect(storage.load()).resolves.toBeNull();
  });

  it('clears only the expected request ID', async () => {
    const storage = createCloudActiveTaskStorage(area);
    await storage.save(activeTask);

    await storage.clear('c_20260828_stale');
    await expect(storage.load()).resolves.toEqual(activeTask);

    await storage.clear(activeTask.requestId);
    await expect(storage.load()).resolves.toBeNull();
  });

  it('rechecks clear ownership after waiting for an older serialized operation', async () => {
    const storage = createCloudActiveTaskStorage(area);
    await storage.save(activeTask);
    area.blockNextGet();
    const blocker = storage.load();
    await area.getStarted;
    let ownsClear = true;

    const clearing = storage.clear(activeTask.requestId, () => ownsClear);
    ownsClear = false;
    area.allowGet();
    await Promise.all([blocker, clearing]);

    await expect(storage.load()).resolves.toEqual(activeTask);
  });

  it('serializes an older conditional clear before a newer save', async () => {
    const panelA = createCloudActiveTaskStorage(area);
    const panelB = createCloudActiveTaskStorage(area);
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
  });

  it('serializes malformed cleanup before a valid replacement from another panel', async () => {
    const panelA = createCloudActiveTaskStorage(area);
    const panelB = createCloudActiveTaskStorage(area);
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
  });

  it('releases the serialized queue after rejection so every operation remains usable', async () => {
    const panelA = createCloudActiveTaskStorage(area);
    const panelB = createCloudActiveTaskStorage(area);
    area.failNextSet();

    await expect(panelA.save(activeTask)).rejects.toThrow('storage set failed');
    await expect(panelB.save(activeTask)).resolves.toBeUndefined();
    await expect(panelA.load()).resolves.toEqual(activeTask);
    await expect(panelB.clear(activeTask.requestId)).resolves.toBeUndefined();
    await expect(panelA.load()).resolves.toBeNull();
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
