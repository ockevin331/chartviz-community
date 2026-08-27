// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../entrypoints/panel/App';
import { ChartAvailabilityError } from '../src/capture/active-chart';
import { unavailableCloudGateway } from '../src/cloud/cloud-gateway';
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
const directModeDependencies = {
  loadMode: async () => 'direct' as const,
  saveMode: async () => undefined,
  cloudGateway: unavailableCloudGateway,
};
describe('direct Community panel workflow', () => {
  it('defaults a new installation to the unavailable Cloud tab without inspecting the page', async () => {
    const inspectPage = vi.fn(inspect);
    render(<App dependencies={{
      loadConfig: async () => null,
      loadMode: async () => 'cloud',
      saveMode: async () => undefined,
      cloudGateway: unavailableCloudGateway,
      inspect: inspectPage,
    }} />);

    expect(await screen.findByRole('tab', { name: 'ChartViz Cloud' })).toHaveProperty('ariaSelected', 'true');
    expect(screen.getByText('Cloud connection will be enabled in a later update.')).toBeTruthy();
    expect(screen.queryByLabelText('API key')).toBeNull();
    expect(inspectPage).not.toHaveBeenCalled();
  });

  it('opens Direct setup when its mode is saved but the session key has expired', async () => {
    render(<App dependencies={{
      loadConfig: async () => null,
      ...directModeDependencies,
    }} />);

    expect(await screen.findByRole('tab', { name: 'Direct model' })).toHaveProperty('ariaSelected', 'true');
    expect(screen.getByLabelText('API key')).toBeTruthy();
  });

  it('guides an unsupported site to ChartViz without invoking analysis', async () => {
    const analyze = vi.fn(async () => communityReport);
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false }),
      ...directModeDependencies,
      inspect: async () => {
        throw new ChartAvailabilityError(
          'This site is not supported.',
          { code: 'unsupported_site', onChartVizSite: false },
        );
      },
      getProvider: () => provider,
      runAnalysis: analyze,
      buildAnnotations: async () => annotatedImages,
    }} />);

    expect(await screen.findByRole('link', { name: 'Upload a screenshot on ChartViz' })).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(analyze).not.toHaveBeenCalled();
  });

  it('starts the three-stage pipeline after capture and exposes no internal detail', async () => {
    const user = userEvent.setup();
    const analyze = vi.fn(async () => communityReport);
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false }),
      ...directModeDependencies,
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
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({
      provider,
      context: expect.objectContaining({ instrument: 'BTCUSD', timeframe: '15m' }),
      outputLanguage: 'en',
    }));
    expect(document.body.textContent).not.toMatch(/system prompt|payload|json schema|chain-of-thought/i);
  });


  it('restarts the three-stage pipeline only when the user explicitly retries a failure', async () => {
    const user = userEvent.setup();
    const analyze = vi.fn()
      .mockRejectedValueOnce(new ProviderError('network_timeout', { params: { provider: 'openrouter' } }))
      .mockResolvedValueOnce(communityReport);
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false }),
      ...directModeDependencies,
      inspect,
      capture,
      getProvider: () => provider,
      runAnalysis: analyze,
      buildAnnotations: async () => annotatedImages,
    }} />);

    await screen.findByRole('heading', { name: 'Detected chart' });
    await screen.findByText('BTCUSD');
    await user.click(screen.getByRole('button', { name: 'Capture and analyze' }));
    await screen.findByRole('alert');
    expect(analyze).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Higher lows remain visible.');
    expect(analyze).toHaveBeenCalledTimes(2);
  });

  it('keeps the v1 close and drag interactions on the floating panel header', async () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage');
    render(<App dependencies={{
      loadConfig: async () => null,
      loadMode: async () => 'cloud',
      saveMode: async () => undefined,
      cloudGateway: unavailableCloudGateway,
    }} />);
    await screen.findByRole('heading', { name: 'Managed chart analysis' });
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
      ...directModeDependencies,
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

  it('opens the current model settings, saves changes, and returns to the chart', async () => {
    const user = userEvent.setup();
    const saveConfig = vi.fn(async () => undefined);
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'existing-key', model: 'openai/gpt-5.6-terra', customModel: false }),
      ...directModeDependencies,
      saveConfig,
      inspect,
      capture,
      getProvider: () => provider,
      runAnalysis: async () => communityReport,
    }} />);
    await screen.findByRole('heading', { name: 'Detected chart' });

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('dialog', { name: 'Analysis settings' })).toBeTruthy();
    expect(screen.getByLabelText('API key')).toHaveProperty('value', 'existing-key');
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveProperty('textContent', expect.stringContaining('openai/gpt-5.6-terra'));

    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.click(screen.getByRole('option', { name: /qwen\/qwen3\.7-plus/i }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(saveConfig).toHaveBeenCalledWith({
      provider: 'openrouter', apiKey: 'existing-key', model: 'qwen/qwen3.7-plus', customModel: false,
    }));
    expect(screen.queryByRole('dialog', { name: 'Analysis settings' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Detected chart' })).toBeTruthy();
  });

  it('lets a Direct user inspect Cloud settings without activating or clearing Direct', async () => {
    const user = userEvent.setup();
    const saveConfig = vi.fn(async () => undefined);
    const saveMode = vi.fn(async () => undefined);
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'existing-key', model: 'openai/gpt-5.6-terra', customModel: false }),
      loadMode: async () => 'direct',
      saveMode,
      cloudGateway: unavailableCloudGateway,
      saveConfig,
      inspect,
      capture,
      getProvider: () => provider,
    }} />);
    await screen.findByRole('heading', { name: 'Detected chart' });

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('tab', { name: 'Direct model' })).toHaveProperty('ariaSelected', 'true');
    await user.click(screen.getByRole('tab', { name: 'ChartViz Cloud' }));
    expect(screen.getByText('Cloud connection will be enabled in a later update.')).toBeTruthy();
    expect(saveConfig).not.toHaveBeenCalled();
    expect(saveMode).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog', { name: 'Analysis settings' });
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('tab', { name: 'Direct model' })).toHaveProperty('ariaSelected', 'true');
    expect(screen.getByLabelText('API key')).toHaveProperty('value', 'existing-key');
  });

  it('persists Direct config and mode before entering chart capture', async () => {
    const user = userEvent.setup();
    const events: string[] = [];
    render(<App dependencies={{
      loadConfig: async () => null,
      loadMode: async () => 'cloud',
      saveMode: async () => { events.push('mode'); },
      cloudGateway: unavailableCloudGateway,
      saveConfig: async () => { events.push('config'); },
      inspect,
      capture,
      getProvider: () => provider,
    }} />);
    await screen.findByRole('tab', { name: 'ChartViz Cloud' });

    await user.click(screen.getByRole('tab', { name: 'Direct model' }));
    await user.type(screen.getByLabelText('API key'), 'session-secret');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    await screen.findByRole('heading', { name: 'Detected chart' });
    expect(events).toEqual(['config', 'mode']);
  });

  it('localizes a malformed provider report without exposing validation or schema details', async () => {
    const user = userEvent.setup();
    const invalidReport = attachProviderFailureDetail(
      new ProviderError('invalid_response', { params: { provider: 'openrouter' } }),
      { stage: 'report_shape', issues: [{ path: 'chart.timeframe', code: 'invalid_type' }] },
    );
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false }),
      ...directModeDependencies,
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
