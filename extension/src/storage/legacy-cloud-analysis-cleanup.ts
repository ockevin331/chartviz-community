import { browser } from 'wxt/browser';

const legacyDatabaseName = 'chartvizCloudAnalysis';
const migrationMarkerKey = 'chartvizCloudAnalysisDatabaseRemoved';

export type LegacyCloudAnalysisStorageArea = Readonly<{
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}>;

export type LegacyCloudAnalysisIndexedDbFactory = Readonly<{
  deleteDatabase(name: string): IDBOpenDBRequest;
}>;

function deleteLegacyDatabase(factory: LegacyCloudAnalysisIndexedDbFactory): Promise<boolean> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.deleteDatabase(legacyDatabaseName);
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    const settle = (deleted: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(deleted);
    };
    request.addEventListener('success', () => settle(true), { once: true });
    request.addEventListener('error', () => settle(false), { once: true });
    request.addEventListener('blocked', () => settle(false), { once: true });
  });
}

const browserStorageArea: LegacyCloudAnalysisStorageArea = {
  get: (key) => browser.storage.local.get(key),
  set: (items) => browser.storage.local.set(items),
};

export async function cleanupLegacyCloudAnalysisStorage(
  area: LegacyCloudAnalysisStorageArea = browserStorageArea,
  indexedDbFactory: LegacyCloudAnalysisIndexedDbFactory | undefined = globalThis.indexedDB,
): Promise<void> {
  const values = await area.get(migrationMarkerKey);
  if (values[migrationMarkerKey] === true || !indexedDbFactory) return;
  if (!await deleteLegacyDatabase(indexedDbFactory)) return;
  await area.set({ [migrationMarkerKey]: true });
}
