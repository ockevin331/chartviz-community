import { browser } from 'wxt/browser';
import { isAnalysisMode, type AnalysisMode } from '../analysis/analysis-mode';
import type { ProviderConfig } from '../providers/provider-types';

const storageKey = 'analysisMode';

export async function loadAnalysisMode(
  directConfig: ProviderConfig | null,
): Promise<AnalysisMode> {
  const stored = await browser.storage.local.get(storageKey);
  if (isAnalysisMode(stored[storageKey])) return stored[storageKey];
  if (directConfig) {
    await browser.storage.local.set({ [storageKey]: 'direct' });
    return 'direct';
  }
  return 'cloud';
}

export async function saveAnalysisMode(mode: AnalysisMode): Promise<void> {
  if (!isAnalysisMode(mode)) throw new TypeError('Invalid analysis mode.');
  await browser.storage.local.set({ [storageKey]: mode });
}
