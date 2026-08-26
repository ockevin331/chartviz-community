// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CapturedChart } from '../src/capture/active-chart';
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

  it('shows neutral guidance and supported links without a pointless retry on unsupported URLs', async () => {
    const inspect = vi.fn().mockRejectedValue(new Error('This page is not a supported chart URL.'));
    render(<ChartCaptureSource language="en" inspect={inspect} capture={async () => captured} onCaptured={() => undefined} />);

    expect(await screen.findByRole('heading', { name: 'This page is not supported' })).toBeTruthy();
    expect(await screen.findByRole('alert')).not.toHaveProperty('textContent', expect.stringContaining('This page is not a supported chart URL.'));
    expect(screen.getByRole('link', { name: 'TradingView' })).toHaveProperty('href', expect.stringContaining('tradingview.com/chart'));
    expect(screen.queryByRole('button', { name: 'Refresh chart detection' })).toBeNull();
    expect(inspect).toHaveBeenCalledTimes(1);
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
