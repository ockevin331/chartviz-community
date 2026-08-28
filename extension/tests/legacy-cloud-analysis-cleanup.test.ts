import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserMock = vi.hoisted(() => ({
  storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } },
}));

vi.mock('wxt/browser', () => ({ browser: browserMock }));

import { cleanupLegacyCloudAnalysisStorage } from '../src/storage/legacy-cloud-analysis-cleanup';

class MemoryStorageArea {
  readonly records = new Map<string, unknown>();

  async get(key: string): Promise<Record<string, unknown>> {
    return this.records.has(key) ? { [key]: this.records.get(key) } : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) this.records.set(key, value);
  }
}

class FakeDeleteRequest extends EventTarget {
  error: DOMException | null = null;
}

type DeleteOutcome = 'success' | 'blocked' | 'error';

function indexedDbFactory(outcomes: DeleteOutcome[]) {
  return {
    deleteDatabase: vi.fn((name: string) => {
      const request = new FakeDeleteRequest();
      const outcome = outcomes.shift() ?? 'success';
      queueMicrotask(() => {
        if (outcome === 'error') {
          request.error = new DOMException('delete failed', 'UnknownError');
        }
        request.dispatchEvent(new Event(outcome));
      });
      return request as IDBOpenDBRequest;
    }),
  };
}

describe('legacy Cloud analysis database cleanup', () => {
  let area: MemoryStorageArea;

  beforeEach(() => {
    area = new MemoryStorageArea();
    vi.clearAllMocks();
  });

  it('marks the migration only after the legacy database is deleted', async () => {
    const factory = indexedDbFactory(['success']);

    await cleanupLegacyCloudAnalysisStorage(area, factory);

    expect(factory.deleteDatabase).toHaveBeenCalledWith('chartvizCloudAnalysis');
    expect(area.records.get('chartvizCloudAnalysisDatabaseRemoved')).toBe(true);
  });

  it('skips database deletion when the migration marker already exists', async () => {
    area.records.set('chartvizCloudAnalysisDatabaseRemoved', true);
    const factory = indexedDbFactory(['success']);

    await cleanupLegacyCloudAnalysisStorage(area, factory);

    expect(factory.deleteDatabase).not.toHaveBeenCalled();
    expect(area.records.get('chartvizCloudAnalysisDatabaseRemoved')).toBe(true);
  });

  it.each(['blocked', 'error'] as const)(
    'leaves a %s deletion retryable without an unhandled rejection',
    async (failedOutcome) => {
      const factory = indexedDbFactory([failedOutcome, 'success']);
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);

      try {
        await expect(cleanupLegacyCloudAnalysisStorage(area, factory)).resolves.toBeUndefined();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(area.records.has('chartvizCloudAnalysisDatabaseRemoved')).toBe(false);
        expect(unhandled).toEqual([]);

        await cleanupLegacyCloudAnalysisStorage(area, factory);
        expect(factory.deleteDatabase).toHaveBeenCalledTimes(2);
        expect(area.records.get('chartvizCloudAnalysisDatabaseRemoved')).toBe(true);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    },
  );
});
