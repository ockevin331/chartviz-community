import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearCommunityConnection,
  communityOriginPattern,
  loadCommunityConnection,
  normalizeCommunityBaseUrl,
  publicConnectionView,
  saveCommunityConnection,
  verifyCommunityConnection,
  type CommunityConnectionPlatform,
  type VerifiedCommunityConnection,
} from '../src/api/community-connection';

const token = 'local-token-with-32-characters-000';
const capabilities = {
  edition: 'community' as const,
  apiVersion: '1' as const,
  reportSchemaVersion: '1.3' as const,
  limits: { maxImages: 1, maxTimeframes: 1 },
  features: {
    multiTimeframe: false,
    marketDataFusion: false,
    advancedAnnotations: false,
    cloudAuthentication: false,
    billing: false,
  },
};

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function platformFor(
  responses: Response[],
  options: { contains?: boolean; grants?: boolean } = {},
): { platform: CommunityConnectionPlatform; calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    platform: {
      async containsOrigin(pattern) {
        calls.push(['containsPermission', pattern]);
        return options.contains ?? false;
      },
      async requestOrigin(pattern) {
        calls.push(['requestPermission', pattern]);
        return options.grants ?? true;
      },
      async fetch(input, init) {
        const authorization = new Headers(init?.headers).get('Authorization');
        calls.push(['fetch', String(input), authorization]);
        const next = responses.shift();
        if (!next) throw new Error('unexpected_fetch');
        return next;
      },
    },
  };
}

function storageBrowser(initial: Record<string, unknown> = {}) {
  const values = { ...initial };
  return {
    values,
    local: {
      get: vi.fn(async (key: string) => ({ [key]: values[key] })),
      set: vi.fn(async (next: Record<string, unknown>) => { Object.assign(values, next); }),
      remove: vi.fn(async (key: string) => { delete values[key]; }),
    },
  };
}

describe('Community backend URL validation', () => {
  it('allows loopback HTTP and trims only a trailing slash', () => {
    expect(normalizeCommunityBaseUrl(' http://127.0.0.1:8000/ '))
      .toBe('http://127.0.0.1:8000');
    expect(normalizeCommunityBaseUrl('http://localhost:8000/'))
      .toBe('http://localhost:8000');
    expect(normalizeCommunityBaseUrl('http://[::1]:8000/'))
      .toBe('http://[::1]:8000');
  });

  it('allows HTTPS with a base path and requests only its origin', () => {
    const baseUrl = normalizeCommunityBaseUrl('https://charts.example.com/chartviz/');

    expect(baseUrl).toBe('https://charts.example.com/chartviz');
    expect(communityOriginPattern(baseUrl)).toBe('https://charts.example.com/*');
  });

  it('rejects insecure remote HTTP and URL-carried secrets', () => {
    expect(() => normalizeCommunityBaseUrl('http://192.168.1.10:8000'))
      .toThrow('community_https_required');
    expect(() => normalizeCommunityBaseUrl('https://user:pass@example.com'))
      .toThrow('community_url_credentials_forbidden');
    expect(() => normalizeCommunityBaseUrl('https://example.com?token=value'))
      .toThrow('community_url_query_forbidden');
    expect(() => normalizeCommunityBaseUrl('https://example.com/#token'))
      .toThrow('community_url_fragment_forbidden');
  });
});

