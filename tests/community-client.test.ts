import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnalysisApiError } from '../src/api/analysis-client';
import { CommunityAnalysisClient } from '../src/api/community-client';
import type { VerifiedCommunityConnection } from '../src/api/community-connection';
import type { ChartContext } from '../src/domain/analysis';

const token = 'local-token-with-32-characters-000';
const connection: VerifiedCommunityConnection = {
  version: 1,
  baseUrl: 'http://127.0.0.1:8000/chartviz',
  token,
  modelId: 'test-model',
  capabilities: {
    edition: 'community', apiVersion: '1', reportSchemaVersion: '1.3',
    limits: { maxImages: 1, maxTimeframes: 1 },
    features: {
      multiTimeframe: false, marketDataFusion: false, advancedAnnotations: false,
      cloudAuthentication: false, billing: false,
    },
  },
};
const context: ChartContext = {
  site: 'tradingview', pageType: 'advanced-chart',
  url: 'https://www.tradingview.com/chart/example/', symbol: 'BTCUSD', exchange: 'BITSTAMP',
  timeframe: '15m', outputLanguage: 'en',
  chart: { id: 'chart', bounds: { x: 0, y: 0, width: 800, height: 600 } },
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
};

describe('Community analysis client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creates one-image multipart requests using the public Community contract', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      requestId: 'c_community', status: 'pending', context,
      report: null, errorCode: null, error: null, progressEvents: [],
    }, { status: 202 }));
    const client = new CommunityAnalysisClient(connection, fetcher);

    const task = await client.createAnalysis(
      [{ timeframe: '15m', image: new Blob(['png'], { type: 'image/png' }) }],
      context,
    );

    expect(task).toEqual({
      requestId: 'c_community', status: 'pending', context,
      report: undefined, error: undefined, progressEvents: [],
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8000/chartviz/v1/analyses');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`);
    expect(new Headers(init?.headers).has('X-ChartViz-Expected-User-Id')).toBe(false);
    const body = init?.body as FormData;
    expect(body.getAll('image')).toHaveLength(1);
    expect(body.getAll('images')).toHaveLength(0);
    expect(JSON.parse(String(body.get('context')))).toMatchObject({
      language: 'en', timeframe: '15m', symbol: 'BTCUSD', site: 'tradingview',
    });
  });

  it('rejects multiple images before making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new CommunityAnalysisClient(connection, fetcher);
    const image = new Blob(['png'], { type: 'image/png' });

    await expect(client.createAnalysis([
      { timeframe: '15m', image },
      { timeframe: '4h', image },
    ], context)).rejects.toMatchObject({ code: 'community_single_image_required' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('gets and cancels tasks through encoded public paths', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      requestId: 'c/id', status: 'cancelled', context,
      report: null, errorCode: 'CV_CANCELLED', error: 'Cancelled.', progressEvents: [],
    }, { status: 200 }));
    const client = new CommunityAnalysisClient(connection, fetcher);

    await client.getAnalysis('c/id');
    await client.cancelAnalysis('c/id');

    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
      ['http://127.0.0.1:8000/chartviz/v1/analyses/c%2Fid', 'GET'],
      ['http://127.0.0.1:8000/chartviz/v1/analyses/c%2Fid', 'DELETE'],
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`);
    }
  });

  it('converts structured Community errors without leaking the response body', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      detail: { code: 'CV_IMAGE_INVALID', message: `bad image ${token}` },
    }, { status: 422 }));
    const client = new CommunityAnalysisClient(connection, fetcher);

    const request = client.createAnalysis(
      [{ timeframe: '15m', image: new Blob(['png'], { type: 'image/png' }) }],
      context,
    );

    await expect(request).rejects.toEqual(expect.objectContaining({
      name: 'AnalysisApiError', code: 'CV_IMAGE_INVALID', message: 'Invalid chart image.',
    }));
    await expect(request).rejects.not.toThrow(token);
  });

  it('validates report schema 1.3 before returning a completed task', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      requestId: 'c_bad', status: 'completed', context,
      report: { schemaVersion: '1.2' }, errorCode: null, error: null, progressEvents: [],
    }));
    const client = new CommunityAnalysisClient(connection, fetcher);

    await expect(client.getAnalysis('c_bad')).rejects.toBeInstanceOf(AnalysisApiError);
    await expect(client.getAnalysis('c_bad')).rejects.toMatchObject({
      code: 'invalid_analysis_response',
    });
  });
});
