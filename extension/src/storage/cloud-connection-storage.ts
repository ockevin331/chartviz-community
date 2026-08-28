import { browser } from 'wxt/browser';
import type { ExtensionAccount } from '../cloud/contracts/extension-cloud-v1';
import { parseExtensionAccount } from '../cloud/cloud-account-schema';

const storageKey = 'chartvizCloudConnection';
const cleanupPendingStorageKey = 'chartvizCloudCleanupPending';
const cloudTokenPattern = /^cv_live_[A-Za-z0-9_-]{43,}$/;
const tokenFingerprintPattern = /^[0-9a-f]{64}$/;

export type StoredCloudConnection = Readonly<{
  token: string;
  account: ExtensionAccount;
}>;

export type StoredCloudCleanupPending = Readonly<{
  requestId: string;
  tokenFingerprint: string;
}>;

export type CloudCleanupPendingStorage = Readonly<{
  load(): Promise<StoredCloudCleanupPending | null>;
  save(value: StoredCloudCleanupPending): Promise<void>;
  clear(): Promise<void>;
}>;

export type CloudLocalStorageArea = Readonly<{
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
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

function parseCleanupPending(value: unknown): StoredCloudCleanupPending | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join('\0') !== 'requestId\0tokenFingerprint') return null;
  if (typeof record.requestId !== 'string' || record.requestId.length < 1 || record.requestId.length > 80) return null;
  if (typeof record.tokenFingerprint !== 'string' || !tokenFingerprintPattern.test(record.tokenFingerprint)) return null;
  return {
    requestId: record.requestId,
    tokenFingerprint: record.tokenFingerprint,
  };
}

export async function cloudGrantFingerprint(token: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createCloudCleanupPendingStorage(
  area: CloudLocalStorageArea,
): CloudCleanupPendingStorage {
  return Object.freeze({
    async load(): Promise<StoredCloudCleanupPending | null> {
      const values = await area.get(cleanupPendingStorageKey);
      const value = values[cleanupPendingStorageKey];
      if (value === undefined) return null;
      const parsed = parseCleanupPending(value);
      if (parsed) return parsed;
      await area.remove(cleanupPendingStorageKey);
      throw new TypeError('Invalid ChartViz Cloud cleanup request.');
    },
    async save(value: StoredCloudCleanupPending): Promise<void> {
      const parsed = parseCleanupPending(value);
      if (!parsed) throw new TypeError('Invalid ChartViz Cloud cleanup request.');
      await area.set({ [cleanupPendingStorageKey]: parsed });
    },
    async clear(): Promise<void> {
      await area.remove(cleanupPendingStorageKey);
    },
  });
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

const cleanupPendingStorage = createCloudCleanupPendingStorage({
  get: (key) => browser.storage.local.get(key),
  set: (items) => browser.storage.local.set(items),
  remove: (key) => browser.storage.local.remove(key),
});

export function loadCloudCleanupPending(): Promise<StoredCloudCleanupPending | null> {
  return cleanupPendingStorage.load();
}

export function saveCloudCleanupPending(value: StoredCloudCleanupPending): Promise<void> {
  return cleanupPendingStorage.save(value);
}

export function clearCloudCleanupPending(): Promise<void> {
  return cleanupPendingStorage.clear();
}
