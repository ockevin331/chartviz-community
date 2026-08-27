// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../entrypoints/panel/App';
import type { ChartContext } from '../src/domain/chart-context';
import { attachProviderFailureDetail } from '../src/providers/provider-diagnostics';
import { ProviderError } from '../src/providers/provider-errors';
import type { StructuredVisionProvider } from '../src/providers/provider-types';
import { annotatedImages, communityReport, processedImage } from './community-ui-fixtures';

afterEach(cleanup);

const chartContext: ChartContext = {
  site: 'tradingview', pageType: 'advanced-chart',
  url: 'https://www.tradingview.com/chart/3c8vMvO3/?symbol=BITSTAMP%3ABTCUSD',
  symbol: 'BTCUSD', exchange: 'BITSTAMP', timeframe: '15m',
  chart: { id: 'Chart #1', bounds: { x: 10, y: 60, width: 1100, height: 650 } },
  viewport: { width: 1280, height: 800, devicePixelRatio: 2 },
};

const inspect = async () => chartContext;
const capture = async () => ({ image: processedImage, context: chartContext });
const provider: StructuredVisionProvider = {
  kind: 'openrouter', validateConfig: () => ({ ok: true }), testConnection: async () => undefined,
  generateStructured: async () => { throw new Error('The injected pipeline owns this test boundary.'); },
};
describe('direct Community panel workflow', () => {
  it('runs detected chart → capture → analyzing → completed with one request and no internal detail', async () => {
    const user = userEvent.setup();
    const analyze = vi.fn(async () => communityReport);
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false }),
      inspect,
      capture,
      getProvider: () => provider,
      runAnalysis: analyze,
      buildAnnotations: async () => annotatedImages,
    }} />);
    await screen.findByRole('heading', { name: 'Detected chart' });
    expect(await screen.findByText('BTCUSD')).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Capture and analyze' }));
    await screen.findByText('Reading chart');
    await screen.findByText('Higher lows remain visible.');
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toMatch(/system prompt|payload|json schema|chain-of-thought/i);
  });

  it('keeps the v1 close and drag interactions on the floating panel header', async () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage');
    render(<App dependencies={{ loadConfig: async () => null }} />);
    await screen.findByRole('heading', { name: 'Connect your own vision model' });
    expect(screen.getByRole('heading', { name: 'ChartViz' })).toBeTruthy();
    expect(screen.queryByText('ChartViz Community')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Language' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Refresh' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(postMessage).toHaveBeenCalledWith({ source: 'chartviz', type: 'panel-close' }, '*');
    const header = screen.getByTestId('drag-handle');
    header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, screenX: 20, screenY: 20 }));
    header.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, screenX: 25, screenY: 22 }));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ source: 'chartviz', type: 'panel-drag', dx: 5, dy: 2 }, '*'));
  });

  it('refreshes the panel workflow without reloading the page or calling the provider', async () => {
    const user = userEvent.setup();
    const analyze = vi.fn(async () => communityReport);
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'key', model: 'openai/gpt-5.6-terra', customModel: false }),
      inspect: vi.fn(inspect),
      capture,
      getProvider: () => provider,
      runAnalysis: analyze,
    }} />);
    await screen.findByRole('heading', { name: 'Detected chart' });
    await screen.findByText('BTCUSD');

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();
    await screen.findByText('BTCUSD');
    expect(analyze).not.toHaveBeenCalled();
  });

  it('localizes a malformed provider report without exposing validation or schema details', async () => {
    const user = userEvent.setup();
    const invalidReport = attachProviderFailureDetail(
      new ProviderError('invalid_response', { params: { provider: 'openrouter' } }),
      { stage: 'report_shape', issues: [{ path: 'chart.timeframe', code: 'invalid_type' }] },
    );
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false }),
      inspect,
      capture,
      getProvider: () => provider,
      runAnalysis: async () => { throw invalidReport; },
    }} />);
    await screen.findByRole('heading', { name: 'Detected chart' });
    await user.click(await screen.findByRole('button', { name: 'Capture and analyze' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The model response did not match the required report format.');
    expect(document.body.textContent).not.toMatch(/schemaVersion|private-bad-version|chart\.timeframe|invalid_type|Zod/i);
  });
});
