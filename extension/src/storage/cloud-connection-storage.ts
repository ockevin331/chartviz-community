import { browser } from 'wxt/browser';
import type { ExtensionAccount } from '../cloud/contracts/extension-cloud-v1';
import { parseExtensionAccount } from '../cloud/cloud-account-schema';

const storageKey = 'chartvizCloudConnection';
const cloudTokenPattern = /^cv_live_[A-Za-z0-9_-]{43,}$/;

export type StoredCloudConnection = Readonly<{
  token: string;
  account: ExtensionAccount;
}>;

function parseStored(value: unknown): StoredCloudConnection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join('\0') !== 'account\0token') return null;
  if (typeof record.token !== 'string' || !cloudTokenPattern.test(record.token)) return null;
  try {
    return { token: record.token, account: parseExtensionAccount(record.account) };
  } catch {
    return null;
  }
}

export async function saveCloudConnection(
  token: string,
  account: ExtensionAccount,
): Promise<void> {
  if (!cloudTokenPattern.test(token)) throw new TypeError('Invalid ChartViz Cloud token.');
  const parsedAccount = parseExtensionAccount(account);
  await browser.storage.local.set({
    [storageKey]: { token, account: parsedAccount },
  });
}

export async function loadCloudConnection(): Promise<StoredCloudConnection | null> {
  const stored = await browser.storage.local.get(storageKey);
  return parseStored(stored[storageKey]);
}

export async function clearCloudConnection(): Promise<void> {
  await browser.storage.local.remove(storageKey);
}
