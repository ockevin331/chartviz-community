import { beforeEach, describe, expect, it } from 'vitest';
import type { AnalysisCapture } from '../src/analysis/runtime/analysis-runtime';
import {
  createCloudActiveTaskStorage,
  createIndexedDbActiveTaskDatabase,
  type CloudActiveTaskDatabase,
  type StoredCloudActiveTask,
} from '../src/storage/cloud-active-task-storage';

class FakeRequest<T> extends EventTarget {
  result!: T;
  error: DOMException | null = null;
}

class FakeTransaction extends EventTarget {
  error: DOMException | null = null;
  abortCalls = 0;

  constructor(private readonly store: Pick<IDBObjectStore, 'get' | 'put' | 'delete'>) {
    super();
  }

  objectStore(): IDBObjectStore {
    return this.store as IDBObjectStore;
  }

  abort(): void {
    this.abortCalls += 1;
    queueMicrotask(() => this.dispatchEvent(new Event('abort')));
  }
}

function fakeConnection(transaction: FakeTransaction): IDBDatabase {
  return {
    transaction: () => transaction as unknown as IDBTransaction,
  } as unknown as IDBDatabase;
}

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

  it('deletes malformed loaded records so the next restore can retry cleanly', async () => {
    const storage = createCloudActiveTaskStorage(database);
    database.records.set('chartvizCloudActiveTask', { ...activeTask, extra: true });

    await expect(storage.load()).rejects.toBeInstanceOf(TypeError);
    expect(database.records.size).toBe(0);
    await expect(storage.load()).resolves.toBeNull();
  });

  it('returns null when absent and clears the active record idempotently', async () => {
    const storage = createCloudActiveTaskStorage(database);

    await expect(storage.load()).resolves.toBeNull();
    await storage.save(activeTask);
    await storage.clear();
    await storage.clear();

    await expect(storage.load()).resolves.toBeNull();
  });

  it('observes both request and transaction rejection for one failed operation', async () => {
    const request = new FakeRequest<unknown>();
    let transaction!: FakeTransaction;
    const store = {
      get: () => {
        queueMicrotask(() => {
          request.error = new DOMException('request failed', 'UnknownError');
          request.dispatchEvent(new Event('error'));
          transaction.error = new DOMException('transaction aborted', 'AbortError');
          transaction.dispatchEvent(new Event('abort'));
        });
        return request as IDBRequest<unknown>;
      },
      put: () => request as IDBRequest<IDBValidKey>,
      delete: () => request as IDBRequest<undefined>,
    };
    transaction = new FakeTransaction(store);
    const database = createIndexedDbActiveTaskDatabase(async () => fakeConnection(transaction));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      await expect(database.get('active')).rejects.toThrow('request failed');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('aborts and observes transaction completion after a synchronous store failure', async () => {
    let transaction!: FakeTransaction;
    const request = new FakeRequest<unknown>();
    const store = {
      get: () => { throw new DOMException('invalid key', 'DataError'); },
      put: () => request as IDBRequest<IDBValidKey>,
      delete: () => request as IDBRequest<undefined>,
    };
    transaction = new FakeTransaction(store);
    const database = createIndexedDbActiveTaskDatabase(async () => fakeConnection(transaction));

    await expect(database.get('active')).rejects.toThrow('invalid key');
    expect(transaction.abortCalls).toBe(1);
  });
});
