import { browser } from 'wxt/browser';
import { ProviderError } from '../providers/provider-errors';
import { normalizeProviderConfig, type ProviderConfig } from '../providers/provider-types';

const storageKey = 'providerConfig';

function invalidConfigField(value: unknown): 'apiKey' | 'model' {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const apiKey = (value as Record<string, unknown>).apiKey;
    if (typeof apiKey !== 'string' || apiKey.trim() === '') return 'apiKey';
  }
  return 'model';
}

export async function saveProviderConfig(config: ProviderConfig): Promise<void> {
  const normalized = normalizeProviderConfig(config);
  if (normalized === null) {
    throw new ProviderError('invalid_config', { params: { field: invalidConfigField(config) } });
  }
  await browser.storage.session.set({ [storageKey]: normalized });
}

export async function loadProviderConfig(): Promise<ProviderConfig | null> {
  const stored = await browser.storage.session.get(storageKey);
  return normalizeProviderConfig(stored[storageKey]);
}

export async function clearProviderConfig(): Promise<void> {
  await browser.storage.session.remove(storageKey);
}
