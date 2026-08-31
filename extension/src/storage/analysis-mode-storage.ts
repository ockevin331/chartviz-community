import { browser } from 'wxt/browser';
import { isAnalysisMode, type AnalysisMode } from '../analysis/analysis-mode';

const storageKey = 'analysisMode';

export async function loadAnalysisMode(): Promise<AnalysisMode> {
  const stored = await browser.storage.local.get(storageKey);
  if (isAnalysisMode(stored[storageKey])) return stored[storageKey];
  return 'cloud';
}

export async function saveAnalysisMode(mode: AnalysisMode): Promise<void> {
  if (!isAnalysisMode(mode)) throw new TypeError('Invalid analysis mode.');
  await browser.storage.local.set({ [storageKey]: mode });
}
