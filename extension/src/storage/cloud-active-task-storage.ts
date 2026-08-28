import { browser } from 'wxt/browser';
import { z } from 'zod';
import type { AnalysisCapture } from '../analysis/runtime/analysis-runtime';
import {
  analysisCaptureSchema,
  outputLanguageSchema,
} from '../cloud/cloud-task-schema';
import type { OutputLanguage } from '../analysis/stages/shared-stage-types';

const storageKey = 'chartvizCloudActiveTask';

export type StoredCloudActiveTask = Readonly<{
  requestId: string;
  capture: AnalysisCapture;
  outputLanguage: OutputLanguage;
}>;

const storedCloudActiveTaskSchema: z.ZodType<StoredCloudActiveTask> = z.object({
  requestId: z.string().min(1).max(80),
  capture: analysisCaptureSchema,
  outputLanguage: outputLanguageSchema,
}).strict();

function parseStored(value: unknown): StoredCloudActiveTask | null {
  const result = storedCloudActiveTaskSchema.safeParse(value);
  return result.success ? result.data : null;
}

export async function saveCloudActiveTask(value: StoredCloudActiveTask): Promise<void> {
  const parsed = storedCloudActiveTaskSchema.safeParse(value);
  if (!parsed.success) throw new TypeError('Invalid ChartViz Cloud active task.');
  await browser.storage.local.set({ [storageKey]: parsed.data });
}

export async function loadCloudActiveTask(): Promise<StoredCloudActiveTask | null> {
  const stored = await browser.storage.local.get(storageKey);
  return parseStored(stored[storageKey]);
}

export async function clearCloudActiveTask(): Promise<void> {
  await browser.storage.local.remove(storageKey);
}
