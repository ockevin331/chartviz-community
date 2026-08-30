// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisCapabilities } from '../src/analysis/runtime/analysis-runtime';
import { ChartAvailabilityError, type CapturedChart } from '../src/capture/active-chart';
import { CloudConnectionError } from '../src/cloud/cloud-client';
import type { ChartContext } from '../src/domain/chart-context';
import { ChartCaptureSource } from '../src/ui/components/ChartCaptureSource';

afterEach(cleanup);

const context: ChartContext = {
  site: 'tradingview', pageType: 'advanced-chart',
  url: 'https://www.tradingview.com/chart/3c8vMvO3/?symbol=BITSTAMP%3ABTCUSD',
  symbol: 'BTCUSD', exchange: 'BITSTAMP', timeframe: '15m',
  chart: { id: 'Chart #1', bounds: { x: 10, y: 60, width: 1100, height: 650 } },
  viewport: { width: 1280, height: 800, devicePixelRatio: 2 },
};

const captured: CapturedChart = {
  context,
  image: { mediaType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,Y2hhcnQ=', width: 1100, height: 650 },
};
const directCapabilities: AnalysisCapabilities = { multiTimeframe: false, maxTimeframes: 1 };
const cloudCapabilities: AnalysisCapabilities = { multiTimeframe: true, maxTimeframes: 3 };

describe('ChartCaptureSource', () => {
  it('accepts only one capture-and-create flow from two same-batch clicks', async () => {
    let finishCapture!: (value: CapturedChart) => void;
    const capture = vi.fn(() => new Promise<CapturedChart>((resolve) => {
      finishCapture = resolve;
    }));
    const onCaptured = vi.fn();
    render(<ChartCaptureSource
      language="en"
      capabilities={cloudCapabilities}
      inspect={async () => context}
      capture={capture}
      onCaptured={onCaptured}
      onOpenCloudSettings={() => undefined}
    />);

    const button = await screen.findByRole('button', { name: 'Capture and analyze' });
    act(() => {
      button.click();
      button.click();
    });

    expect(button).toHaveProperty('disabled', true);
    expect(capture).toHaveBeenCalledTimes(1);
    finishCapture(captured);
    await waitFor(() => expect(onCaptured).toHaveBeenCalledTimes(1));
  });

  it('shows waiting state, detected context, and one capture action without upload', async () => {
    const user = userEvent.setup();
    let resolveInspect: ((value: ChartContext) => void) | undefined;
    const inspect = vi.fn(() => new Promise<ChartContext>((resolve) => { resolveInspect = resolve; }));
    const capture = vi.fn(async () => captured);
    const onCaptured = vi.fn();
    render(<ChartCaptureSource language="en" capabilities={directCapabilities} inspect={inspect} capture={capture} onCaptured={onCaptured} onOpenCloudSettings={() => undefined} />);

    expect(screen.getByRole('status')).toHaveProperty('textContent', expect.stringContaining('Waiting for chart'));
    resolveInspect?.(context);
    expect(await screen.findByText('BTCUSD')).toBeTruthy();
    expect(screen.getByText('BITSTAMP')).toBeTruthy();
    expect(document.querySelector('.chart-context')?.textContent).toContain('15m');
    expect(screen.getByRole('group', { name: 'Screenshot mode' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Single timeframe/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText(/upload/i)).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Capture and analyze' }));
    await waitFor(() => expect(onCaptured).toHaveBeenCalledWith([captured]));
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('guides an unsupported domain to ChartViz and supported chart sites without an upload control', async () => {
    const inspect = vi.fn().mockRejectedValue(new ChartAvailabilityError(
      'This site is not supported.',
      { code: 'unsupported_site', onChartVizSite: false },
    ));
    render(<ChartCaptureSource language="en" capabilities={directCapabilities} inspect={inspect} capture={async () => captured} onCaptured={() => undefined} onOpenCloudSettings={() => undefined} />);

    expect(await screen.findByRole('heading', { name: 'This site is not supported' })).toBeTruthy();
    const chartVizLink = screen.getByRole('link', { name: 'Analyze charts on ChartViz' });
    expect(chartVizLink).toHaveProperty(
      'href',
      'https://www.chartviz.xyz/',
    );
    expect(screen.getByRole('link', { name: 'TradingView' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '同花顺' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: '10jqka' })).toBeNull();
    const supportedSites = screen.getByLabelText('Supported sites');
    expect(chartVizLink.closest('.chartviz-destination')).not.toBeNull();
    expect(supportedSites.closest('.supported-sites-guidance')).not.toBeNull();
    expect(chartVizLink.closest('.chartviz-destination')?.contains(supportedSites)).toBe(false);
    const okxUrl = new URL(screen.getByRole('link', { name: 'OKX' }).getAttribute('href')!);
    expect(okxUrl.searchParams.get('chartviz')).toBe('open');
    expect(okxUrl.searchParams.get('chartvizLanguage')).toBe('en');
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /upload/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh chart detection' })).toBeNull();
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it('shows one same-site BTC example for a supported domain with the wrong URL', async () => {
    const inspect = vi.fn().mockRejectedValue(new ChartAvailabilityError(
      'This page is not a supported chart URL.',
      {
        code: 'unsupported_url',
        site: 'binance',
        siteName: 'Binance',
        exampleUrl: 'https://www.binance.com/en/trade/BTC_USDT?type=spot',
      },
    ));
    render(<ChartCaptureSource language="en" capabilities={directCapabilities} inspect={inspect} capture={async () => captured} onCaptured={() => undefined} onOpenCloudSettings={() => undefined} />);

    expect(await screen.findByRole('heading', { name: 'This page is not a supported chart page' })).toBeTruthy();
    const exampleUrl = new URL(screen.getByRole('link', { name: 'Open Binance BTC chart' }).getAttribute('href')!);
    expect(exampleUrl.searchParams.get('type')).toBe('spot');
    expect(exampleUrl.searchParams.get('chartviz')).toBe('open');
    expect(exampleUrl.searchParams.get('chartvizLanguage')).toBe('en');
    expect(screen.queryByRole('link', { name: 'TradingView' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Analyze charts on ChartViz' })).toBeNull();
  });

  it('preserves Chinese when opening a supported chart example', async () => {
    const inspect = vi.fn().mockRejectedValue(new ChartAvailabilityError(
      'This site is not supported.',
      { code: 'unsupported_site', onChartVizSite: false },
    ));
    render(<ChartCaptureSource language="zh-CN" capabilities={directCapabilities} inspect={inspect} capture={async () => captured} onCaptured={() => undefined} onOpenCloudSettings={() => undefined} />);

    expect(await screen.findByRole('link', { name: '前往 ChartViz 分析 K 线' })).toBeTruthy();
    const okxUrl = new URL((await screen.findByRole('link', { name: 'OKX' })).getAttribute('href')!);
    expect(okxUrl.searchParams.get('chartviz')).toBe('open');
    expect(okxUrl.searchParams.get('chartvizLanguage')).toBe('zh-CN');
  });

  it('uses same-page upload wording on the ChartViz domain', async () => {
    const inspect = vi.fn().mockRejectedValue(new ChartAvailabilityError(
      'This site is not supported.',
      { code: 'unsupported_site', onChartVizSite: true },
    ));
    render(<ChartCaptureSource language="en" capabilities={directCapabilities} inspect={inspect} capture={async () => captured} onCaptured={() => undefined} onOpenCloudSettings={() => undefined} />);

    expect(await screen.findByRole('link', { name: 'Analyze charts on this page' })).toHaveProperty(
      'href',
      'https://www.chartviz.xyz/',
    );
  });

  it('keeps refresh for a supported chart that is still loading', async () => {
    const user = userEvent.setup();
    const inspect = vi.fn()
      .mockRejectedValueOnce(new Error('The chart is still loading.'))
      .mockResolvedValueOnce(context);
    render(<ChartCaptureSource language="en" capabilities={directCapabilities} inspect={inspect} capture={async () => captured} onCaptured={() => undefined} onOpenCloudSettings={() => undefined} />);

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('The chart is still loading.'));
    await user.click(screen.getByRole('button', { name: 'Refresh chart detection' }));
    expect(await screen.findByText('BTCUSD')).toBeTruthy();
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it('keeps Direct on single and guides multi-timeframe users without capturing', async () => {
    const user = userEvent.setup();
    const capture = vi.fn(async () => captured);
    const openCloudSettings = vi.fn();
    render(<ChartCaptureSource
      language="en"
      capabilities={directCapabilities}
      inspect={async () => context}
      capture={capture}
      onCaptured={() => undefined}
      onOpenCloudSettings={openCloudSettings}
    />);

    await screen.findByText('BTCUSD');
    await user.click(screen.getByRole('button', { name: /Multi-timeframe/ }));
    expect(screen.getByRole('button', { name: /Single timeframe/ }).getAttribute('aria-pressed')).toBe('true');
    expect(capture).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'View Cloud settings' }));
    expect(openCloudSettings).toHaveBeenCalledTimes(1);
  });

  it('loads website-managed timeframes only after Analyze and captures their returned order', async () => {
    const user = userEvent.setup();
    const capture = vi.fn(async () => captured);
    const multiCaptures = (['1d', '4h', '5m'] as const).map((timeframe) => ({
      ...captured,
      context: { ...context, timeframe },
    }));
    let finishCapture!: (captures: readonly CapturedChart[]) => void;
    const captureMany = vi.fn(() => new Promise<readonly CapturedChart[]>((resolve) => {
      finishCapture = resolve;
    }));
    const loadMultiTimeframes = vi.fn(async () => ['1d', '4h', '5m'] as const);
    const onCaptured = vi.fn();
    render(<ChartCaptureSource
      language="en"
      capabilities={cloudCapabilities}
      inspect={async () => context}
      capture={capture}
      captureMany={captureMany}
      loadMultiTimeframes={loadMultiTimeframes}
      onCaptured={onCaptured}
      onOpenCloudSettings={() => undefined}
    />);

    await screen.findByText('BTCUSD');
    await user.click(screen.getByRole('button', { name: /Multi-timeframe/ }));

    expect(screen.getByRole('button', { name: /Multi-timeframe/ }).getAttribute('aria-pressed')).toBe('true');
    expect(loadMultiTimeframes).not.toHaveBeenCalled();
    expect(screen.queryByText('1d')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('page may briefly flicker');
    await user.click(screen.getByRole('button', { name: 'Capture and analyze' }));
    await waitFor(() => expect(loadMultiTimeframes).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /Single timeframe/ })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /Multi-timeframe/ })).toHaveProperty('disabled', true);
    finishCapture(multiCaptures);
    await waitFor(() => expect(onCaptured).toHaveBeenCalledWith(multiCaptures));
    expect(captureMany).toHaveBeenCalledWith(['1d', '4h', '5m'], expect.any(AbortSignal));
    expect(screen.getByText('1d')).toBeTruthy();
    expect(screen.getByText('4h')).toBeTruthy();
    expect(screen.getByText('5m')).toBeTruthy();
    expect(capture).not.toHaveBeenCalled();
  });

  it('shows localized paid-plan guidance and preserves its pricing URL when settings reject before capture', async () => {
    const user = userEvent.setup();
    const captureMany = vi.fn(async () => [captured]);
    render(<ChartCaptureSource
      language="en"
      capabilities={cloudCapabilities}
      inspect={async () => context}
      capture={async () => captured}
      captureMany={captureMany}
      loadMultiTimeframes={async () => {
        throw new CloudConnectionError(
          'multi_timeframe_requires_advance',
          {},
          'https://www.chartviz.xyz/#pricing',
        );
      }}
      onCaptured={() => undefined}
      onOpenCloudSettings={() => undefined}
    />);

    await screen.findByText('BTCUSD');
    await user.click(screen.getByRole('button', { name: /Multi-timeframe/ }));
    await user.click(screen.getByRole('button', { name: 'Capture and analyze' }));

    expect((await screen.findByRole('alert')).textContent).toContain('An active ChartViz plan is required for multi-timeframe analysis.');
    expect(screen.getByRole('link', { name: 'View plans' })).toHaveProperty(
      'href',
      'https://www.chartviz.xyz/#pricing',
    );
    expect(captureMany).not.toHaveBeenCalled();
  });

  it('keeps multi unavailable on 10jqka even for a capable runtime', async () => {
    const stockContext: ChartContext = {
      ...context,
      site: '10jqka',
      pageType: 'stock-trade',
      url: 'https://stockpage.10jqka.com.cn/000001/',
      symbol: '000001',
      exchange: 'SZSE',
    };
    render(<ChartCaptureSource
      language="en"
      capabilities={cloudCapabilities}
      inspect={async () => stockContext}
      capture={async () => ({ ...captured, context: stockContext })}
      onCaptured={() => undefined}
      onOpenCloudSettings={() => undefined}
    />);

    await screen.findByText('000001');
    expect(screen.getByRole('button', { name: /Multi-timeframe/ }).getAttribute('aria-disabled')).toBe('true');
  });
});
