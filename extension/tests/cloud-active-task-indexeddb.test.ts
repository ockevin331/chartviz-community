import { beforeEach, describe, expect, it } from 'vitest';
import type { AnalysisCapture } from '../src/analysis/runtime/analysis-runtime';
import {
  createCloudActiveTaskStorage,
  type CloudActiveTaskDatabase,
  type StoredCloudActiveTask,
} from '../src/storage/cloud-active-task-storage';

class MemoryDatabase implements CloudActiveTaskDatabase {
  readonly records = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.records.get(key);
  }

  async put(key: string, value: unknown): Promise<void> {
    this.records.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }
}

function capture(timeframe: string, suffix: string): AnalysisCapture {
  return {
    image: {
      mediaType: 'image/png',
      dataUrl: `data:image/png;base64,${suffix}`,
      width: 1280,
      height: 720,
    },
    context: {
      instrument: 'BTC/USDT', timeframe, site: 'binance',
      exchange: 'Binance', pageType: 'spot-trade',
    },
  };
}

const activeTask: StoredCloudActiveTask = {
  requestId: 'c_20260828_active',
  outputLanguage: 'en',
  captures: [
    capture('4h', 'AAAA'),
    capture('1h', 'BBBB'),
    capture('15m', 'CCCC'),
  ],
};

describe('IndexedDB Cloud active task repository', () => {
  let database: MemoryDatabase;

  beforeEach(() => {
    database = new MemoryDatabase();
  });

  it('round-trips every source capture without persisting a Cloud token', async () => {
    const storage = createCloudActiveTaskStorage(database);

    await storage.save(activeTask);

    await expect(storage.load()).resolves.toEqual(activeTask);
    expect(JSON.stringify([...database.records.values()])).not.toContain('cv_live_');
    expect([...database.records.keys()]).toEqual(['chartvizCloudActiveTask']);
  });

  it.each([
    { ...activeTask, captures: [] },
    { ...activeTask, captures: [...activeTask.captures, capture('5m', 'DDDD')] },
    { ...activeTask, outputLanguage: 'fr' },
    { ...activeTask, token: `cv_live_${'x'.repeat(43)}` },
    {
      ...activeTask,
      captures: [{
        ...activeTask.captures[0]!,
        image: { ...activeTask.captures[0]!.image, dataUrl: 'https://example.test/chart.png' },
      }],
    },
  ])('rejects malformed or credential-bearing records before writing', async (value) => {
    const storage = createCloudActiveTaskStorage(database);

    await expect(storage.save(value as never)).rejects.toBeInstanceOf(TypeError);
    expect(database.records.size).toBe(0);
  });

  it('rejects malformed loaded records instead of returning untrusted data', async () => {
    const storage = createCloudActiveTaskStorage(database);
    database.records.set('chartvizCloudActiveTask', { ...activeTask, extra: true });

    await expect(storage.load()).rejects.toBeInstanceOf(TypeError);
  });

  it('returns null when absent and clears the active record idempotently', async () => {
    const storage = createCloudActiveTaskStorage(database);

    await expect(storage.load()).resolves.toBeNull();
    await storage.save(activeTask);
    await storage.clear();
    await storage.clear();

    await expect(storage.load()).resolves.toBeNull();
  });
});
