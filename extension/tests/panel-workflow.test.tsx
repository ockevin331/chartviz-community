// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../entrypoints/panel/App';
import {
  AnalysisRuntimeFailure,
  type AnalysisRuntime,
  type AnalysisRuntimeInput,
  type AnalysisRuntimeOutcome,
} from '../src/analysis/runtime/analysis-runtime';
import { ChartAvailabilityError } from '../src/capture/active-chart';
import { unavailableCloudGateway } from '../src/cloud/cloud-gateway';
import type { CloudAnalysisGateway } from '../src/cloud/cloud-gateway';
import type { ChartContext } from '../src/domain/chart-context';
import type { AnalysisDiagnostic } from '../src/providers/provider-diagnostics';
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
const multiCaptures = (['4h', '1h', '15m'] as const).map((timeframe, index) => ({
  image: { ...processedImage, dataUrl: `${processedImage.dataUrl}-${index}` },
  context: { ...chartContext, timeframe },
}));
const outcome: AnalysisRuntimeOutcome = { report: communityReport, annotations: annotatedImages };

function fakeRuntime(
  analyzeImplementation: (input: AnalysisRuntimeInput) => Promise<AnalysisRuntimeOutcome>
    = async () => outcome,
): AnalysisRuntime & {
  analyze: ReturnType<typeof vi.fn<(input: AnalysisRuntimeInput) => Promise<AnalysisRuntimeOutcome>>>;
  cancel: ReturnType<typeof vi.fn<() => void>>;
} {
  return {
    mode: 'direct',
    capabilities: () => ({ multiTimeframe: false, maxTimeframes: 1 }),
    analyze: vi.fn(analyzeImplementation),
    cancel: vi.fn(),
  };
}

function fakeCloudRuntime(): AnalysisRuntime & {
  analyze: ReturnType<typeof vi.fn<(input: AnalysisRuntimeInput) => Promise<AnalysisRuntimeOutcome>>>;
  cancel: ReturnType<typeof vi.fn<() => void>>;
} {
  return {
    mode: 'cloud',
    capabilities: () => ({ multiTimeframe: true, maxTimeframes: 3 }),
    analyze: vi.fn(async () => outcome),
    cancel: vi.fn(),
  };
}

