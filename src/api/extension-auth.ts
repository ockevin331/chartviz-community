import { canonicalAnalysisApiBaseUrl } from './base-url';
import type { ExtensionApiFetchMessage, ExtensionApiFetchResponse } from '../domain/messages';
import type { AnalysisProgressEvent } from '../domain/analysis-progress';

const AUTH_STORAGE_KEY = 'chartviz:extension-auth';
const AUTH_TRACE_STORAGE_KEY = 'chartviz:extension-auth-trace';

export type ExtensionUser = {
  id: string; userId: string; email: string; nickname: string | null;
  tradingLevel: 'less_than_1' | 'one_to_three' | 'over_three' | null;
  focusAreas: Array<'crypto' | 'stocks' | 'forex' | 'futures'>;
  onboardingComplete: boolean; plan: 'free' | 'pro' | 'advance'; subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  preferredLanguage: 'en' | 'zh-CN' | null;
};

export class ExtensionAuthError extends Error {
  constructor(public code: string, public retryAfter?: number) {
    super(code);
  }
}

export type ExtensionSettings = {
  multi_frame?: string[];
  analysis_model?: string;
  [key: string]: unknown;
};

export type ExtensionAnalysisModel = {
  id: string; name: string; provider: string; quotaCost: number; recommended: boolean;
  descriptionEn: string; descriptionZh: string;
};

export type ExtensionModelCatalog = {
  models: ExtensionAnalysisModel[];
  selectedModel: string;
  quota: {
    plan: 'free' | 'pro' | 'advance'; limit: number | null; used: number;
    remaining: number | null; unlimited: boolean;
  };
};

