import { browser } from 'wxt/browser';
import type { Language } from '../ui/components/LanguageMenu';

const storageKey = 'chartviz:language';

function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'zh-CN';
}

export async function loadLanguage(): Promise<Language> {
  try {
    const stored = await browser.storage.local.get(storageKey);
    return isLanguage(stored[storageKey]) ? stored[storageKey] : 'en';
  } catch {
    return 'en';
  }
}

export async function saveLanguage(language: Language): Promise<void> {
  if (!isLanguage(language)) throw new TypeError('Invalid language.');
  await browser.storage.local.set({ [storageKey]: language });
}
