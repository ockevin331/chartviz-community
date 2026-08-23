import { z } from 'zod';

import {
  backendCapabilitiesSchema,
  parseCompatibleCapabilities,
  type BackendCapabilities,
} from './backend-capabilities';

export type CommunityConnectionCandidate = {
  baseUrl: string;
  token: string;
};

export type VerifiedCommunityConnection = {
  version: 1;
  baseUrl: string;
  token: string;
  capabilities: BackendCapabilities;
  modelId: string;
};

export type CommunityConnectionView = {
  connected: boolean;
  baseUrl?: string;
  hasStoredToken: boolean;
  capabilities?: BackendCapabilities;
  modelId?: string;
  errorCode?: string;
};

export type CommunityConnectionPlatform = {
  containsOrigin(originPattern: string): Promise<boolean>;
  requestOrigin(originPattern: string): Promise<boolean>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export class CommunityConnectionError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'CommunityConnectionError';
  }
}

const COMMUNITY_CONNECTION_STORAGE_KEY = 'chartviz:community-connection:v1';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const storedCommunityConnectionSchema = z.object({
  version: z.literal(1),
  baseUrl: z.string().min(1),
  token: z.string().min(24),
  capabilities: backendCapabilitiesSchema,
  modelId: z.string().min(1),
});

function connectionError(code: string): CommunityConnectionError {
  return new CommunityConnectionError(code);
}

export function normalizeCommunityBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw connectionError('community_url_invalid');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw connectionError('community_url_protocol_invalid');
  }
  if (url.username || url.password) {
    throw connectionError('community_url_credentials_forbidden');
  }
  if (url.search) {
    throw connectionError('community_url_query_forbidden');
  }
  if (url.hash) {
    throw connectionError('community_url_fragment_forbidden');
  }
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw connectionError('community_https_required');
  }

  const pathname = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${pathname}`;
}

export function communityOriginPattern(baseUrl: string): string {
  return `${new URL(baseUrl).origin}/*`;
}

function normalizeToken(value: string): string {
  const token = value.trim();
  if (token.length < 24 || /\s/.test(token)) {
    throw connectionError('community_token_invalid');
  }
  return token;
}

async function permissionGranted(
  platform: CommunityConnectionPlatform,
  originPattern: string,
): Promise<boolean> {
  try {
    if (await platform.containsOrigin(originPattern)) return true;
    return await platform.requestOrigin(originPattern);
  } catch {
    return false;
  }
}

async function connectionFetch(
  platform: CommunityConnectionPlatform,
  input: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await platform.fetch(input, init);
  } catch {
    throw connectionError('community_unreachable');
  }
}

async function safeJson(response: Response, errorCode: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw connectionError(errorCode);
  }
}

function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

export async function verifyCommunityConnection(
  candidate: CommunityConnectionCandidate,
  platform: CommunityConnectionPlatform,
): Promise<VerifiedCommunityConnection> {
  const baseUrl = normalizeCommunityBaseUrl(candidate.baseUrl);
  const token = normalizeToken(candidate.token);
  const originPattern = communityOriginPattern(baseUrl);

  if (!await permissionGranted(platform, originPattern)) {
    throw connectionError('community_permission_denied');
  }

  const capabilitiesResponse = await connectionFetch(
    platform,
    apiUrl(baseUrl, '/v1/capabilities'),
    { credentials: 'omit', headers: { Accept: 'application/json' } },
  );
  if (!capabilitiesResponse.ok) {
    throw connectionError('community_capabilities_unavailable');
  }
  const capabilities = parseCompatibleCapabilities(
    await safeJson(capabilitiesResponse, 'invalid_capability_response'),
    'community',
  );

  const modelsResponse = await connectionFetch(
    platform,
    apiUrl(baseUrl, '/v1/models'),
    {
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (modelsResponse.status === 401 || modelsResponse.status === 403) {
    throw connectionError('community_token_rejected');
  }
  if (!modelsResponse.ok) {
    throw connectionError('community_model_catalog_unavailable');
  }

  const modelPayload = await safeJson(modelsResponse, 'invalid_model_response');
  const models = typeof modelPayload === 'object' && modelPayload !== null
    ? (modelPayload as { models?: unknown }).models
    : undefined;
  const firstModel = Array.isArray(models) ? models[0] : undefined;
  const modelId = typeof firstModel === 'object' && firstModel !== null
    ? (firstModel as { id?: unknown }).id
    : undefined;
  if (typeof modelId !== 'string' || !modelId.trim()) {
    throw connectionError('invalid_model_response');
  }

  return {
    version: 1,
    baseUrl,
    token,
    capabilities,
    modelId: modelId.trim(),
  };
}

export async function loadCommunityConnection(): Promise<VerifiedCommunityConnection | null> {
  const stored = await browser.storage.local.get(COMMUNITY_CONNECTION_STORAGE_KEY);
  const parsed = storedCommunityConnectionSchema.safeParse(
    stored[COMMUNITY_CONNECTION_STORAGE_KEY],
  );
  return parsed.success ? parsed.data : null;
}

export async function saveCommunityConnection(
  connection: VerifiedCommunityConnection,
): Promise<void> {
  const verified = storedCommunityConnectionSchema.parse(connection);
  await browser.storage.local.set({ [COMMUNITY_CONNECTION_STORAGE_KEY]: verified });
}

export async function clearCommunityConnection(): Promise<void> {
  await browser.storage.local.remove(COMMUNITY_CONNECTION_STORAGE_KEY);
}

export function publicConnectionView(
  connection: VerifiedCommunityConnection,
): CommunityConnectionView {
  return {
    connected: true,
    baseUrl: connection.baseUrl,
    hasStoredToken: true,
    capabilities: connection.capabilities,
    modelId: connection.modelId,
  };
}
