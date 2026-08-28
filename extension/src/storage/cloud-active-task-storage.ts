import { z } from 'zod';
import { browser } from 'wxt/browser';
import type { OutputLanguage } from '../analysis/stages/shared-stage-types';
import {
  areCanonicalStoredCaptureDescriptors,
  type StoredCaptureDescriptor,
} from '../cloud/cloud-capture-descriptors';
import { outputLanguageSchema } from '../cloud/cloud-task-schema';

const activeTaskKey = 'chartvizCloudActiveTask';

export type StoredCloudActiveTask = Readonly<{
  requestId: string;
  tokenFingerprint: string;
  captures: readonly StoredCaptureDescriptor[];
  outputLanguage: OutputLanguage;
}>;

export type CloudActiveTaskLocalStorageArea = Readonly<{
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}>;

export type CloudActiveTaskStorage = Readonly<{
  load(): Promise<StoredCloudActiveTask | null>;
  save(value: StoredCloudActiveTask): Promise<void>;
  clear(expectedRequestId?: string, ownsClear?: () => boolean): Promise<void>;
}>;

const nullableShortString = z.string().min(1).max(120).nullable();
const storedCaptureDescriptorSchema: z.ZodType<StoredCaptureDescriptor> = z.object({
  captureId: z.enum(['C01', 'C02', 'C03']),
  timeframe: z.string().min(1).max(8),
  role: z.enum(['context', 'setup', 'trigger', 'setup_and_trigger']).nullable(),
  instrument: nullableShortString,
  site: z.string().min(1).max(80).nullable(),
  exchange: nullableShortString,
  pageType: z.enum([
    'advanced-chart', 'spot-trade', 'futures-trade', 'stock-trade', 'web3-token',
  ]).nullable(),
  width: z.number().int().min(320).max(10_000),
  height: z.number().int().min(180).max(10_000),
}).strict();

const storedCloudActiveTaskSchema: z.ZodType<StoredCloudActiveTask> = z.object({
  requestId: z.string().min(1).max(80),
  tokenFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  captures: z.array(storedCaptureDescriptorSchema).min(1).max(3),
  outputLanguage: outputLanguageSchema,
}).strict().superRefine((value, context) => {
  if (!areCanonicalStoredCaptureDescriptors(value.captures)) {
    context.addIssue({
      code: 'custom',
      path: ['captures'],
      message: 'noncanonical_capture_descriptors',
    });
  }
});

function invalidActiveTask(): TypeError {
  return new TypeError('Invalid ChartViz Cloud active task.');
}

let operationQueue: Promise<void> = Promise.resolve();

function serializeOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation);
  operationQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function createCloudActiveTaskStorage(
  area: CloudActiveTaskLocalStorageArea,
): CloudActiveTaskStorage {
  return Object.freeze({
    load(): Promise<StoredCloudActiveTask | null> {
      return serializeOperation(async () => {
        const values = await area.get(activeTaskKey);
        const value = values[activeTaskKey];
        if (value === undefined) return null;
        const parsed = storedCloudActiveTaskSchema.safeParse(value);
        if (!parsed.success) {
          await area.remove(activeTaskKey);
          throw invalidActiveTask();
        }
        return parsed.data;
      });
    },
    save(value: StoredCloudActiveTask): Promise<void> {
      return serializeOperation(async () => {
        const parsed = storedCloudActiveTaskSchema.safeParse(value);
        if (!parsed.success) throw invalidActiveTask();
        await area.set({ [activeTaskKey]: parsed.data });
      });
    },
    clear(expectedRequestId?: string, ownsClear = () => true): Promise<void> {
      return serializeOperation(async () => {
        if (!ownsClear()) return;
        if (expectedRequestId === undefined) {
          if (!ownsClear()) return;
          await area.remove(activeTaskKey);
          return;
        }
        const values = await area.get(activeTaskKey);
        if (!ownsClear()) return;
        const value = values[activeTaskKey];
        if (value === undefined) return;
        const parsed = storedCloudActiveTaskSchema.safeParse(value);
        if (!ownsClear()) return;
        if (!parsed.success) {
          if (!ownsClear()) return;
          await area.remove(activeTaskKey);
          throw invalidActiveTask();
        }
        if (parsed.data.requestId === expectedRequestId) {
          if (!ownsClear()) return;
          await area.remove(activeTaskKey);
        }
      });
    },
  });
}

const defaultStorage = createCloudActiveTaskStorage({
  get: (key) => browser.storage.local.get(key),
  set: (items) => browser.storage.local.set(items),
  remove: (key) => browser.storage.local.remove(key),
});

export function saveCloudActiveTask(value: StoredCloudActiveTask): Promise<void> {
  return defaultStorage.save(value);
}

export function loadCloudActiveTask(): Promise<StoredCloudActiveTask | null> {
  return defaultStorage.load();
}

export function clearCloudActiveTask(
  expectedRequestId?: string,
  ownsClear?: () => boolean,
): Promise<void> {
  return defaultStorage.clear(expectedRequestId, ownsClear);
}
