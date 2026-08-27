// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartAvailabilityError, type CapturedChart } from '../src/capture/active-chart';
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
describe('ChartCaptureSource', () => {
  it('shows waiting state, detected context, and one capture action without upload', async () => {
    const user = userEvent.setup();
    let resolveInspect: ((value: ChartContext) => void) | undefined;
    const inspect = vi.fn(() => new Promise<ChartContext>((resolve) => { resolveInspect = resolve; }));
    const capture = vi.fn(async () => captured);
    const onCaptured = vi.fn();
    render(<ChartCaptureSource language="en" inspect={inspect} capture={capture} onCaptured={onCaptured} />);

    expect(screen.getByRole('status')).toHaveProperty('textContent', expect.stringContaining('Waiting for chart'));
    resolveInspect?.(context);
    expect(await screen.findByText('BTCUSD')).toBeTruthy();
    expect(screen.getByText('BITSTAMP')).toBeTruthy();
    expect(screen.getByText('15m')).toBeTruthy();
    expect(screen.queryByLabelText(/upload/i)).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Capture and analyze' }));
    await waitFor(() => expect(onCaptured).toHaveBeenCalledWith(captured));
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('guides an unsupported domain to ChartViz and supported chart sites without an upload control', async () => {
    const inspect = vi.fn().mockRejectedValue(new ChartAvailabilityError(
      'This site is not supported.',
      { code: 'unsupported_site', onChartVizSite: false },
    ));
    render(<ChartCaptureSource language="en" inspect={inspect} capture={async () => captured} onCaptured={() => undefined} />);

    expect(await screen.findByRole('heading', { name: 'This site is not supported' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Upload a screenshot on ChartViz' })).toHaveProperty(
      'href',
      'https://www.chartviz.xyz/',
    );
    expect(screen.getByRole('link', { name: 'TradingView' })).toBeTruthy();
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
    render(<ChartCaptureSource language="en" inspect={inspect} capture={async () => captured} onCaptured={() => undefined} />);

    expect(await screen.findByRole('heading', { name: 'This page is not a supported chart page' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Binance BTC chart' })).toHaveProperty(
      'href',
      'https://www.binance.com/en/trade/BTC_USDT?type=spot',
    );
    expect(screen.queryByRole('link', { name: 'TradingView' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Upload a screenshot on ChartViz' })).toBeNull();
  });

  it('uses same-page upload wording on the ChartViz domain', async () => {
    const inspect = vi.fn().mockRejectedValue(new ChartAvailabilityError(
      'This site is not supported.',
      { code: 'unsupported_site', onChartVizSite: true },
    ));
    render(<ChartCaptureSource language="en" inspect={inspect} capture={async () => captured} onCaptured={() => undefined} />);

    expect(await screen.findByRole('link', { name: 'Use the screenshot upload area on this page' })).toHaveProperty(
      'href',
      'https://www.chartviz.xyz/',
    );
  });

  it('keeps refresh for a supported chart that is still loading', async () => {
    const user = userEvent.setup();
    const inspect = vi.fn()
      .mockRejectedValueOnce(new Error('The chart is still loading.'))
      .mockResolvedValueOnce(context);
    render(<ChartCaptureSource language="en" inspect={inspect} capture={async () => captured} onCaptured={() => undefined} />);

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('The chart is still loading.'));
    await user.click(screen.getByRole('button', { name: 'Refresh chart detection' }));
    expect(await screen.findByText('BTCUSD')).toBeTruthy();
    expect(inspect).toHaveBeenCalledTimes(2);
  });
});
