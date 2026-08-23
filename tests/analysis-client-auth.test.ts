import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartContext } from '../src/domain/analysis';

const context: ChartContext = {
  site: 'tradingview',
  pageType: 'advanced-chart',
  url: 'https://www.tradingview.com/chart/example/',
  symbol: 'BTCUSD',
  timeframe: '15m',
  chart: { id: 'chart', bounds: { x: 0, y: 0, width: 800, height: 600 } },
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
};

describe('analysis client authorization handoff', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('uses the access token explicitly supplied by the panel', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer current-panel-token');
      expect(headers.get('X-ChartViz-Expected-User-Id')).toBe('user-current');
      expect(headers.get('X-ChartViz-Extension-Version')).toBe('0.9.74');
      expect(init?.credentials).toBe('omit');
      return Response.json({ requestId: 'c_test', status: 'pending', context });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { createChartAnalysisTask } = await import('../src/api/analysis-client');
    const task = await createChartAnalysisTask(
      [{ timeframe: '15m', image: new Blob(['image'], { type: 'image/png' }) }],
      context,
      'current-panel-token',
      { userId: 'user-current', version: '0.9.74' },
    );

    expect(task.requestId).toBe('c_test');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
