import { z } from 'zod';
import type { AnalysisCapture } from '../analysis/runtime/analysis-runtime';
import type { OutputLanguage } from '../analysis/stages/shared-stage-types';
import {
  analysisCaptureSchema,
  outputLanguageSchema,
} from '../cloud/cloud-task-schema';

const databaseName = 'chartvizCloudAnalysis';
const databaseVersion = 1;
const objectStoreName = 'activeTasks';
const activeTaskKey = 'chartvizCloudActiveTask';

export type StoredCloudActiveTask = Readonly<{
  requestId: string;
  tokenFingerprint: string;
  captures: readonly AnalysisCapture[];
  outputLanguage: OutputLanguage;
}>;

export type CloudActiveTaskDatabase = Readonly<{
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  deleteIf(key: string, predicate: (value: unknown) => boolean): Promise<void>;
}>;

export type CloudActiveTaskStorage = Readonly<{
  load(): Promise<StoredCloudActiveTask | null>;
  save(value: StoredCloudActiveTask): Promise<void>;
  clear(expectedRequestId?: string): Promise<void>;
}>;

const storedCloudActiveTaskSchema: z.ZodType<StoredCloudActiveTask> = z.object({
  requestId: z.string().min(1).max(80),
  tokenFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  captures: z.array(analysisCaptureSchema).min(1).max(3),
  outputLanguage: outputLanguageSchema,
}).strict();

function invalidActiveTask(): TypeError {
  return new TypeError('Invalid ChartViz Cloud active task.');
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed.')), { once: true });
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.')), { once: true });
  });
}

let openDatabasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (openDatabasePromise) return openDatabasePromise;
  openDatabasePromise = new Promise((resolve, reject) => {
    const factory = globalThis.indexedDB;
    if (!factory) {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
    const request = factory.open(databaseName, databaseVersion);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(objectStoreName)) {
        request.result.createObjectStore(objectStoreName);
      }
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => {
      openDatabasePromise = null;
      reject(request.error ?? new Error('Unable to open IndexedDB.'));
    }, { once: true });
    request.addEventListener('blocked', () => {
      openDatabasePromise = null;
      reject(new Error('IndexedDB upgrade is blocked.'));
    }, { once: true });
  });
  return openDatabasePromise;
}

export function createIndexedDbActiveTaskDatabase(
  open: () => Promise<IDBDatabase>,
): CloudActiveTaskDatabase {
  async function withStore<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await open();
    const transaction = database.transaction(objectStoreName, mode);
    const completion = transactionComplete(transaction);
    let request: IDBRequest<T>;
    try {
      request = operation(transaction.objectStore(objectStoreName));
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        void completion.catch(() => undefined);
        throw error;
      }
      await completion.catch(() => undefined);
      throw error;
    }
    const [result] = await Promise.all([
      requestResult(request),
      completion,
    ]);
    return result;
  }

  return Object.freeze({
    get: (key: string) => withStore('readonly', (store) => store.get(key)),
    async put(key: string, value: unknown): Promise<void> {
      await withStore('readwrite', (store) => store.put(value, key));
    },
    async delete(key: string): Promise<void> {
      await withStore('readwrite', (store) => store.delete(key));
    },
    async deleteIf(key: string, predicate: (value: unknown) => boolean): Promise<void> {
      const database = await open();
      const transaction = database.transaction(objectStoreName, 'readwrite');
      const completion = transactionComplete(transaction);
      const decision = new Promise<void>((resolve, reject) => {
        let getRequest: IDBRequest<unknown>;
        try {
          getRequest = transaction.objectStore(objectStoreName).get(key);
        } catch (error) {
          try { transaction.abort(); } catch { /* completion is already observed below */ }
          reject(error);
          return;
        }
        getRequest.addEventListener('error', () => {
          reject(getRequest.error ?? new Error('IndexedDB request failed.'));
        }, { once: true });
        getRequest.addEventListener('success', () => {
          let shouldDelete: boolean;
          try {
            shouldDelete = predicate(getRequest.result);
          } catch (error) {
            try { transaction.abort(); } catch { /* completion is already observed below */ }
            reject(error);
            return;
          }
          if (!shouldDelete) {
            resolve();
            return;
          }
          let deleteRequest: IDBRequest<undefined>;
          try {
            deleteRequest = transaction.objectStore(objectStoreName).delete(key);
          } catch (error) {
            try { transaction.abort(); } catch { /* completion is already observed below */ }
            reject(error);
            return;
          }
          deleteRequest.addEventListener('success', () => resolve(), { once: true });
          deleteRequest.addEventListener('error', () => {
            reject(deleteRequest.error ?? new Error('IndexedDB request failed.'));
          }, { once: true });
        }, { once: true });
      });
      await Promise.all([decision, completion]);
    },
  });
}

const indexedDatabase = createIndexedDbActiveTaskDatabase(openDatabase);

export function createCloudActiveTaskStorage(
  database: CloudActiveTaskDatabase,
): CloudActiveTaskStorage {
  return Object.freeze({
    async load(): Promise<StoredCloudActiveTask | null> {
      const value = await database.get(activeTaskKey);
      if (value === undefined) return null;
      const parsed = storedCloudActiveTaskSchema.safeParse(value);
      if (!parsed.success) {
        await database.delete(activeTaskKey);
        throw invalidActiveTask();
      }
      return parsed.data;
    },
    async save(value: StoredCloudActiveTask): Promise<void> {
      const parsed = storedCloudActiveTaskSchema.safeParse(value);
      if (!parsed.success) throw invalidActiveTask();
      await database.put(activeTaskKey, parsed.data);
    },
    async clear(expectedRequestId?: string): Promise<void> {
      if (expectedRequestId !== undefined) {
        let invalid = false;
        await database.deleteIf(activeTaskKey, (value) => {
          if (value === undefined) return false;
          const parsed = storedCloudActiveTaskSchema.safeParse(value);
          if (!parsed.success) {
            invalid = true;
            return true;
          }
          return parsed.data.requestId === expectedRequestId;
        });
        if (invalid) throw invalidActiveTask();
        return;
      }
      await database.delete(activeTaskKey);
    },
  });
}

const defaultStorage = createCloudActiveTaskStorage(indexedDatabase);

export function saveCloudActiveTask(value: StoredCloudActiveTask): Promise<void> {
  return defaultStorage.save(value);
}

export function loadCloudActiveTask(): Promise<StoredCloudActiveTask | null> {
  return defaultStorage.load();
}

export function clearCloudActiveTask(expectedRequestId?: string): Promise<void> {
  return defaultStorage.clear(expectedRequestId);
}
