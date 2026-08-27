import { browser } from 'wxt/browser';
import type { AnalysisDiagnostic } from '../providers/provider-diagnostics';

const storageKey = 'lastAnalysisFailure';

export async function saveLastAnalysisFailure(diagnostic: AnalysisDiagnostic): Promise<void> {
  await browser.storage.local.set({ [storageKey]: diagnostic });
}

export async function loadLastAnalysisFailure(): Promise<AnalysisDiagnostic | null> {
  const stored = await browser.storage.local.get(storageKey);
  const value = stored[storageKey];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<AnalysisDiagnostic>;
  return candidate.source === 'extension_local'
    && candidate.pipelineVersion === 'community-3.0'
    && typeof candidate.requestId === 'string'
    ? value as AnalysisDiagnostic
    : null;
}

export async function clearLastAnalysisFailure(): Promise<void> {
  await browser.storage.local.remove(storageKey);
}
