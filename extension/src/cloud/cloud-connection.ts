import type { ExtensionAccount } from './contracts/extension-cloud-v1';
import {
  CloudConnectionError,
  createCloudClient,
  type CloudClient,
  type CloudConnectionErrorCode,
} from './cloud-client';
import {
  clearCloudConnection,
  loadCloudConnection,
  saveCloudConnection,
  type StoredCloudConnection,
} from '../storage/cloud-connection-storage';

export type CloudConnectionState =
  | Readonly<{ status: 'disconnected'; account: null; errorCode: null }>
  | Readonly<{ status: 'connected'; account: ExtensionAccount; errorCode: null }>
  | Readonly<{
      status: 'error';
      account: ExtensionAccount | null;
      errorCode: CloudConnectionErrorCode;
    }>;

export type CloudConnectionManager = Readonly<{
  load(): Promise<CloudConnectionState>;
  connect(token: string): Promise<CloudConnectionState>;
  disconnect(): Promise<CloudConnectionState>;
}>;

type CloudConnectionDependencies = Readonly<{
  client: CloudClient;
  storage: Readonly<{
    load(): Promise<StoredCloudConnection | null>;
    save(token: string, account: ExtensionAccount): Promise<void>;
    clear(): Promise<void>;
  }>;
}>;

function errorCode(error: unknown): CloudConnectionErrorCode {
  return error instanceof CloudConnectionError ? error.code : 'service_unavailable';
}

export function createCloudConnectionManager(
  dependencies: CloudConnectionDependencies = {
    client: createCloudClient(),
    storage: {
      load: loadCloudConnection,
      save: saveCloudConnection,
      clear: clearCloudConnection,
    },
  },
): CloudConnectionManager {
  return Object.freeze({
    async load(): Promise<CloudConnectionState> {
      let stored: StoredCloudConnection | null = null;
      try {
        stored = await dependencies.storage.load();
        if (!stored) return { status: 'disconnected', account: null, errorCode: null };
        const account = await dependencies.client.account(stored.token);
        await dependencies.storage.save(stored.token, account);
        return { status: 'connected', account, errorCode: null };
      } catch (error) {
        return { status: 'error', account: stored?.account ?? null, errorCode: errorCode(error) };
      }
    },

    async connect(rawToken: string): Promise<CloudConnectionState> {
      const token = rawToken.trim();
      try {
        const account = await dependencies.client.connect(token);
        await dependencies.storage.save(token, account);
        return { status: 'connected', account, errorCode: null };
      } catch (error) {
        return { status: 'error', account: null, errorCode: errorCode(error) };
      }
    },

    async disconnect(): Promise<CloudConnectionState> {
      await dependencies.storage.clear();
      return { status: 'disconnected', account: null, errorCode: null };
    },
  });
}
