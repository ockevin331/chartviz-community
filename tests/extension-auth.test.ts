import { afterEach, describe, expect, it, vi } from 'vitest';

type StoredValue = Record<string, unknown>;

function browserStorage(initial: StoredValue) {
  const values = { ...initial };
  return {
    values,
    browser: {
      runtime: { id: 'abcdefghijklmnopabcdefghijklmnop' },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: values[key] })),
          set: vi.fn(async (next: StoredValue) => { Object.assign(values, next); }),
          remove: vi.fn(async (key: string) => { delete values[key]; }),
        },
      },
    },
  };
}

describe('extension authenticated requests', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('refreshes and retries once when an access token is rejected', async () => {
    const authKey = 'chartviz:extension-auth';
    const storage = browserStorage({
      [authKey]: {
        accessToken: 'old-access', refreshToken: 'old-refresh',
        expiresAt: Date.now() + 60_000,
        user: { id: '1', email: 'user@example.com' },
      },
    });
    vi.stubGlobal('browser', storage.browser);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe('omit');
      const url = String(input);
      const authorization = new Headers(init?.headers).get('Authorization');
      if (url.endsWith('/v1/extension-auth/token')) {
        return Response.json({
          accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 3600,
          user: { id: '1', email: 'user@example.com' },
        });
      }
      return authorization === 'Bearer new-access'
        ? Response.json({ ok: true })
        : Response.json({ detail: 'authentication required' }, { status: 401 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { authenticatedFetch } = await import('../src/api/extension-auth');
    const response = await authenticatedFetch('https://www.chartviz.xyz/api/v1/auth/me');

    expect(response?.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((storage.values[authKey] as { accessToken: string }).accessToken).toBe('new-access');
  });

  it('clears stale authorization when refresh is rejected', async () => {
    const authKey = 'chartviz:extension-auth';
    const storage = browserStorage({
      [authKey]: {
        accessToken: 'old-access', refreshToken: 'old-refresh',
        expiresAt: Date.now() + 60_000,
        user: { id: '1', email: 'user@example.com' },
      },
    });
    vi.stubGlobal('browser', storage.browser);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
      String(input).endsWith('/v1/extension-auth/token')
        ? Response.json({ detail: 'invalid refresh token' }, { status: 401 })
        : Response.json({ detail: 'authentication required' }, { status: 401 })
    )));

    const { authenticatedFetch } = await import('../src/api/extension-auth');
    const response = await authenticatedFetch('https://www.chartviz.xyz/api/v1/auth/me');

    expect(response?.status).toBe(401);
    expect(storage.values[authKey]).toBeUndefined();
  });

  it('logs in inside the extension and stores an independent token pair', async () => {
    const authKey = 'chartviz:extension-auth';
    const storage = browserStorage({});
    vi.stubGlobal('browser', storage.browser);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => Response.json({
      accessToken: 'direct-access', refreshToken: 'direct-refresh', expiresIn: 3600,
      user: {
        id: '1', userId: 'u_1', email: 'user@example.com', nickname: 'Trader',
        tradingLevel: 'one_to_three', focusAreas: ['crypto'], onboardingComplete: true,
        plan: 'free', subscriptionStatus: null, preferredLanguage: 'en',
      },
    }, { status: init?.method === 'POST' ? 200 : 405 }));
    vi.stubGlobal('fetch', fetchMock);

    const { loginExtension } = await import('../src/api/extension-auth');
    const user = await loginExtension('user@example.com', 'Strong!Pass1');

    expect(user.email).toBe('user@example.com');
    expect((storage.values[authKey] as { accessToken: string }).accessToken).toBe('direct-access');
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.clientId).toBe('abcdefghijklmnopabcdefghijklmnop');
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe('omit');
  });

  it('completes onboarding with the extension refresh grant and rotates tokens', async () => {
    const authKey = 'chartviz:extension-auth';
    const storage = browserStorage({
      [authKey]: {
        accessToken: 'old-access', refreshToken: 'old-refresh',
        expiresAt: Date.now() + 60_000,
        user: { id: '1', email: 'user@example.com' },
      },
    });
    vi.stubGlobal('browser', storage.browser);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 3600,
      user: {
        id: '1', userId: 'u_1', email: 'user@example.com', nickname: 'Trader',
        tradingLevel: 'one_to_three', focusAreas: ['crypto'], onboardingComplete: true,
        plan: 'free', subscriptionStatus: 'active', preferredLanguage: 'en',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { updateExtensionOnboarding } = await import('../src/api/extension-auth');
    const user = await updateExtensionOnboarding({
      nickname: 'Trader', tradingLevel: 'one_to_three', focusAreas: ['crypto'],
    });

    expect(user.onboardingComplete).toBe(true);
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request).toMatchObject({
      clientId: 'abcdefghijklmnopabcdefghijklmnop', refreshToken: 'old-refresh',
      nickname: 'Trader', tradingLevel: 'one_to_three', focusAreas: ['crypto'],
    });
    expect((storage.values[authKey] as { accessToken: string }).accessToken).toBe('new-access');
  });
});