export type ExtensionAnalysisListItem = {
  requestId: string;
  status: 'pending' | 'processing' | 'awaiting_confirmation' | 'cancel_requested' | 'cancelled' | 'completed' | 'failed';
  context: Record<string, unknown>;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type ExtensionAnalysisTask = {
  requestId: string;
  status: ExtensionAnalysisListItem['status'];
  context: Record<string, unknown>;
  report: unknown | null;
  error: string | null;
  progressEvents: AnalysisProgressEvent[];
};

type StoredAuth = {
  accessToken: string; refreshToken: string; expiresAt: number; user: ExtensionUser;
};

let refreshInFlight: Promise<StoredAuth | null> | null = null;

function apiBaseUrl() {
  return canonicalAnalysisApiBaseUrl(import.meta.env.WXT_PUBLIC_ANALYSIS_API_BASE_URL);
}

async function extensionApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  // The Upbit panel is mounted directly into the page because Upbit blocks the
  // normal extension iframe. A fetch from that UI inherits the website origin
  // and fails CORS. Keep all account requests in the extension service worker,
  // where they have the same trusted origin on every supported chart site.
  if (typeof window === 'undefined') {
    return fetch(`${apiBaseUrl()}${path}`, { ...init, credentials: 'omit' });
  }
  if (init.body != null && typeof init.body !== 'string') {
    return fetch(`${apiBaseUrl()}${path}`, { ...init, credentials: 'omit' });
  }
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const method = (init.method ?? 'GET').toUpperCase() as ExtensionApiFetchMessage['method'];
  const responseType = /^\/v1\/chart-analyses\/[^/]+\/image$/.test(path) ? 'base64' : 'text';
  const response = await browser.runtime.sendMessage({
    type: 'chartviz/extension-api/fetch',
    path,
    method,
    headers,
    body: typeof init.body === 'string' ? init.body : undefined,
    responseType,
  } satisfies ExtensionApiFetchMessage) as ExtensionApiFetchResponse | undefined;
  if (!response?.ok) throw new ExtensionAuthError('connection_failed');
  const body = response.encoding === 'base64'
    ? Uint8Array.from(atob(response.body), (character) => character.charCodeAt(0))
    : response.body || null;
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function apiPath(input: RequestInfo | URL): string | undefined {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const base = new URL(apiBaseUrl());
  const basePath = base.pathname.replace(/\/$/, '');
  if (url.origin !== base.origin || !url.pathname.startsWith(`${basePath}/`)) return undefined;
  return `${url.pathname.slice(basePath.length)}${url.search}`;
}

async function traceAuth(traceId: string, stage: string, startedAt: number, detail: Record<string, unknown> = {}) {
  const event = { traceId, stage, elapsedMs: Date.now() - startedAt, at: new Date().toISOString(), ...detail };
  console.info('[ChartViz auth]', event);
  const stored = await browser.storage.local.get(AUTH_TRACE_STORAGE_KEY);
  const history = Array.isArray(stored[AUTH_TRACE_STORAGE_KEY]) ? stored[AUTH_TRACE_STORAGE_KEY] : [];
  await browser.storage.local.set({ [AUTH_TRACE_STORAGE_KEY]: [...history.slice(-29), event] });
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function storedAuth(): Promise<StoredAuth | null> {
  const result = await browser.storage.local.get(AUTH_STORAGE_KEY);
  return (result[AUTH_STORAGE_KEY] as StoredAuth | undefined) ?? null;
}

async function saveAuth(payload: { accessToken: string; refreshToken: string; expiresIn: number; user: ExtensionUser }) {
  const auth: StoredAuth = { ...payload, expiresAt: Date.now() + payload.expiresIn * 1000 };
  await browser.storage.local.set({ [AUTH_STORAGE_KEY]: auth });
  return auth;
}

async function authFailure(response: Response, fallback: string): Promise<never> {
  const payload = await response.json().catch(() => null) as {
    detail?: string | { code?: string; retryAfter?: number };
  } | null;
  const detail = payload?.detail;
  if (typeof detail === 'object' && detail?.code) {
    throw new ExtensionAuthError(detail.code, detail.retryAfter);
  }
  throw new ExtensionAuthError(
    response.status === 401 ? 'invalid_credentials'
      : response.status === 409 ? 'email_exists'
        : response.status === 400 ? 'invalid_verification_code'
          : fallback,
  );
}

export async function loginExtension(email: string, password: string): Promise<ExtensionUser> {
  const response = await extensionApiFetch('/v1/extension-auth/login', {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, clientId: browser.runtime.id }),
  });
  if (!response.ok) return authFailure(response, 'login_failed');
  return (await saveAuth(await response.json())).user;
}

export async function requestExtensionRegistrationCode(
  email: string,
  language: 'en' | 'zh-CN',
): Promise<{ retryAfter: number }> {
  const response = await extensionApiFetch('/v1/auth/registration-code', {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, language }),
  });
  if (!response.ok) return authFailure(response, 'code_failed');
  return response.json();
}

export async function registerExtension(payload: {
  email: string; password: string; confirmPassword: string; verificationCode: string;
}): Promise<ExtensionUser> {
  const response = await extensionApiFetch('/v1/extension-auth/register', {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, clientId: browser.runtime.id }),
  });
  if (!response.ok) return authFailure(response, 'register_failed');
  return (await saveAuth(await response.json())).user;
}

export async function updateExtensionOnboarding(payload: {
  nickname: string;
  tradingLevel: 'less_than_1' | 'one_to_three' | 'over_three';
  focusAreas: Array<'crypto' | 'stocks' | 'forex' | 'futures'>;
}): Promise<ExtensionUser> {
  const auth = await storedAuth();
  if (!auth) throw new ExtensionAuthError('authorization_expired');
  const response = await extensionApiFetch('/v1/extension-auth/onboarding', {
    method: 'PUT', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload, clientId: browser.runtime.id, refreshToken: auth.refreshToken,
    }),
  });
  if (response.status === 401) throw new ExtensionAuthError('authorization_expired');
  if (!response.ok) return authFailure(response, 'onboarding_failed');
  return (await saveAuth(await response.json())).user;
}

