import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CloudBackendRuntime,
  CommunityBackendRuntime,
  createBackendRuntime,
} from '../src/api/backend-runtime';
import { CommunityAnalysisClient } from '../src/api/community-client';
import type { VerifiedCommunityConnection } from '../src/api/community-connection';
import type { ChartContext } from '../src/domain/analysis';

const context: ChartContext = {
  site: 'tradingview', pageType: 'advanced-chart',
  url: 'https://www.tradingview.com/chart/example/', symbol: 'BTCUSD', timeframe: '15m',
  chart: { id: 'chart', bounds: { x: 0, y: 0, width: 800, height: 600 } },
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
};
const image = new Blob(['png'], { type: 'image/png' });
const cloudCapabilities = {
  edition: 'cloud' as const, apiVersion: '1' as const, reportSchemaVersion: '1.3' as const,
  limits: { maxImages: 3, maxTimeframes: 3 },
  features: {
    multiTimeframe: true, marketDataFusion: true, advancedAnnotations: true,
    cloudAuthentication: true, billing: true,
  },
};
const communityConnection: VerifiedCommunityConnection = {
  version: 1, baseUrl: 'http://127.0.0.1:8000',
  token: 'local-token-with-32-characters-000', modelId: 'test-model',
  capabilities: {
    edition: 'community', apiVersion: '1', reportSchemaVersion: '1.3',
    limits: { maxImages: 1, maxTimeframes: 1 },
    features: {
      multiTimeframe: false, marketDataFusion: false, advancedAnnotations: false,
      cloudAuthentication: false, billing: false,
    },
  },
};

describe('analysis backend runtimes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves explicit Cloud identity headers and returns the normalized task', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toMatch(/\/v1\/analysis-tasks$/);
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer cloud-token');
      expect(headers.get('X-ChartViz-Expected-User-Id')).toBe('u_cloud');
      expect(headers.get('X-ChartViz-Extension-Version')).toBe('1.0.0');
      return Response.json({ requestId: 'c_cloud', status: 'pending', context });
    });
    vi.stubGlobal('fetch', fetcher);
    const runtime = new CloudBackendRuntime();

    const task = await runtime.createAnalysis(
      [{ timeframe: '15m', image }],
      context,
      { accessToken: 'cloud-token', userId: 'u_cloud', extensionVersion: '1.0.0' },
    );

    expect(task).toMatchObject({ requestId: 'c_cloud', status: 'pending', context });
  });

  it('requires complete Cloud identity before any request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const runtime = new CloudBackendRuntime();

    await expect(runtime.createAnalysis([{ timeframe: '15m', image }], context))
      .rejects.toMatchObject({ code: 'authentication_required' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('discovers public Cloud capabilities without authentication', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      return Response.json(cloudCapabilities);
    });
    vi.stubGlobal('fetch', fetcher);

    await expect(new CloudBackendRuntime().capabilities()).resolves.toEqual(cloudCapabilities);
  });

  it('uses only the Community token even when Cloud identity is supplied', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe(`Bearer ${communityConnection.token}`);
      expect(headers.has('X-ChartViz-Expected-User-Id')).toBe(false);
      return Response.json({
        requestId: 'c_community', status: 'pending', context,
        report: null, errorCode: null, error: null, progressEvents: [],
      });
    });
    const runtime = new CommunityBackendRuntime(
      new CommunityAnalysisClient(communityConnection, fetcher),
      communityConnection.capabilities,
    );

    const task = await runtime.createAnalysis(
      [{ timeframe: '15m', image }], context,
      { accessToken: 'cloud-token', userId: 'u_cloud', extensionVersion: '1.0.0' },
    );

    expect(task).toMatchObject({ requestId: 'c_community', status: 'pending', context });
  });

  it('requires a verified Community connection at runtime creation', () => {
    try {
      createBackendRuntime({ edition: 'community' });
      throw new Error('expected Community connection requirement');
    } catch (error) {
      expect(error).toMatchObject({ code: 'community_connection_required' });
    }
  });

  it('selects Cloud without a Community connection', () => {
    expect(createBackendRuntime({ edition: 'cloud' }).edition).toBe('cloud');
  });
});
