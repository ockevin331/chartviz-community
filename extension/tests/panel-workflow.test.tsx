// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
import type { CloudConnectionManager } from '../src/cloud/cloud-connection';
import type { StoredCloudConnection } from '../src/storage/cloud-connection-storage';
import type { ChartContext } from '../src/domain/chart-context';
import type { AnalysisDiagnostic } from '../src/providers/provider-diagnostics';
import type { ProviderConfig } from '../src/providers/provider-types';
import { parseReportPresentationModel } from '../src/presentation/report-presentation-model';
import { presentationAnnotatedImages, processedImage } from './community-ui-fixtures';
import { validPresentationBundle } from './presentation-fixtures';

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
const outcome: AnalysisRuntimeOutcome = {
  captures: [{
    image: processedImage,
    context: {
      instrument: chartContext.symbol ?? null,
      timeframe: chartContext.timeframe ?? null,
      site: chartContext.site,
      exchange: chartContext.exchange,
      pageType: chartContext.pageType,
    },
  }],
  presentation: parseReportPresentationModel(structuredClone(validPresentationBundle.report)),
  annotations: presentationAnnotatedImages,
};
const disconnectedCloudManager: CloudConnectionManager = {
  load: async () => ({ status: 'disconnected', account: null, errorCode: null }),
  connect: async () => ({ status: 'disconnected', account: null, errorCode: null }),
  disconnect: async () => ({ status: 'disconnected', account: null, errorCode: null }),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function connectedCloudManager(): CloudConnectionManager {
  return {
    load: vi.fn(async () => ({
      status: 'connected' as const,
      errorCode: null,
      account: {
        emailMasked: 'a***z@example.com', plan: 'pro' as const,
        currentPeriodEnd: '2026-09-28T00:00:00+00:00',
        quota: { limit: 50, used: 1, remaining: 49, unlimited: false },
        selectedModel: { id: 'openai/gpt-5.4', name: 'GPT-5.4', quotaCost: 1 },
        entitlements: { multiTimeframe: true, maxCaptures: 3 },
      },
    })),
    connect: disconnectedCloudManager.connect,
    disconnect: disconnectedCloudManager.disconnect,
  };
}

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
  cloudConnectionManager: disconnectedCloudManager,
  testDirectConnection: async () => undefined,
};
describe('direct Community panel workflow', () => {
  it('restores the selected language after the panel is reopened', async () => {
    const user = userEvent.setup();
    let storedLanguage: 'en' | 'zh-CN' = 'en';
    const dependencies = {
      loadConfig: async () => null,
      loadMode: async () => 'cloud' as const,
      saveMode: async () => undefined,
      loadLanguage: async () => storedLanguage,
      saveLanguage: async (language: 'en' | 'zh-CN') => { storedLanguage = language; },
      cloudGateway: unavailableCloudGateway,
      cloudConnectionManager: disconnectedCloudManager,
    };
    const first = render(<App dependencies={dependencies} />);

    await screen.findByLabelText('Cloud access token');
    await user.click(screen.getByRole('button', { name: 'Language' }));
    await user.click(screen.getByRole('menuitemradio', { name: '🇨🇳 CN 简体中文' }));
    expect(await screen.findByLabelText('Cloud 访问令牌')).toBeTruthy();

    first.unmount();
    render(<App dependencies={dependencies} />);

    expect(await screen.findByLabelText('Cloud 访问令牌')).toBeTruthy();
  });

  it('defaults a new installation to Cloud connection setup without inspecting the page', async () => {
    const inspectPage = vi.fn(inspect);
    const createDirectRuntime = vi.fn(() => fakeRuntime());
    render(<App dependencies={{
      loadConfig: async () => null,
      loadMode: async () => 'cloud',
      saveMode: async () => undefined,
      cloudGateway: unavailableCloudGateway,
      cloudConnectionManager: disconnectedCloudManager,
      createDirectRuntime,
      inspect: inspectPage,
    }} />);

    expect(await screen.findByRole('tab', { name: 'ChartViz Cloud' })).toHaveProperty('ariaSelected', 'true');
    expect(screen.getByLabelText('Cloud access token')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect and set as default' })).toBeTruthy();
    expect(screen.queryByLabelText('API key')).toBeNull();
    expect(inspectPage).not.toHaveBeenCalled();
    expect(createDirectRuntime).not.toHaveBeenCalled();
  });

  it('connects Cloud, saves the mode, and activates chart capture', async () => {
    const user = userEvent.setup();
    const saveMode = vi.fn(async () => undefined);
    const connect = vi.fn(async () => ({
      status: 'connected' as const, errorCode: null,
      account: {
        emailMasked: 'k***n@example.com', plan: 'pro' as const,
        currentPeriodEnd: '2026-09-28T00:00:00+00:00',
          quota: { limit: 50, used: 2, remaining: 48, unlimited: false },
          selectedModel: { id: 'openai/gpt-5.6-terra', name: 'GPT-5.6 Terra', quotaCost: 1 },
          entitlements: { multiTimeframe: true, maxCaptures: 3 },
      },
    }));
    const manager: CloudConnectionManager = {
      load: disconnectedCloudManager.load,
      connect,
      disconnect: disconnectedCloudManager.disconnect,
    };
    const inspectPage = vi.fn(inspect);
    const runtime = fakeCloudRuntime();
    const cloudGateway: CloudAnalysisGateway = {
      availability: () => ({ available: true }),
      runtime: () => runtime,
    };
    render(<App dependencies={{
      loadConfig: async () => null,
      loadMode: async () => 'cloud',
      saveMode,
      cloudGateway,
      cloudConnectionManager: manager,
      inspect: inspectPage,
    }} />);

    const token = `cv_live_${'x'.repeat(43)}`;
    await user.type(await screen.findByLabelText('Cloud access token'), token);
    await user.click(screen.getByRole('button', { name: 'Connect and set as default' }));

    expect(connect).toHaveBeenCalledWith(token);
    expect(saveMode).toHaveBeenCalledWith('cloud');
    expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();
    expect(inspectPage).toHaveBeenCalled();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('loads a stored Cloud account and activates its runtime', async () => {
    const createDirectRuntime = vi.fn(() => fakeRuntime());
    const manager: CloudConnectionManager = {
      load: vi.fn(async () => ({
        status: 'connected' as const, errorCode: null,
        account: {
          emailMasked: 'a***z@example.com', plan: 'free' as const,
          currentPeriodEnd: null,
          quota: { limit: 1, used: 0, remaining: 1, unlimited: false },
          selectedModel: { id: 'openai/gpt-5.6-terra', name: 'GPT-5.6 Terra', quotaCost: 1 },
          entitlements: { multiTimeframe: false, maxCaptures: 1 },
        },
      })),
      connect: disconnectedCloudManager.connect,
      disconnect: disconnectedCloudManager.disconnect,
    };
    const runtime = fakeCloudRuntime();
    render(<App dependencies={{
      loadConfig: async () => null,
      loadMode: async () => 'cloud',
      saveMode: async () => undefined,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => runtime,
      },
      cloudConnectionManager: manager,
      createDirectRuntime,
      inspect,
    }} />);

    expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();
    expect(manager.load).toHaveBeenCalledTimes(1);
    expect(createDirectRuntime).not.toHaveBeenCalled();
    expect(runtime.analyze).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
  });

  it('shows a connected Cloud account menu whose navigation opens the website', async () => {
    const user = userEvent.setup();
    const runtime = fakeCloudRuntime();
    render(<App dependencies={{
      loadConfig: async () => null,
      loadMode: async () => 'cloud',
      saveMode: async () => undefined,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => runtime,
      },
      cloudConnectionManager: connectedCloudManager(),
      inspect,
    }} />);

    await screen.findByRole('heading', { name: 'Detected chart' });
    await user.click(screen.getByRole('button', { name: 'Account' }));

    const menu = screen.getByRole('menu', { name: 'Account' });
    expect(within(menu).getByText('a***z@example.com')).toBeTruthy();
    expect(within(menu).getByText('Pro')).toBeTruthy();
    expect(within(menu).getByText('49 / 50')).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Analysis list' })).toHaveProperty(
      'href', 'https://www.chartviz.xyz/analyzers',
    );
    expect(within(menu).getByRole('menuitem', { name: 'Profile' })).toHaveProperty(
      'href', 'https://www.chartviz.xyz/profile',
    );
    expect(within(menu).getByRole('menuitem', { name: 'Cloud settings' })).toHaveProperty(
      'href', 'https://www.chartviz.xyz/settings',
    );
  });

  it('does not show the Cloud account menu while Direct model is active', async () => {
    render(<App dependencies={{
      loadConfig: async () => ({
        provider: 'openrouter', apiKey: 'key',
        model: 'google/gemini-3.7-flash', customModel: false,
      }),
      loadMode: async () => 'direct',
      saveMode: async () => undefined,
      cloudGateway: unavailableCloudGateway,
      cloudConnectionManager: connectedCloudManager(),
      createDirectRuntime: () => fakeRuntime(),
      inspect,
    }} />);

    await screen.findByRole('heading', { name: 'Detected chart' });
    expect(screen.queryByRole('button', { name: 'Account' })).toBeNull();
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

  it('loads the stored Cloud token settings immediately before multi capture', async () => {
    const user = userEvent.setup();
    const runtime = fakeCloudRuntime();
    const captureMany = vi.fn(async (timeframes: readonly ('5m' | '15m' | '1h' | '4h' | '1d')[]) => timeframes.map((timeframe, index) => ({
      ...multiCaptures[index]!,
      context: { ...multiCaptures[index]!.context, timeframe },
    })));
    const cloudGateway: CloudAnalysisGateway = {
      availability: () => ({ available: true }),
      runtime: () => runtime,
    };
    const createDirectRuntime = vi.fn(() => fakeRuntime());
    const token = `cv_live_${'a'.repeat(43)}`;
    const loadCloudConnection = vi.fn(async (): Promise<StoredCloudConnection> => ({
      token,
      account: {
        emailMasked: 'a***z@example.com', plan: 'advance',
        currentPeriodEnd: '2026-09-28T00:00:00+00:00',
        quota: { limit: null, used: 3, remaining: null, unlimited: true },
        selectedModel: { id: 'openai/gpt-5.4', name: 'GPT-5.4', quotaCost: 2 },
        entitlements: { multiTimeframe: true, maxCaptures: 3 },
      },
    }));
    const captureSettings = vi.fn(async (loadedToken: string) => {
      expect(loadedToken).toBe(token);
      return { timeframes: [
        { role: 'context' as const, timeframe: '1d' },
        { role: 'setup' as const, timeframe: '4h' },
        { role: 'trigger' as const, timeframe: '5m' },
      ] };
    });
    render(<App dependencies={{
      loadConfig: async () => null,
      loadMode: async () => 'cloud',
      saveMode: async () => undefined,
      cloudGateway,
      cloudConnectionManager: {
        load: async () => ({
          status: 'connected', errorCode: null,
          account: {
            emailMasked: 'a***z@example.com', plan: 'advance',
            currentPeriodEnd: '2026-09-28T00:00:00+00:00',
            quota: { limit: null, used: 3, remaining: null, unlimited: true },
            selectedModel: { id: 'openai/gpt-5.4', name: 'GPT-5.4', quotaCost: 2 },
            entitlements: { multiTimeframe: true, maxCaptures: 3 },
          },
        }),
        connect: disconnectedCloudManager.connect,
        disconnect: disconnectedCloudManager.disconnect,
      },
      createDirectRuntime,
      inspect,
      capture,
      captureMany,
      loadCloudConnection,
      cloudClient: { captureSettings },
    }} />);

    await screen.findByText('BTCUSD');
    await user.click(screen.getByRole('button', { name: /Multi-timeframe/ }));
    expect(screen.getByRole('button', { name: /Multi-timeframe/ }).getAttribute('aria-pressed')).toBe('true');
    expect(loadCloudConnection).not.toHaveBeenCalled();
    expect(captureSettings).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Capture and analyze' }));

    await waitFor(() => expect(runtime.analyze).toHaveBeenCalledTimes(1));
    expect(loadCloudConnection).toHaveBeenCalledTimes(1);
    expect(captureSettings).toHaveBeenCalledWith(token);
    expect(captureMany).toHaveBeenCalledWith(['1d', '4h', '5m'], expect.any(AbortSignal));
    expect(runtime.analyze).toHaveBeenCalledWith(expect.objectContaining({
      captures: [
        expect.objectContaining({ context: expect.objectContaining({ timeframe: '1d' }) }),
        expect.objectContaining({ context: expect.objectContaining({ timeframe: '4h' }) }),
        expect.objectContaining({ context: expect.objectContaining({ timeframe: '5m' }) }),
      ],
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

  it('hides the image download action while the scanning animation is active', async () => {
    const user = userEvent.setup();
    let resolveAnalysis!: (value: AnalysisRuntimeOutcome) => void;
    const pending = new Promise<AnalysisRuntimeOutcome>((resolve) => { resolveAnalysis = resolve; });
    const runtime = fakeRuntime(() => pending);
    render(<App dependencies={{
      loadConfig: async () => ({ provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false }),
      ...directModeDependencies,
      inspect,
      capture,
      createDirectRuntime: () => runtime,
    }} />);

    await screen.findByRole('heading', { name: 'Detected chart' });
    await screen.findByText('BTCUSD');
    await user.click(await screen.findByRole('button', { name: 'Capture and analyze' }));
    await screen.findByText('Preparing the analysis…');

    expect(screen.queryByRole('button', { name: /Download image/ })).toBeNull();
    resolveAnalysis(outcome);
    await screen.findByText('Higher lows remain visible.');
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
        context: {
          instrument: 'BTCUSD', timeframe: '15m', site: 'tradingview',
          exchange: 'BITSTAMP', pageType: 'advanced-chart',
        },
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
    expect(screen.getByRole('img', { name: 'ChartViz logo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Language' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Back to chart' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Detected chart' })).toBeNull();
    expect(screen.getByLabelText('API key')).toHaveProperty('value', 'existing-key');
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveProperty('textContent', expect.stringContaining('openai/gpt-5.6-terra'));

    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.click(screen.getByRole('option', { name: /qwen\/qwen3\.7-plus/i }));
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));

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
    expect(screen.getByLabelText('Cloud access token')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create or revoke tokens on ChartViz' })).toBeTruthy();
    expect(saveConfig).not.toHaveBeenCalled();
    expect(saveMode).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog', { name: 'Analysis settings' });
    await user.click(within(dialog).getByRole('button', { name: 'Back to chart' }));
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
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));

    await screen.findByRole('heading', { name: 'Detected chart' });
    expect(events).toEqual(['config', 'mode', 'runtime']);
  });

  it.each([
    ['newest resolves before oldest', 'newest-first'],
    ['oldest resolves before newest', 'oldest-first'],
  ] as const)('serializes remounted Direct saves when the %s', async (_name, completionOrder) => {
    const user = userEvent.setup();
    const oldestSave = deferred<void>();
    const newestSave = deferred<void>();
    let persistedConfig: ProviderConfig = {
      provider: 'openrouter', apiKey: 'existing-key',
      model: 'openai/gpt-5.6-terra', customModel: false,
    };
    const saveConfig = vi.fn(async (config: ProviderConfig) => {
      if (config.model === 'qwen/qwen3.7-plus') await oldestSave.promise;
      if (config.model === 'anthropic/claude-sonnet-5') await newestSave.promise;
      persistedConfig = config;
    });
    const saveMode = vi.fn(async () => undefined);
    const initialRuntime = fakeRuntime();
    const latestRuntime = fakeRuntime();
    const createDirectRuntime = vi.fn()
      .mockReturnValueOnce(initialRuntime)
      .mockReturnValueOnce(latestRuntime);

    render(<App dependencies={{
      loadConfig: async () => ({
        provider: 'openrouter', apiKey: 'existing-key',
        model: 'openai/gpt-5.6-terra', customModel: false,
      }),
      loadMode: async () => 'direct',
      saveConfig,
      saveMode,
      cloudGateway: unavailableCloudGateway,
      cloudConnectionManager: disconnectedCloudManager,
      inspect,
      capture,
      createDirectRuntime,
    }} />);

    await screen.findByRole('heading', { name: 'Detected chart' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.click(screen.getByRole('option', { name: /qwen\/qwen3\.7-plus/i }));
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));
    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('tab', { name: 'ChartViz Cloud' }));
    await user.click(screen.getByRole('tab', { name: 'Direct model' }));
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.click(screen.getByRole('option', { name: /anthropic\/claude-sonnet-5/i }));
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));

    expect(saveConfig).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'Analysis settings' })).toBeTruthy();
    expect(createDirectRuntime).toHaveBeenCalledTimes(1);

    if (completionOrder === 'newest-first') {
      await act(async () => {
        newestSave.resolve();
        await newestSave.promise;
        await Promise.resolve();
      });
      expect(screen.getByRole('dialog', { name: 'Analysis settings' })).toBeTruthy();
      expect(createDirectRuntime).toHaveBeenCalledTimes(1);
    } else {
      await act(async () => {
        oldestSave.resolve();
        await oldestSave.promise;
      });
      await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(2));
      expect(screen.getByRole('dialog', { name: 'Analysis settings' })).toBeTruthy();
    }

    if (completionOrder === 'newest-first') {
      await act(async () => {
        oldestSave.resolve();
        await oldestSave.promise;
      });
    } else {
      await act(async () => {
        newestSave.resolve();
        await newestSave.promise;
      });
    }

    expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();
    expect(persistedConfig).toEqual({
      provider: 'openrouter', apiKey: 'existing-key',
      model: 'anthropic/claude-sonnet-5', customModel: false,
    });
    expect(saveConfig).toHaveBeenCalledTimes(2);
    expect(saveMode).toHaveBeenCalledTimes(1);
    expect(createDirectRuntime).toHaveBeenCalledTimes(2);
    expect(createDirectRuntime).toHaveBeenLastCalledWith({
      provider: 'openrouter', apiKey: 'existing-key',
      model: 'anthropic/claude-sonnet-5', customModel: false,
    });
    expect(initialRuntime.analyze).not.toHaveBeenCalled();
    expect(latestRuntime.analyze).not.toHaveBeenCalled();
  });

  it('recovers the App-owned Direct queue when a superseded config write rejects', async () => {
    const user = userEvent.setup();
    const supersededSave = deferred<void>();
    const latestSave = deferred<void>();
    let persistedConfig: ProviderConfig = {
      provider: 'openrouter', apiKey: 'existing-key',
      model: 'openai/gpt-5.6-terra', customModel: false,
    };
    const saveConfig = vi.fn(async (config: ProviderConfig) => {
      if (config.model === 'qwen/qwen3.7-plus') await supersededSave.promise;
      if (config.model === 'anthropic/claude-sonnet-5') await latestSave.promise;
      persistedConfig = config;
    });
    const createDirectRuntime = vi.fn(() => fakeRuntime());

    render(<App dependencies={{
      loadConfig: async () => ({
        provider: 'openrouter', apiKey: 'existing-key',
        model: 'openai/gpt-5.6-terra', customModel: false,
      }),
      loadMode: async () => 'direct',
      saveConfig,
      saveMode: async () => undefined,
      cloudGateway: unavailableCloudGateway,
      cloudConnectionManager: disconnectedCloudManager,
      inspect,
      capture,
      createDirectRuntime,
    }} />);

    await screen.findByRole('heading', { name: 'Detected chart' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.click(screen.getByRole('option', { name: /qwen\/qwen3\.7-plus/i }));
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));
    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('tab', { name: 'ChartViz Cloud' }));
    await user.click(screen.getByRole('tab', { name: 'Direct model' }));
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.click(screen.getByRole('option', { name: /anthropic\/claude-sonnet-5/i }));
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));

    expect(saveConfig).toHaveBeenCalledTimes(1);
    await act(async () => {
      supersededSave.reject(new Error('superseded config persistence failed'));
      try {
        await supersededSave.promise;
      } catch {
        // The App-owned queue contains the superseded rejection.
      }
    });
    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Analysis settings' })).toBeTruthy();

    await act(async () => {
      latestSave.resolve();
      await latestSave.promise;
    });

    expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();
    expect(persistedConfig).toEqual({
      provider: 'openrouter', apiKey: 'existing-key',
      model: 'anthropic/claude-sonnet-5', customModel: false,
    });
    expect(createDirectRuntime).toHaveBeenCalledTimes(2);
    expect(createDirectRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      model: 'anthropic/claude-sonnet-5',
    }));
  });

  it('keeps a newer Cloud transition when an older Direct config save resolves late', async () => {
    const user = userEvent.setup();
    const configSave = deferred<void>();
    let persistedMode: 'cloud' | 'direct' = 'direct';
    const saveMode = vi.fn(async (mode: 'cloud' | 'direct') => { persistedMode = mode; });
    const directRuntime = fakeRuntime();
    const createDirectRuntime = vi.fn(() => directRuntime);
    const cloudRuntime = fakeCloudRuntime();
    const manager: CloudConnectionManager = {
      ...disconnectedCloudManager,
      connect: vi.fn(async () => connectedCloudManager().load()),
    };

    render(<App dependencies={{
      loadConfig: async () => ({
        provider: 'openrouter', apiKey: 'existing-key',
        model: 'openai/gpt-5.6-terra', customModel: false,
      }),
      loadMode: async () => 'direct',
      saveConfig: vi.fn(() => configSave.promise),
      saveMode,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => cloudRuntime,
      },
      cloudConnectionManager: manager,
      inspect,
      capture,
      createDirectRuntime,
    }} />);

    await screen.findByRole('heading', { name: 'Detected chart' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));
    await user.click(screen.getByRole('tab', { name: 'ChartViz Cloud' }));
    await user.type(screen.getByLabelText('Cloud access token'), `cv_live_${'c'.repeat(43)}`);
    await user.click(screen.getByRole('button', { name: 'Connect and set as default' }));
    expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();

    await act(async () => {
      configSave.resolve();
      await configSave.promise;
      await Promise.resolve();
    });

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('tab', { name: 'ChartViz Cloud' }).getAttribute('aria-current')).toBe('true');
    expect(persistedMode).toBe('cloud');
    expect(saveMode).not.toHaveBeenCalledWith('direct');
    expect(createDirectRuntime).toHaveBeenCalledTimes(1);
    expect(directRuntime.analyze).not.toHaveBeenCalled();
  });

  it('keeps newer Cloud UI when an older Direct config save rejects late', async () => {
    const user = userEvent.setup();
    const configSave = deferred<void>();
    let persistedMode: 'cloud' | 'direct' = 'direct';
    const directRuntime = fakeRuntime();
    const createDirectRuntime = vi.fn(() => directRuntime);
    const cloudRuntime = fakeCloudRuntime();
    const manager: CloudConnectionManager = {
      ...disconnectedCloudManager,
      connect: vi.fn(async () => connectedCloudManager().load()),
    };

    render(<App dependencies={{
      loadConfig: async () => ({
        provider: 'openrouter', apiKey: 'existing-key',
        model: 'openai/gpt-5.6-terra', customModel: false,
      }),
      loadMode: async () => 'direct',
      saveConfig: vi.fn(() => configSave.promise),
      saveMode: async (mode) => { persistedMode = mode; },
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => cloudRuntime,
      },
      cloudConnectionManager: manager,
      inspect,
      capture,
      createDirectRuntime,
    }} />);

    await screen.findByRole('heading', { name: 'Detected chart' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));
    await user.click(screen.getByRole('tab', { name: 'ChartViz Cloud' }));
    await user.type(screen.getByLabelText('Cloud access token'), `cv_live_${'e'.repeat(43)}`);
    await user.click(screen.getByRole('button', { name: 'Connect and set as default' }));
    expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();

    await act(async () => {
      configSave.reject(new Error('old direct persistence failed'));
      try {
        await configSave.promise;
      } catch {
        // The invalidated Direct transition owns and sanitizes its rejection.
      }
      await Promise.resolve();
    });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Detected chart' })).toBeTruthy();
    expect(persistedMode).toBe('cloud');
    expect(createDirectRuntime).toHaveBeenCalledTimes(1);
    expect(directRuntime.analyze).not.toHaveBeenCalled();
    expect(cloudRuntime.analyze).not.toHaveBeenCalled();
  });

  it('serializes Direct to Cloud mode writes and activates only after Cloud is persisted', async () => {
    const user = userEvent.setup();
    const directModeSave = deferred<void>();
    const cloudModeSave = deferred<void>();
    let persistedMode: 'cloud' | 'direct' = 'direct';
    const saveMode = vi.fn(async (mode: 'cloud' | 'direct') => {
      if (mode === 'direct') await directModeSave.promise;
      if (mode === 'cloud') await cloudModeSave.promise;
      persistedMode = mode;
    });
    const directRuntime = fakeRuntime();
    const createDirectRuntime = vi.fn(() => directRuntime);
    const cloudRuntime = fakeCloudRuntime();
    const manager: CloudConnectionManager = {
      ...disconnectedCloudManager,
      connect: vi.fn(async () => connectedCloudManager().load()),
    };

    render(<App dependencies={{
      loadConfig: async () => ({
        provider: 'openrouter', apiKey: 'existing-key',
        model: 'openai/gpt-5.6-terra', customModel: false,
      }),
      loadMode: async () => 'direct',
      saveConfig: async () => undefined,
      saveMode,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => cloudRuntime,
      },
      cloudConnectionManager: manager,
      inspect,
      capture,
      createDirectRuntime,
    }} />);

    await screen.findByRole('heading', { name: 'Detected chart' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));
    await waitFor(() => expect(saveMode).toHaveBeenCalledWith('direct'));
    await user.click(screen.getByRole('tab', { name: 'ChartViz Cloud' }));
    await user.type(screen.getByLabelText('Cloud access token'), `cv_live_${'m'.repeat(43)}`);
    await user.click(screen.getByRole('button', { name: 'Connect and set as default' }));
    await waitFor(() => expect(manager.connect).toHaveBeenCalledTimes(1));

    expect(saveMode.mock.calls.map(([mode]) => mode)).toEqual(['direct']);
    expect(screen.getByRole('dialog', { name: 'Analysis settings' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Direct model' }).getAttribute('aria-current')).toBe('true');
    expect(cloudRuntime.analyze).not.toHaveBeenCalled();

    await act(async () => {
      directModeSave.resolve();
      await directModeSave.promise;
    });
    await waitFor(() => expect(saveMode).toHaveBeenCalledTimes(2));
    expect(saveMode.mock.calls.map(([mode]) => mode)).toEqual(['direct', 'cloud']);
    expect(persistedMode).toBe('direct');
    expect(screen.getByRole('dialog', { name: 'Analysis settings' })).toBeTruthy();

    await act(async () => {
      cloudModeSave.resolve();
      await cloudModeSave.promise;
    });

    expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();
    expect(persistedMode).toBe('cloud');

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('tab', { name: 'ChartViz Cloud' }).getAttribute('aria-current')).toBe('true');
    expect(saveMode.mock.calls.map(([mode]) => mode)).toEqual(['direct', 'cloud']);
    expect(createDirectRuntime).toHaveBeenCalledTimes(1);
    expect(directRuntime.analyze).not.toHaveBeenCalled();
  });

  it('serializes Cloud to Direct mode writes and activates only after Direct is persisted', async () => {
    const user = userEvent.setup();
    const cloudModeSave = deferred<void>();
    const directModeSave = deferred<void>();
    let persistedMode: 'cloud' | 'direct' = 'direct';
    const saveMode = vi.fn(async (mode: 'cloud' | 'direct') => {
      if (mode === 'cloud') await cloudModeSave.promise;
      if (mode === 'direct') await directModeSave.promise;
      persistedMode = mode;
    });
    const initialRuntime = fakeRuntime();
    const latestRuntime = fakeRuntime();
    const createDirectRuntime = vi.fn()
      .mockReturnValueOnce(initialRuntime)
      .mockReturnValueOnce(latestRuntime);
    const cloudRuntime = fakeCloudRuntime();
    const manager: CloudConnectionManager = {
      ...disconnectedCloudManager,
      connect: vi.fn(async () => connectedCloudManager().load()),
    };

    render(<App dependencies={{
      loadConfig: async () => ({
        provider: 'openrouter', apiKey: 'existing-key',
        model: 'openai/gpt-5.6-terra', customModel: false,
      }),
      loadMode: async () => 'direct',
      saveConfig: async () => undefined,
      saveMode,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => cloudRuntime,
      },
      cloudConnectionManager: manager,
      inspect,
      capture,
      createDirectRuntime,
    }} />);

    await screen.findByRole('heading', { name: 'Detected chart' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('tab', { name: 'ChartViz Cloud' }));
    await user.type(screen.getByLabelText('Cloud access token'), `cv_live_${'d'.repeat(43)}`);
    await user.click(screen.getByRole('button', { name: 'Connect and set as default' }));
    await waitFor(() => expect(saveMode).toHaveBeenCalledWith('cloud'));

    await user.click(screen.getByRole('tab', { name: 'Direct model' }));
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));

    expect(saveMode.mock.calls.map(([mode]) => mode)).toEqual(['cloud']);
    expect(screen.getByRole('dialog', { name: 'Analysis settings' })).toBeTruthy();
    expect(createDirectRuntime).toHaveBeenCalledTimes(1);

    await act(async () => {
      cloudModeSave.resolve();
      await cloudModeSave.promise;
    });
    await waitFor(() => expect(saveMode).toHaveBeenCalledTimes(2));
    expect(saveMode.mock.calls.map(([mode]) => mode)).toEqual(['cloud', 'direct']);
    expect(persistedMode).toBe('cloud');
    expect(screen.getByRole('dialog', { name: 'Analysis settings' })).toBeTruthy();
    expect(createDirectRuntime).toHaveBeenCalledTimes(1);

    await act(async () => {
      directModeSave.resolve();
      await directModeSave.promise;
    });

    expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();
    expect(persistedMode).toBe('direct');

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('tab', { name: 'Direct model' }).getAttribute('aria-current')).toBe('true');
    expect(saveMode.mock.calls.map(([mode]) => mode)).toEqual(['cloud', 'direct']);
    expect(createDirectRuntime).toHaveBeenCalledTimes(2);
    expect(cloudRuntime.analyze).not.toHaveBeenCalled();
    expect(latestRuntime.analyze).not.toHaveBeenCalled();
  });

  it('continues the serialized mode queue after a superseded Direct write rejects', async () => {
    const user = userEvent.setup();
    const supersededModeSave = deferred<void>();
    let persistedMode: 'cloud' | 'direct' = 'direct';
    const saveMode = vi.fn(async (mode: 'cloud' | 'direct') => {
      if (mode === 'direct') await supersededModeSave.promise;
      persistedMode = mode;
    });
    const directRuntime = fakeRuntime();
    const cloudRuntime = fakeCloudRuntime();
    const manager: CloudConnectionManager = {
      ...disconnectedCloudManager,
      connect: vi.fn(async () => connectedCloudManager().load()),
    };

    render(<App dependencies={{
      loadConfig: async () => ({
        provider: 'openrouter', apiKey: 'existing-key',
        model: 'openai/gpt-5.6-terra', customModel: false,
      }),
      loadMode: async () => 'direct',
      saveConfig: async () => undefined,
      saveMode,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => cloudRuntime,
      },
      cloudConnectionManager: manager,
      inspect,
      capture,
      createDirectRuntime: () => directRuntime,
    }} />);

    await screen.findByRole('heading', { name: 'Detected chart' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));
    await waitFor(() => expect(saveMode).toHaveBeenCalledWith('direct'));
    await user.click(screen.getByRole('tab', { name: 'ChartViz Cloud' }));
    await user.type(screen.getByLabelText('Cloud access token'), `cv_live_${'r'.repeat(43)}`);
    await user.click(screen.getByRole('button', { name: 'Connect and set as default' }));
    await waitFor(() => expect(manager.connect).toHaveBeenCalledTimes(1));

    expect(saveMode.mock.calls.map(([mode]) => mode)).toEqual(['direct']);
    expect(screen.getByRole('dialog', { name: 'Analysis settings' })).toBeTruthy();

    await act(async () => {
      supersededModeSave.reject(new Error('superseded Direct mode persistence failed'));
      try {
        await supersededModeSave.promise;
      } catch {
        // The newer Cloud transition supersedes this write.
      }
    });

    expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();
    expect(saveMode.mock.calls.map(([mode]) => mode)).toEqual(['direct', 'cloud']);
    expect(persistedMode).toBe('cloud');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(directRuntime.analyze).not.toHaveBeenCalled();
    expect(cloudRuntime.analyze).not.toHaveBeenCalled();
  });

  it('surfaces a failed active-mode compensation and clears it only after retry succeeds', async () => {
    const user = userEvent.setup();
    const staleDirectSave = deferred<void>();
    const failedCompensation = deferred<void>();
    const retrySave = deferred<void>();
    let persistedMode: 'cloud' | 'direct' = 'cloud';
    const saveMode = vi.fn(async (mode: 'cloud' | 'direct') => {
      const attempt = saveMode.mock.calls.length;
      if (attempt === 1) await staleDirectSave.promise;
      if (attempt === 2) await failedCompensation.promise;
      if (attempt === 3) await retrySave.promise;
      persistedMode = mode;
    });
    const cloudRuntime = fakeCloudRuntime();

    render(<App dependencies={{
      loadConfig: async () => ({
        provider: 'openrouter', apiKey: 'existing-key',
        model: 'openai/gpt-5.6-terra', customModel: false,
      }),
      saveConfig: async () => undefined,
      loadMode: async () => 'cloud',
      saveMode,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => cloudRuntime,
      },
      cloudConnectionManager: connectedCloudManager(),
      inspect,
      capture,
      createDirectRuntime: () => fakeRuntime(),
    }} />);

    await screen.findByRole('heading', { name: 'Detected chart' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('tab', { name: 'Direct model' }));
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));
    await waitFor(() => expect(saveMode).toHaveBeenCalledWith('direct'));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await act(async () => {
      staleDirectSave.resolve();
      await staleDirectSave.promise;
    });
    await waitFor(() => expect(saveMode).toHaveBeenCalledTimes(2));
    expect(saveMode.mock.calls.map(([mode]) => mode)).toEqual(['direct', 'cloud']);
    expect(persistedMode).toBe('direct');

    await act(async () => {
      failedCompensation.reject(new Error('active mode compensation failed'));
      try {
        await failedCompensation.promise;
      } catch {
        // The current transition must expose a sanitized retry state.
      }
    });

    expect((await screen.findByRole('alert')).textContent).toBe(
      'ChartViz Cloud is temporarily unavailable.',
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(saveMode).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(persistedMode).toBe('direct');

    await act(async () => {
      retrySave.resolve();
      await retrySave.promise;
    });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(persistedMode).toBe('cloud');
    expect(saveMode.mock.calls.map(([mode]) => mode)).toEqual(['direct', 'cloud', 'cloud']);
    expect(cloudRuntime.analyze).not.toHaveBeenCalled();
  });

  it('clears a persistence error only when refresh owns the successful compensation', async () => {
    const user = userEvent.setup();
    const staleDirectSave = deferred<void>();
    const failedCompensation = deferred<void>();
    const staleRetry = deferred<void>();
    const refreshCompensation = deferred<void>();
    let persistedMode: 'cloud' | 'direct' = 'cloud';
    const saveMode = vi.fn(async (mode: 'cloud' | 'direct') => {
      const attempt = saveMode.mock.calls.length;
      if (attempt === 1) await staleDirectSave.promise;
      if (attempt === 2) await failedCompensation.promise;
      if (attempt === 3) await staleRetry.promise;
      if (attempt === 4) await refreshCompensation.promise;
      persistedMode = mode;
    });
    const cloudRuntime = fakeCloudRuntime();

    render(<App dependencies={{
      loadConfig: async () => ({
        provider: 'openrouter', apiKey: 'existing-key',
        model: 'openai/gpt-5.6-terra', customModel: false,
      }),
      saveConfig: async () => undefined,
      loadMode: async () => 'cloud',
      saveMode,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => cloudRuntime,
      },
      cloudConnectionManager: connectedCloudManager(),
      inspect,
      capture,
      createDirectRuntime: () => fakeRuntime(),
    }} />);

    await screen.findByRole('heading', { name: 'Detected chart' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('tab', { name: 'Direct model' }));
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));
    await waitFor(() => expect(saveMode).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await act(async () => {
      staleDirectSave.resolve();
      await staleDirectSave.promise;
    });
    await waitFor(() => expect(saveMode).toHaveBeenCalledTimes(2));
    await act(async () => {
      failedCompensation.reject(new Error('active mode compensation failed'));
      try {
        await failedCompensation.promise;
      } catch {
        // The current transition exposes the sanitized retry state.
      }
    });

    expect(await screen.findByRole('alert')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(saveMode).toHaveBeenCalledTimes(3));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await act(async () => {
      staleRetry.resolve();
      await staleRetry.promise;
    });
    await waitFor(() => expect(saveMode).toHaveBeenCalledTimes(4));
    expect(screen.getByRole('alert')).toBeTruthy();

    await act(async () => {
      refreshCompensation.resolve();
      await refreshCompensation.promise;
    });

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(persistedMode).toBe('cloud');
    expect(saveMode.mock.calls.map(([mode]) => mode)).toEqual([
      'direct', 'cloud', 'cloud', 'cloud',
    ]);
    expect(cloudRuntime.analyze).not.toHaveBeenCalled();
  });

  it('keeps a stale retry rejection silent after context compensation succeeds', async () => {
    const user = userEvent.setup();
    const staleDirectSave = deferred<void>();
    const failedCompensation = deferred<void>();
    const staleRetry = deferred<void>();
    const contextCompensation = deferred<void>();
    let persistedMode: 'cloud' | 'direct' = 'cloud';
    const saveMode = vi.fn(async (mode: 'cloud' | 'direct') => {
      const attempt = saveMode.mock.calls.length;
      if (attempt === 1) await staleDirectSave.promise;
      if (attempt === 2) await failedCompensation.promise;
      if (attempt === 3) await staleRetry.promise;
      if (attempt === 4) await contextCompensation.promise;
      persistedMode = mode;
    });
    const cloudRuntime = fakeCloudRuntime();

    render(<App dependencies={{
      loadConfig: async () => ({
        provider: 'openrouter', apiKey: 'existing-key',
        model: 'openai/gpt-5.6-terra', customModel: false,
      }),
      saveConfig: async () => undefined,
      loadMode: async () => 'cloud',
      saveMode,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => cloudRuntime,
      },
      cloudConnectionManager: connectedCloudManager(),
      inspect,
      capture,
      createDirectRuntime: () => fakeRuntime(),
    }} />);

    await screen.findByRole('heading', { name: 'Detected chart' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('tab', { name: 'Direct model' }));
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));
    await waitFor(() => expect(saveMode).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await act(async () => {
      staleDirectSave.resolve();
      await staleDirectSave.promise;
    });
    await waitFor(() => expect(saveMode).toHaveBeenCalledTimes(2));
    await act(async () => {
      failedCompensation.reject(new Error('active mode compensation failed'));
      try {
        await failedCompensation.promise;
      } catch {
        // The current transition exposes the sanitized retry state.
      }
    });

    expect(await screen.findByRole('alert')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(saveMode).toHaveBeenCalledTimes(3));
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: window.parent,
        data: { source: 'chartviz-page', type: 'context-changed' },
      }));
    });

    await act(async () => {
      staleRetry.reject(new Error('stale retry failed'));
      try {
        await staleRetry.promise;
      } catch {
        // The context transition supersedes this storage rejection.
      }
    });
    await waitFor(() => expect(saveMode).toHaveBeenCalledTimes(4));
    expect(screen.getByRole('alert')).toBeTruthy();

    await act(async () => {
      contextCompensation.resolve();
      await contextCompensation.promise;
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(persistedMode).toBe('cloud');
    expect(saveMode.mock.calls.map(([mode]) => mode)).toEqual([
      'direct', 'cloud', 'cloud', 'cloud',
    ]);
    expect(cloudRuntime.analyze).not.toHaveBeenCalled();
  });

  it('keeps a superseded compensation rejection silent while a newer runtime wins', async () => {
    const user = userEvent.setup();
    const staleDirectSave = deferred<void>();
    const supersededCompensation = deferred<void>();
    let directAttempts = 0;
    let persistedMode: 'cloud' | 'direct' = 'cloud';
    const saveMode = vi.fn(async (mode: 'cloud' | 'direct') => {
      if (mode === 'direct' && directAttempts++ === 0) await staleDirectSave.promise;
      if (mode === 'cloud') await supersededCompensation.promise;
      persistedMode = mode;
    });
    const cloudRuntime = fakeCloudRuntime();
    const directRuntime = fakeRuntime();
    const createDirectRuntime = vi.fn(() => directRuntime);

    render(<App dependencies={{
      loadConfig: async () => ({
        provider: 'openrouter', apiKey: 'existing-key',
        model: 'openai/gpt-5.6-terra', customModel: false,
      }),
      saveConfig: async () => undefined,
      loadMode: async () => 'cloud',
      saveMode,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => cloudRuntime,
      },
      cloudConnectionManager: connectedCloudManager(),
      inspect,
      capture,
      createDirectRuntime,
    }} />);

    await screen.findByRole('heading', { name: 'Detected chart' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('tab', { name: 'Direct model' }));
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));
    await waitFor(() => expect(saveMode).toHaveBeenCalledWith('direct'));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await act(async () => {
      staleDirectSave.resolve();
      await staleDirectSave.promise;
    });
    await waitFor(() => expect(saveMode).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Save and set as default' }));

    await act(async () => {
      supersededCompensation.reject(new Error('superseded compensation failed'));
      try {
        await supersededCompensation.promise;
      } catch {
        // The newer Direct transition owns the UI after this rejection.
      }
    });

    expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(persistedMode).toBe('direct');
    expect(saveMode.mock.calls.map(([mode]) => mode)).toEqual(['direct', 'cloud', 'direct']);
    expect(createDirectRuntime).toHaveBeenCalledTimes(1);
    expect(cloudRuntime.analyze).not.toHaveBeenCalled();
    expect(directRuntime.analyze).not.toHaveBeenCalled();
  });

  it('localizes a current Cloud mode persistence failure and recovers on retry', async () => {
    const user = userEvent.setup();
    const firstCloudModeSave = deferred<void>();
    let cloudModeAttempts = 0;
    let persistedMode: 'cloud' | 'direct' = 'direct';
    const saveMode = vi.fn(async (mode: 'cloud' | 'direct') => {
      cloudModeAttempts += 1;
      if (cloudModeAttempts === 1) await firstCloudModeSave.promise;
      persistedMode = mode;
    });
    const connect = vi.fn(async () => connectedCloudManager().load());
    const manager: CloudConnectionManager = {
      ...disconnectedCloudManager,
      connect,
    };
    const directRuntime = fakeRuntime();
    const cloudRuntime = fakeCloudRuntime();
    const gatewayRuntime = vi.fn(() => cloudRuntime);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);

    try {
      render(<App dependencies={{
        loadConfig: async () => ({
          provider: 'openrouter', apiKey: 'existing-key',
          model: 'openai/gpt-5.6-terra', customModel: false,
        }),
        loadMode: async () => 'direct',
        saveMode,
        cloudGateway: {
          availability: () => ({ available: true }),
          runtime: gatewayRuntime,
        },
        cloudConnectionManager: manager,
        inspect,
        capture,
        createDirectRuntime: () => directRuntime,
      }} />);

      await screen.findByRole('heading', { name: 'Detected chart' });
      await user.click(screen.getByRole('button', { name: 'Settings' }));
      await user.click(screen.getByRole('tab', { name: 'ChartViz Cloud' }));
      const token = `cv_live_${'f'.repeat(43)}`;
      await user.type(screen.getByLabelText('Cloud access token'), token);
      await user.click(screen.getByRole('button', { name: 'Connect and set as default' }));
      await waitFor(() => expect(saveMode).toHaveBeenCalledTimes(1));

      expect(persistedMode).toBe('direct');
      expect(screen.getByRole('dialog', { name: 'Analysis settings' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'Direct model' }).getAttribute('aria-current')).toBe('true');
      expect(gatewayRuntime).not.toHaveBeenCalled();

      await act(async () => {
        firstCloudModeSave.reject(new Error('Cloud mode persistence failed'));
        try {
          await firstCloudModeSave.promise;
        } catch {
          // The current transition must convert this rejection to settings UI state.
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect((await screen.findByRole('alert')).textContent).toBe(
        'ChartViz Cloud is temporarily unavailable. Try again.',
      );
      expect(unhandled).toEqual([]);
      expect(screen.getByRole('dialog', { name: 'Analysis settings' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'Direct model' }).getAttribute('aria-current')).toBe('true');
      expect(screen.getByLabelText('Cloud access token')).toHaveProperty('value', token);
      expect(gatewayRuntime).not.toHaveBeenCalled();
      expect(persistedMode).toBe('direct');

      await user.click(screen.getByRole('button', { name: 'Connect and set as default' }));

      expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();
      expect(connect).toHaveBeenCalledTimes(2);
      expect(saveMode.mock.calls.map(([mode]) => mode)).toEqual(['cloud', 'cloud']);
      expect(persistedMode).toBe('cloud');
      expect(gatewayRuntime).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(directRuntime.analyze).not.toHaveBeenCalled();
      expect(cloudRuntime.analyze).not.toHaveBeenCalled();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      void firstCloudModeSave.promise.catch(() => undefined);
    }
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
