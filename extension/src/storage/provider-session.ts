import { browser } from 'wxt/browser';
import { ProviderError } from '../providers/provider-errors';
import { normalizeProviderConfig, type ProviderConfig } from '../providers/provider-types';
import { migrateDeprecatedModel } from '../providers/model-catalog';

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
  const normalized = normalizeProviderConfig(stored[storageKey]);
  if (normalized === null) return null;
  const migrated = migrateDeprecatedModel(normalized);
  if (migrated !== normalized) await browser.storage.session.set({ [storageKey]: migrated });
  return migrated;
}

export async function clearProviderConfig(): Promise<void> {
  await browser.storage.session.remove(storageKey);
}