const directModeDependencies = {
  loadMode: async () => 'direct' as const,
  saveMode: async () => undefined,
  cloudGateway: unavailableCloudGateway,
  testDirectConnection: async () => undefined,
};
describe('direct Community panel workflow', () => {
  it('defaults a new installation to the unavailable Cloud tab without inspecting the page', async () => {
    const inspectPage = vi.fn(inspect);
    const createDirectRuntime = vi.fn(() => fakeRuntime());
    render(<App dependencies={{
      loadConfig: async () => null,
      loadMode: async () => 'cloud',
      saveMode: async () => undefined,
      cloudGateway: unavailableCloudGateway,
      createDirectRuntime,
      inspect: inspectPage,
    }} />);

    expect(await screen.findByRole('tab', { name: 'ChartViz Cloud' })).toHaveProperty('ariaSelected', 'true');
    expect(screen.getByText('Cloud connection will be enabled in a later update.')).toBeTruthy();
    expect(screen.queryByLabelText('API key')).toBeNull();
    expect(inspectPage).not.toHaveBeenCalled();
    expect(createDirectRuntime).not.toHaveBeenCalled();
  });

  it('keeps Direct single-frame and opens Cloud settings from multi-timeframe guidance', async () => {
    const user = userEvent.setup();
    const captureChart = vi.fn(capture);
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false }),
      ...directModeDependencies,
      inspect,
      capture: captureChart,
      createDirectRuntime: () => fakeRuntime(),
    }} />);

    await screen.findByText('BTCUSD');
    await user.click(screen.getByRole('button', { name: /Multi-timeframe/ }));
    expect(screen.getByRole('button', { name: /Single timeframe/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Multi-timeframe analysis is available through ChartViz Cloud.');
    expect(captureChart).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'View Cloud settings' }));
    expect(screen.getByRole('dialog', { name: 'Analysis settings' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'ChartViz Cloud' })).toHaveProperty('ariaSelected', 'true');
  });

  it('captures and submits three ordered timeframes to an available injected Cloud runtime', async () => {
    const user = userEvent.setup();
    const runtime = fakeCloudRuntime();
    const captureMany = vi.fn(async () => multiCaptures);
    const cloudGateway: CloudAnalysisGateway = {
      availability: () => ({ available: true }),
      runtime: () => runtime,
    };
    const createDirectRuntime = vi.fn(() => fakeRuntime());
    render(<App dependencies={{
      loadConfig: async () => null,
      loadMode: async () => 'cloud',
      saveMode: async () => undefined,
      cloudGateway,
      createDirectRuntime,
      inspect,
      capture,
      captureMany,
    }} />);

    await screen.findByText('BTCUSD');
    await user.click(screen.getByRole('button', { name: /Multi-timeframe/ }));
    expect(screen.getByRole('button', { name: /Multi-timeframe/ }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Capture and analyze' }));

    await waitFor(() => expect(runtime.analyze).toHaveBeenCalledTimes(1));
    expect(captureMany).toHaveBeenCalledWith(['4h', '1h', '15m'], expect.any(AbortSignal));
    expect(runtime.analyze).toHaveBeenCalledWith(expect.objectContaining({
      captures: multiCaptures.map((captured) => ({
        image: captured.image,
        context: { instrument: 'BTCUSD', timeframe: captured.context.timeframe },
      })),
    }));
    expect(createDirectRuntime).not.toHaveBeenCalled();
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
    const runtime = fakeRuntime();
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false }),
      ...directModeDependencies,
      inspect: async () => {
        throw new ChartAvailabilityError(
          'This site is not supported.',
          { code: 'unsupported_site', onChartVizSite: false },
        );
      },
      createDirectRuntime: () => runtime,
    }} />);

    expect(await screen.findByRole('link', { name: 'Upload a screenshot on ChartViz' })).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(runtime.analyze).not.toHaveBeenCalled();
  });

  it('starts the active runtime after capture and exposes no internal detail', async () => {
    const user = userEvent.setup();
    const runtime = fakeRuntime();
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false }),
      ...directModeDependencies,
      inspect,
      capture,
      createDirectRuntime: () => runtime,
    }} />);
    await screen.findByRole('heading', { name: 'Detected chart' });
    expect(await screen.findByText('BTCUSD')).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Capture and analyze' }));
    await screen.findByText('Higher lows remain visible.');
    expect(runtime.analyze).toHaveBeenCalledTimes(1);
    expect(runtime.analyze).toHaveBeenCalledWith(expect.objectContaining({
      captures: [expect.objectContaining({
        context: { instrument: 'BTCUSD', timeframe: '15m' },
      })],
      outputLanguage: 'en',
    }));
    expect(document.body.textContent).not.toMatch(/system prompt|payload|json schema|chain-of-thought/i);
  });

  it('restarts the active runtime only when the user explicitly retries a failure', async () => {
    const user = userEvent.setup();
    const runtime = fakeRuntime(vi.fn()
      .mockRejectedValueOnce(new AnalysisRuntimeFailure('network_timeout'))
      .mockResolvedValueOnce(outcome));
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false }),
      ...directModeDependencies,
      inspect,
      capture,
      createDirectRuntime: () => runtime,
    }} />);

    await screen.findByRole('heading', { name: 'Detected chart' });
    await screen.findByText('BTCUSD');
    await user.click(screen.getByRole('button', { name: 'Capture and analyze' }));
    await screen.findByRole('alert');
    expect(runtime.analyze).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Higher lows remain visible.');
    expect(runtime.analyze).toHaveBeenCalledTimes(2);
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
    const runtime = fakeRuntime();
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'key', model: 'openai/gpt-5.6-terra', customModel: false }),
      ...directModeDependencies,
      inspect: vi.fn(inspect),
      capture,
      createDirectRuntime: () => runtime,
    }} />);
    await screen.findByRole('heading', { name: 'Detected chart' });
    await screen.findByText('BTCUSD');

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();
    await screen.findByText('BTCUSD');
    expect(runtime.analyze).not.toHaveBeenCalled();
  });

  it('opens the current model settings, saves changes, and returns to the chart', async () => {
    const user = userEvent.setup();
    const saveConfig = vi.fn(async () => undefined);
    const firstRuntime = fakeRuntime();
    const updatedRuntime = fakeRuntime();
    const createDirectRuntime = vi.fn()
      .mockReturnValueOnce(firstRuntime)
      .mockReturnValueOnce(updatedRuntime);
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'existing-key', model: 'openai/gpt-5.6-terra', customModel: false }),
      ...directModeDependencies,
      saveConfig,
      inspect,
      capture,
      createDirectRuntime,
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
    expect(createDirectRuntime).toHaveBeenNthCalledWith(1, expect.objectContaining({ model: 'openai/gpt-5.6-terra' }));
    expect(createDirectRuntime).toHaveBeenNthCalledWith(2, expect.objectContaining({ model: 'qwen/qwen3.7-plus' }));
    expect(firstRuntime.cancel).not.toHaveBeenCalled();
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
      createDirectRuntime: () => fakeRuntime(),
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
      createDirectRuntime: () => {
        events.push('runtime');
        return fakeRuntime();
      },
      testDirectConnection: async () => undefined,
    }} />);
    await screen.findByRole('tab', { name: 'ChartViz Cloud' });

    await user.click(screen.getByRole('tab', { name: 'Direct model' }));
    await user.type(screen.getByLabelText('API key'), 'session-secret');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    await screen.findByRole('heading', { name: 'Detected chart' });
    expect(events).toEqual(['config', 'mode', 'runtime']);
  });

  it('localizes a malformed runtime report without exposing validation or schema details', async () => {
    const user = userEvent.setup();
    const diagnostic: AnalysisDiagnostic = {
      source: 'extension_local',
      pipelineVersion: 'community-3.0',
      requestId: 'safe-runtime-id',
      provider: 'openrouter',
      model: 'google/gemini-3.7-flash',
      stage: 'report_shape',
      occurredAt: '2026-08-27T00:00:00.000Z',
      durationMs: 25,
      issues: [{ path: 'chart.timeframe', code: 'invalid_type' }],
    };
    const runtime = fakeRuntime(async () => {
      throw new AnalysisRuntimeFailure('invalid_response', diagnostic);
    });
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false }),
      ...directModeDependencies,
      inspect,
      capture,
      createDirectRuntime: () => runtime,
    }} />);
    await screen.findByRole('heading', { name: 'Detected chart' });
    await user.click(await screen.findByRole('button', { name: 'Capture and analyze' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The model response did not match the required report format.');
    expect(document.body.textContent).not.toMatch(/schemaVersion|private-bad-version|chart\.timeframe|invalid_type|Zod/i);
  });
});