describe('Community backend verification', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requests exact origin permission before public and authenticated probes', async () => {
    const { platform, calls } = platformFor([
      response(capabilities),
      response({ models: [{ id: 'test-model', provider: 'openai-compatible' }] }),
    ]);

    const verified = await verifyCommunityConnection({
      baseUrl: 'http://127.0.0.1:8000/',
      token,
    }, platform);

    expect(calls).toEqual([
      ['containsPermission', 'http://127.0.0.1:8000/*'],
      ['requestPermission', 'http://127.0.0.1:8000/*'],
      ['fetch', 'http://127.0.0.1:8000/v1/capabilities', null],
      ['fetch', 'http://127.0.0.1:8000/v1/models', `Bearer ${token}`],
    ]);
    expect(verified).toEqual({
      version: 1,
      baseUrl: 'http://127.0.0.1:8000',
      token,
      capabilities,
      modelId: 'test-model',
    });
  });

  it('composes probes below an HTTPS base path', async () => {
    const { platform, calls } = platformFor([
      response(capabilities),
      response({ models: [{ id: 'test-model' }] }),
    ], { contains: true });

    await verifyCommunityConnection({
      baseUrl: 'https://charts.example.com/chartviz/',
      token,
    }, platform);

    expect(calls).toEqual([
      ['containsPermission', 'https://charts.example.com/*'],
      ['fetch', 'https://charts.example.com/chartviz/v1/capabilities', null],
      ['fetch', 'https://charts.example.com/chartviz/v1/models', `Bearer ${token}`],
    ]);
  });

  it('rejects invalid tokens before requesting permission', async () => {
    const { platform, calls } = platformFor([]);

    await expect(verifyCommunityConnection({
      baseUrl: 'http://127.0.0.1:8000',
      token: 'short token',
    }, platform)).rejects.toThrow('community_token_invalid');
    expect(calls).toEqual([]);
  });

  it.each([
    {
      name: 'permission denial',
      expected: 'community_permission_denied',
      make: () => platformFor([], { grants: false }).platform,
    },
    {
      name: 'wrong edition',
      expected: 'unexpected_backend_edition',
      make: () => platformFor([response({ ...capabilities, edition: 'cloud' })]).platform,
    },
    {
      name: 'incompatible version',
      expected: 'incompatible_api_version',
      make: () => platformFor([response({ ...capabilities, apiVersion: '2' })]).platform,
    },
    {
      name: 'rejected token',
      expected: 'community_token_rejected',
      make: () => platformFor([response(capabilities), response({ detail: 'unauthorized' }, 401)]).platform,
    },
  ])('does not persist after $name', async ({ expected, make }) => {
    const storage = storageBrowser();
    vi.stubGlobal('browser', { storage: { local: storage.local } });

    await expect(verifyCommunityConnection({
      baseUrl: 'http://127.0.0.1:8000',
      token,
    }, make())).rejects.toThrow(expected);
    expect(storage.local.set).not.toHaveBeenCalled();
  });

  it('maps a network failure without exposing its message or saving', async () => {
    const storage = storageBrowser();
    vi.stubGlobal('browser', { storage: { local: storage.local } });
    const platform: CommunityConnectionPlatform = {
      containsOrigin: async () => true,
      requestOrigin: async () => true,
      fetch: async () => { throw new Error(`provider leaked ${token}`); },
    };

    const result = verifyCommunityConnection({
      baseUrl: 'http://127.0.0.1:8000',
      token,
    }, platform);

    await expect(result).rejects.toThrow('community_unreachable');
    await expect(result).rejects.not.toThrow(token);
    expect(storage.local.set).not.toHaveBeenCalled();
  });
});

describe('Community connection storage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stores and loads the verified secret only under the Community key', async () => {
    const storage = storageBrowser({ 'chartviz:extension-auth': { accessToken: 'cloud-secret' } });
    vi.stubGlobal('browser', { storage: { local: storage.local } });
    const connection: VerifiedCommunityConnection = {
      version: 1,
      baseUrl: 'http://127.0.0.1:8000',
      token,
      capabilities,
      modelId: 'test-model',
    };

    await saveCommunityConnection(connection);

    expect(await loadCommunityConnection()).toEqual(connection);
    expect(storage.local.set).toHaveBeenCalledWith({
      'chartviz:community-connection:v1': connection,
    });
    expect(storage.values['chartviz:extension-auth']).toEqual({ accessToken: 'cloud-secret' });
  });

  it('returns a redacted public view', () => {
    const connection: VerifiedCommunityConnection = {
      version: 1,
      baseUrl: 'http://127.0.0.1:8000',
      token,
      capabilities,
      modelId: 'test-model',
    };

    const view = publicConnectionView(connection);

    expect(view).toEqual({
      connected: true,
      baseUrl: connection.baseUrl,
      hasStoredToken: true,
      capabilities,
      modelId: 'test-model',
    });
    expect(JSON.stringify(view)).not.toContain(token);
  });

  it('disconnects Community without clearing Cloud authorization', async () => {
    const storage = storageBrowser({
      'chartviz:community-connection:v1': { token },
      'chartviz:extension-auth': { accessToken: 'cloud-secret' },
    });
    vi.stubGlobal('browser', { storage: { local: storage.local } });

    await clearCommunityConnection();

    expect(storage.local.remove).toHaveBeenCalledWith('chartviz:community-connection:v1');
    expect(storage.values['chartviz:extension-auth']).toEqual({ accessToken: 'cloud-secret' });
  });
});
