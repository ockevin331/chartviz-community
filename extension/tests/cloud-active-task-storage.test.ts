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
  removeStarted: Promise<void> | null = null;
  private resolveRemoveStarted: (() => void) | null = null;
  private releaseRemove: (() => void) | null = null;

  async get(key: string): Promise<Record<string, unknown>> {
    return this.records.has(key) ? { [key]: structuredClone(this.records.get(key)) } : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
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

  it('clears only the expected request ID', async () => {
    const storage = createCloudActiveTaskStorage(area);
    await storage.save(activeTask);

    await storage.clear('c_20260828_stale');
    await expect(storage.load()).resolves.toEqual(activeTask);

    await storage.clear(activeTask.requestId);
    await expect(storage.load()).resolves.toBeNull();
  });

  it('serializes an older conditional clear before a newer save', async () => {
    const storage = createCloudActiveTaskStorage(area);
    const newerTask = { ...activeTask, requestId: 'c_20260828_newer' };
    await storage.save(activeTask);
    area.blockNextRemove();

    const clearing = storage.clear(activeTask.requestId);
    await area.removeStarted;
    const saving = storage.save(newerTask);
    await Promise.resolve();

    expect(area.records.get('chartvizCloudActiveTask')).toEqual(activeTask);
    area.allowRemove();
    await Promise.all([clearing, saving]);

    await expect(storage.load()).resolves.toEqual(newerTask);
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