async function performRefresh(auth: StoredAuth): Promise<StoredAuth | null> {
  const response = await extensionApiFetch('/v1/extension-auth/token', {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grantType: 'refresh_token', clientId: browser.runtime.id, refreshToken: auth.refreshToken }),
  });
  if (!response.ok) {
    const latest = await storedAuth();
    if (latest && latest.refreshToken !== auth.refreshToken) return latest;
    await browser.storage.local.remove(AUTH_STORAGE_KEY);
    return null;
  }
  return saveAuth(await response.json());
}

async function refresh(auth: StoredAuth): Promise<StoredAuth | null> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh(auth).finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function tokenAfterUnauthorized(failedToken: string): Promise<string | null> {
  const latest = await storedAuth();
  if (!latest) return null;
  if (latest.accessToken !== failedToken && latest.expiresAt > Date.now() + 30_000) {
    return latest.accessToken;
  }
  return (await refresh(latest))?.accessToken ?? null;
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response | null> {
  const token = await accessToken();
  if (!token) return null;
  const send = (activeToken: string) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${activeToken}`);
    const path = apiPath(input);
    return path
      ? extensionApiFetch(path, { ...init, headers })
      : fetch(input, { ...init, credentials: 'omit', headers });
  };
  const response = await send(token);
  if (response.status !== 401) return response;
  const replacement = await tokenAfterUnauthorized(token);
  if (!replacement) return response;
  return send(replacement);
}

export async function extensionUser(): Promise<ExtensionUser | null> {
  const auth = await storedAuth();
  if (!auth) return null;
  try {
    const response = await authenticatedFetch(`${apiBaseUrl()}/v1/auth/me`);
    if (!response || response.status === 401) return null;
    if (!response.ok) return auth.user;
    const user = await response.json() as ExtensionUser;
    const latest = await storedAuth();
    if (latest) await browser.storage.local.set({ [AUTH_STORAGE_KEY]: { ...latest, user } });
    return user;
  } catch {
    return auth.user;
  }
}

export async function accessToken(): Promise<string | null> {
  const auth = await storedAuth();
  if (!auth) return null;
  const active = auth.expiresAt > Date.now() + 30_000 ? auth : await refresh(auth);
  return active?.accessToken ?? null;
}

export async function refreshExtensionAccessToken(): Promise<string | null> {
  const auth = await storedAuth();
  if (!auth) return null;
  return (await refresh(auth))?.accessToken ?? null;
}

export async function updateExtensionLanguage(language: 'en' | 'zh-CN'): Promise<ExtensionUser | null> {
  const response = await authenticatedFetch(`${apiBaseUrl()}/v1/auth/language`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language }),
  });
  if (!response?.ok) return null;
  const user = await response.json() as ExtensionUser;
  const latest = await storedAuth();
  if (latest) await browser.storage.local.set({ [AUTH_STORAGE_KEY]: { ...latest, user } });
  return user;
}

export async function extensionSettings(): Promise<ExtensionSettings | null> {
  const response = await authenticatedFetch(`${apiBaseUrl()}/v1/user-settings`);
  if (!response?.ok) return null;
  const payload = await response.json() as { settings?: ExtensionSettings };
  return payload.settings ?? null;
}

export async function extensionAnalysisModels(): Promise<ExtensionModelCatalog | null> {
  const response = await authenticatedFetch(`${apiBaseUrl()}/v1/analysis-models`);
  if (!response?.ok) return null;
  return response.json() as Promise<ExtensionModelCatalog>;
}

export async function extensionAnalysisTasks(
  offset = 0,
  limit = 25,
): Promise<{ items: ExtensionAnalysisListItem[]; nextOffset: number | null; hasMore: boolean }> {
  const response = await authenticatedFetch(
    `${apiBaseUrl()}/v1/analysis-tasks?offset=${offset}&limit=${limit}`,
  );
  if (!response?.ok) throw new ExtensionAuthError('analysis_list_failed');
  return response.json();
}

export async function extensionAnalysisTask(requestId: string): Promise<ExtensionAnalysisTask> {
  const response = await authenticatedFetch(
    `${apiBaseUrl()}/v1/analysis-tasks/${encodeURIComponent(requestId)}`,
  );
  if (!response?.ok) throw new ExtensionAuthError('analysis_load_failed');
  return response.json();
}

export async function extensionAnalysisImage(requestId: string): Promise<string | null> {
  const response = await authenticatedFetch(
    `${apiBaseUrl()}/v1/chart-analyses/${encodeURIComponent(requestId)}/image`,
  );
  if (!response?.ok) return null;
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => reject(reader.error ?? new Error('analysis_image_failed'));
    reader.readAsDataURL(blob);
  });
}

export async function updateExtensionSetting(
  key: string,
  value: unknown,
): Promise<ExtensionSettings | null> {
  const response = await authenticatedFetch(`${apiBaseUrl()}/v1/user-settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!response?.ok) return null;
  const payload = await response.json() as { settings?: ExtensionSettings };
  return payload.settings ?? null;
}

export async function authorizeExtension(onStage?: (stage: 'opening' | 'waiting') => void): Promise<ExtensionUser> {
  const startedAt = Date.now();
  const traceId = base64Url(crypto.getRandomValues(new Uint8Array(9)));
  await traceAuth(traceId, 'clicked', startedAt);
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const redirectUri = browser.identity.getRedirectURL('chartviz');
  const authorizeUrl = new URL('https://www.chartviz.xyz/extension/authorize');
  const storedLanguage = await browser.storage.local.get('chartviz:language');
  const language = storedLanguage['chartviz:language'];
  authorizeUrl.searchParams.set('client_id', browser.runtime.id);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('trace_id', traceId);
  authorizeUrl.searchParams.set('started_at', String(startedAt));
  if (language === 'en' || language === 'zh-CN') authorizeUrl.searchParams.set('language', language);
  await traceAuth(traceId, 'launch_web_auth_flow', startedAt);
  onStage?.('opening');
  queueMicrotask(() => onStage?.('waiting'));
  const callbackValue = await browser.identity.launchWebAuthFlow({ url: authorizeUrl.toString(), interactive: true });
  if (!callbackValue) throw new Error('Authorization was cancelled.');
  const callback = new URL(callbackValue);
  await traceAuth(traceId, 'authorization_callback', startedAt, {
    pageLoadedMs: Number(callback.searchParams.get('page_loaded_ms')) || undefined,
    authorizeRequestMs: Number(callback.searchParams.get('authorize_request_ms')) || undefined,
  });
  if (callback.searchParams.get('state') !== state) throw new Error('Authorization state mismatch.');
  const code = callback.searchParams.get('code');
  if (!code) throw new Error('Authorization code was not returned.');
  const exchangeStartedAt = Date.now();
  const response = await extensionApiFetch('/v1/extension-auth/token', {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grantType: 'authorization_code', clientId: browser.runtime.id, redirectUri, code, codeVerifier: verifier }),
  });
  if (!response.ok) throw new Error('ChartViz authorization failed.');
  const user = (await saveAuth(await response.json())).user;
  await traceAuth(traceId, 'completed', startedAt, { tokenExchangeMs: Date.now() - exchangeStartedAt });
  return user;
}

export async function clearExtensionAuth() {
  await browser.storage.local.remove(AUTH_STORAGE_KEY);
}

export async function logoutExtension() {
  const auth = await storedAuth();
  if (auth) {
    const active = auth.expiresAt > Date.now() + 30_000 ? auth : await refresh(auth);
    if (active) {
      await extensionApiFetch('/v1/extension-auth/logout', {
        method: 'POST', credentials: 'omit', headers: {
          Authorization: `Bearer ${active.accessToken}`,
        },
      }).catch(() => undefined);
    }
  }
  await clearExtensionAuth();
}
