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
  type RestoredActiveAnalysis,
} from '../src/analysis/runtime/analysis-runtime';
import { ChartAvailabilityError } from '../src/capture/active-chart';
import { unavailableCloudGateway } from '../src/cloud/cloud-gateway';
import type { CloudAnalysisGateway } from '../src/cloud/cloud-gateway';
import type { CloudConnectionManager } from '../src/cloud/cloud-connection';
import type { StoredCloudConnection } from '../src/storage/cloud-connection-storage';
import type { ChartContext } from '../src/domain/chart-context';
import type { AnalysisDiagnostic } from '../src/providers/provider-diagnostics';
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
        selectedModel: { id: 'openai/gpt-5.4', name: 'GPT-5.4', quotaCost: 2 },
        entitlements: { multiTimeframe: false, maxCaptures: 1 },
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
    restoreActiveAnalysis: vi.fn(async () => null),
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
    expect(screen.getByRole('button', { name: 'Connect Cloud' })).toBeTruthy();
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
        entitlements: { multiTimeframe: false, maxCaptures: 1 },
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
    await user.click(screen.getByRole('button', { name: 'Connect Cloud' }));

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
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
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

  it('restores an active Cloud task without inspecting or capturing again', async () => {
    const restoredCaptures = (['4h', '1h', '15m'] as const).map((timeframe, index) => ({
      image: { ...processedImage, dataUrl: `${processedImage.dataUrl}-${index}` },
      context: {
        instrument: 'BTCUSD', timeframe, site: 'tradingview',
        exchange: 'BITSTAMP', pageType: 'advanced-chart' as const,
      },
    }));
    const runtime = fakeCloudRuntime();
    runtime.restoreActiveAnalysis = vi.fn(async () => ({
      captures: restoredCaptures, outputLanguage: 'zh-CN' as const,
    }));
    const inspectPage = vi.fn(inspect);
    const captureChart = vi.fn(capture);
    const manager: CloudConnectionManager = {
      load: vi.fn(async () => ({
        status: 'connected' as const, errorCode: null,
        account: {
          emailMasked: 'a***z@example.com', plan: 'pro' as const,
          currentPeriodEnd: '2026-09-28T00:00:00+00:00',
          quota: { limit: 50, used: 1, remaining: 49, unlimited: false },
          selectedModel: { id: 'openai/gpt-5.4', name: 'GPT-5.4', quotaCost: 2 },
          entitlements: { multiTimeframe: false, maxCaptures: 1 },
        },
      })),
      connect: disconnectedCloudManager.connect,
      disconnect: disconnectedCloudManager.disconnect,
    };

    render(<App dependencies={{
      loadConfig: async () => null,
      loadMode: async () => 'cloud',
      saveMode: async () => undefined,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => runtime,
      },
      cloudConnectionManager: manager,
      inspect: inspectPage,
      capture: captureChart,
    }} />);

    await waitFor(() => expect(runtime.analyze).toHaveBeenCalledTimes(1));
    expect(runtime.analyze).toHaveBeenCalledWith(expect.objectContaining({
      captures: restoredCaptures, outputLanguage: 'zh-CN',
    }));
    expect(inspectPage).not.toHaveBeenCalled();
    expect(captureChart).not.toHaveBeenCalled();
  });

  it('contains a startup restore rejection and leaves Cloud safely at chart source', async () => {
    const secretToken = `cv_live_${'r'.repeat(43)}`;
    const runtime = fakeCloudRuntime();
    runtime.restoreActiveAnalysis = vi.fn(async () => {
      throw new Error(`IndexedDB restore failed for ${secretToken}`);
    });
    const manager: CloudConnectionManager = {
      load: vi.fn(async () => ({
        status: 'connected' as const,
        errorCode: null,
        account: {
          emailMasked: 'a***z@example.com', plan: 'pro' as const,
          currentPeriodEnd: '2026-09-28T00:00:00+00:00',
          quota: { limit: 50, used: 1, remaining: 49, unlimited: false },
          selectedModel: { id: 'openai/gpt-5.4', name: 'GPT-5.4', quotaCost: 2 },
          entitlements: { multiTimeframe: false, maxCaptures: 1 },
        },
      })),
      connect: disconnectedCloudManager.connect,
      disconnect: disconnectedCloudManager.disconnect,
    };
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);

    try {
      render(<App dependencies={{
        loadConfig: async () => null,
        loadMode: async () => 'cloud',
        saveMode: async () => undefined,
        cloudGateway: {
          availability: () => ({ available: true }),
          runtime: () => runtime,
        },
        cloudConnectionManager: manager,
        inspect,
        capture,
      }} />);

      await waitFor(() => expect(runtime.restoreActiveAnalysis).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandled).toEqual([]);
      expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();
      expect(await screen.findByText('BTCUSD')).toBeTruthy();
      expect(runtime.analyze).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain(secretToken);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('shows a localized transient restore error and retries restoration in the same panel', async () => {
    const user = userEvent.setup();
    const internalDetail = 'capture reader failed in worker 7';
    const runtime = fakeCloudRuntime();
    const restoredCaptures = outcome.captures;
    const restoreActiveAnalysis = vi.fn()
      .mockRejectedValueOnce(new AnalysisRuntimeFailure('service_unavailable', null, {
        params: { internalDetail },
      }))
      .mockResolvedValueOnce({ captures: restoredCaptures, outputLanguage: 'en' as const });
    runtime.restoreActiveAnalysis = restoreActiveAnalysis;
    const loadConfig = vi.fn(async () => ({
      provider: 'openrouter' as const,
      apiKey: 'preserved-key',
      model: 'google/gemini-3.7-flash',
      customModel: false,
    }));
    const manager: CloudConnectionManager = {
      load: vi.fn(async () => ({
        status: 'connected' as const,
        errorCode: null,
        account: {
          emailMasked: 'a***z@example.com', plan: 'pro' as const,
          currentPeriodEnd: '2026-09-28T00:00:00+00:00',
          quota: { limit: 50, used: 1, remaining: 49, unlimited: false },
          selectedModel: { id: 'openai/gpt-5.4', name: 'GPT-5.4', quotaCost: 2 },
          entitlements: { multiTimeframe: false, maxCaptures: 1 },
        },
      })),
      connect: disconnectedCloudManager.connect,
      disconnect: disconnectedCloudManager.disconnect,
    };

    render(<App dependencies={{
      loadConfig,
      loadMode: async () => 'cloud',
      saveMode: async () => undefined,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => runtime,
      },
      cloudConnectionManager: manager,
      inspect,
      capture,
    }} />);

    expect((await screen.findByRole('alert')).textContent).toBe(
      'ChartViz Cloud is temporarily unavailable.',
    );
    expect(document.body.textContent).not.toContain(internalDetail);
    expect(screen.queryByRole('heading', { name: 'Detected chart' })).toBeNull();
    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(manager.load).toHaveBeenCalledTimes(1);
    expect(runtime.cancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(runtime.analyze).toHaveBeenCalledTimes(1));
    expect(restoreActiveAnalysis).toHaveBeenCalledTimes(2);
    expect(runtime.analyze).toHaveBeenCalledWith(expect.objectContaining({
      captures: restoredCaptures,
      outputLanguage: 'en',
    }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(manager.load).toHaveBeenCalledTimes(1);
  });

  it('returns to an empty chart source after a deterministic invalid restore', async () => {
    const runtime = fakeCloudRuntime();
    runtime.restoreActiveAnalysis = vi.fn(async () => {
      throw new AnalysisRuntimeFailure('invalid_image');
    });
    const manager: CloudConnectionManager = {
      load: vi.fn(async () => ({
        status: 'connected' as const,
        errorCode: null,
        account: {
          emailMasked: 'a***z@example.com', plan: 'pro' as const,
          currentPeriodEnd: '2026-09-28T00:00:00+00:00',
          quota: { limit: 50, used: 1, remaining: 49, unlimited: false },
          selectedModel: { id: 'openai/gpt-5.4', name: 'GPT-5.4', quotaCost: 2 },
          entitlements: { multiTimeframe: false, maxCaptures: 1 },
        },
      })),
      connect: disconnectedCloudManager.connect,
      disconnect: disconnectedCloudManager.disconnect,
    };

    render(<App dependencies={{
      loadConfig: async () => null,
      loadMode: async () => 'cloud',
      saveMode: async () => undefined,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => runtime,
      },
      cloudConnectionManager: manager,
      inspect,
      capture,
    }} />);

    expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(runtime.analyze).not.toHaveBeenCalled();
  });

  it('keeps refreshed context when an older startup restoration resolves', async () => {
    const user = userEvent.setup();
    const restoration = deferred<RestoredActiveAnalysis | null>();
    const runtime = fakeCloudRuntime();
    runtime.restoreActiveAnalysis = vi.fn(() => restoration.promise);
    const refreshedContext = {
      ...chartContext,
      symbol: 'ETHUSD',
      url: 'https://www.tradingview.com/chart/new/?symbol=BITSTAMP%3AETHUSD',
    };

    render(<App dependencies={{
      loadConfig: async () => null,
      loadMode: async () => 'cloud',
      saveMode: async () => undefined,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => runtime,
      },
      cloudConnectionManager: connectedCloudManager(),
      inspect: vi.fn(async () => refreshedContext),
      capture,
    }} />);

    await waitFor(() => expect(runtime.restoreActiveAnalysis).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText('ETHUSD')).toBeTruthy();
    expect(runtime.cancel).toHaveBeenCalledTimes(1);

    await act(async () => {
      restoration.resolve({ captures: outcome.captures, outputLanguage: 'en' });
      await restoration.promise;
      await Promise.resolve();
    });

    expect(screen.getByText('ETHUSD')).toBeTruthy();
    expect(runtime.analyze).not.toHaveBeenCalled();
    expect(screen.queryByText('Higher lows remain visible.')).toBeNull();
  });

  it('invalidates startup before configuration assigns a restoration runtime on refresh', async () => {
    const user = userEvent.setup();
    const configLoad = deferred<{
      provider: 'openrouter'; apiKey: string; model: string; customModel: false;
    } | null>();
    const runtime = fakeCloudRuntime();
    runtime.restoreActiveAnalysis = vi.fn(async () => ({
      captures: outcome.captures,
      outputLanguage: 'en' as const,
    }));
    const loadMode = vi.fn(async () => 'cloud' as const);

    render(<App dependencies={{
      loadConfig: vi.fn(() => configLoad.promise),
      loadMode,
      saveMode: async () => undefined,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => runtime,
      },
      cloudConnectionManager: connectedCloudManager(),
      inspect,
      capture,
    }} />);

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('heading', { name: 'Managed chart analysis' })).toBeTruthy();

    await act(async () => {
      configLoad.resolve({
        provider: 'openrouter', apiKey: 'existing-key',
        model: 'openai/gpt-5.6-terra', customModel: false,
      });
      await configLoad.promise;
      await Promise.resolve();
    });

    expect(loadMode).not.toHaveBeenCalled();
    expect(runtime.restoreActiveAnalysis).not.toHaveBeenCalled();
    expect(runtime.analyze).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Managed chart analysis' })).toBeTruthy();
  });

  it('invalidates startup before configuration assigns a restoration runtime on context change', async () => {
    const connectionLoad = deferred<Awaited<ReturnType<CloudConnectionManager['load']>>>();
    const runtime = fakeCloudRuntime();
    runtime.restoreActiveAnalysis = vi.fn(async () => ({
      captures: outcome.captures,
      outputLanguage: 'en' as const,
    }));
    const loadMode = vi.fn(async () => 'cloud' as const);
    const manager: CloudConnectionManager = {
      ...connectedCloudManager(),
      load: vi.fn(() => connectionLoad.promise),
    };

    render(<App dependencies={{
      loadConfig: async () => null,
      loadMode,
      saveMode: async () => undefined,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => runtime,
      },
      cloudConnectionManager: manager,
      inspect,
      capture,
    }} />);

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: window.parent,
        data: { source: 'chartviz-page', type: 'context-changed' },
      }));
    });
    expect(await screen.findByRole('heading', { name: 'Managed chart analysis' })).toBeTruthy();

    await act(async () => {
      connectionLoad.resolve(await connectedCloudManager().load());
      await connectionLoad.promise;
      await Promise.resolve();
    });

    expect(loadMode).not.toHaveBeenCalled();
    expect(runtime.restoreActiveAnalysis).not.toHaveBeenCalled();
    expect(runtime.analyze).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Managed chart analysis' })).toBeTruthy();
  });

  it('keeps context-change state when an older startup restoration resolves', async () => {
    const restoration = deferred<RestoredActiveAnalysis | null>();
    const runtime = fakeCloudRuntime();
    runtime.restoreActiveAnalysis = vi.fn(() => restoration.promise);
    const changedContext = {
      ...chartContext,
      symbol: 'SOLUSD',
      url: 'https://www.tradingview.com/chart/new/?symbol=COINBASE%3ASOLUSD',
    };

    render(<App dependencies={{
      loadConfig: async () => null,
      loadMode: async () => 'cloud',
      saveMode: async () => undefined,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => runtime,
      },
      cloudConnectionManager: connectedCloudManager(),
      inspect: vi.fn(async () => changedContext),
      capture,
    }} />);

    await waitFor(() => expect(runtime.restoreActiveAnalysis).toHaveBeenCalledTimes(1));
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: window.parent,
        data: { source: 'chartviz-page', type: 'context-changed' },
      }));
    });

    expect(await screen.findByText('SOLUSD')).toBeTruthy();
    expect(runtime.cancel).toHaveBeenCalledTimes(1);

    await act(async () => {
      restoration.resolve({ captures: outcome.captures, outputLanguage: 'en' });
      await restoration.promise;
      await Promise.resolve();
    });

    expect(screen.getByText('SOLUSD')).toBeTruthy();
    expect(runtime.analyze).not.toHaveBeenCalled();
    expect(screen.queryByText('Higher lows remain visible.')).toBeNull();
  });

  it('does not surface a stale restore failure after refresh', async () => {
    const user = userEvent.setup();
    const restoration = deferred<RestoredActiveAnalysis | null>();
    const runtime = fakeCloudRuntime();
    runtime.restoreActiveAnalysis = vi.fn(() => restoration.promise);

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
      capture,
    }} />);

    await waitFor(() => expect(runtime.restoreActiveAnalysis).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('BTCUSD')).toBeTruthy();

    await act(async () => {
      restoration.reject(new AnalysisRuntimeFailure('service_unavailable'));
      try {
        await restoration.promise;
      } catch {
        // The App owns and sanitizes the stale restoration rejection.
      }
      await Promise.resolve();
    });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('BTCUSD')).toBeTruthy();
    expect(runtime.analyze).not.toHaveBeenCalled();
  });

  it('does not send late Cloud restoration captures to a newly selected Direct runtime', async () => {
    const user = userEvent.setup();
    const restoration = deferred<RestoredActiveAnalysis | null>();
    const configSave = deferred<void>();
    const cloudRuntime = fakeCloudRuntime();
    cloudRuntime.restoreActiveAnalysis = vi.fn(() => restoration.promise);
    const directRuntime = fakeRuntime();

    render(<App dependencies={{
      loadConfig: async () => ({
        provider: 'openrouter', apiKey: 'existing-key',
        model: 'openai/gpt-5.6-terra', customModel: false,
      }),
      loadMode: async () => 'cloud',
      saveMode: async () => undefined,
      saveConfig: vi.fn(() => configSave.promise),
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => cloudRuntime,
      },
      cloudConnectionManager: connectedCloudManager(),
      inspect,
      capture,
      createDirectRuntime: () => directRuntime,
    }} />);

    await waitFor(() => expect(cloudRuntime.restoreActiveAnalysis).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('tab', { name: 'Direct model' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    await act(async () => {
      restoration.resolve({ captures: outcome.captures, outputLanguage: 'en' });
      await restoration.promise;
      await Promise.resolve();
    });
    expect(cloudRuntime.analyze).not.toHaveBeenCalled();

    await act(async () => {
      configSave.resolve();
      await configSave.promise;
      await Promise.resolve();
    });
    expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();

    expect(directRuntime.analyze).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Detected chart' })).toBeTruthy();
    expect(screen.queryByText('Higher lows remain visible.')).toBeNull();
  });

  it('does not send an older restoration to a replacement Cloud runtime', async () => {
    const user = userEvent.setup();
    const restoration = deferred<RestoredActiveAnalysis | null>();
    const oldRuntime = fakeCloudRuntime();
    oldRuntime.restoreActiveAnalysis = vi.fn(() => restoration.promise);
    const replacementRuntime = fakeCloudRuntime();
    const gatewayRuntime = vi.fn()
      .mockReturnValueOnce(oldRuntime)
      .mockReturnValueOnce(replacementRuntime);
    const manager: CloudConnectionManager = {
      ...connectedCloudManager(),
      disconnect: vi.fn(async () => ({
        status: 'disconnected' as const, account: null, errorCode: null,
      })),
      connect: vi.fn(async () => connectedCloudManager().load()),
    };

    render(<App dependencies={{
      loadConfig: async () => null,
      loadMode: async () => 'cloud',
      saveMode: async () => undefined,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: gatewayRuntime,
      },
      cloudConnectionManager: manager,
      inspect,
      capture,
    }} />);

    await waitFor(() => expect(oldRuntime.restoreActiveAnalysis).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(manager.disconnect).toHaveBeenCalledTimes(1));
    await user.type(screen.getByLabelText('Cloud access token'), `cv_live_${'n'.repeat(43)}`);
    await user.click(screen.getByRole('button', { name: 'Connect Cloud' }));
    expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();

    await act(async () => {
      restoration.resolve({ captures: outcome.captures, outputLanguage: 'en' });
      await restoration.promise;
      await Promise.resolve();
    });

    expect(oldRuntime.analyze).not.toHaveBeenCalled();
    expect(replacementRuntime.analyze).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Detected chart' })).toBeTruthy();
    expect(screen.queryByText('Higher lows remain visible.')).toBeNull();
  });

  it('does not surface a late restore failure after Cloud disconnect', async () => {
    const user = userEvent.setup();
    const restoration = deferred<RestoredActiveAnalysis | null>();
    const disconnect = deferred<Awaited<ReturnType<CloudConnectionManager['disconnect']>>>();
    const runtime = fakeCloudRuntime();
    runtime.restoreActiveAnalysis = vi.fn(() => restoration.promise);
    const manager: CloudConnectionManager = {
      ...connectedCloudManager(),
      disconnect: vi.fn(() => disconnect.promise),
    };

    render(<App dependencies={{
      loadConfig: async () => null,
      loadMode: async () => 'cloud',
      saveMode: async () => undefined,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => runtime,
      },
      cloudConnectionManager: manager,
      inspect,
      capture,
    }} />);

    await waitFor(() => expect(runtime.restoreActiveAnalysis).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(manager.disconnect).toHaveBeenCalledTimes(1));

    await act(async () => {
      restoration.reject(new AnalysisRuntimeFailure('service_unavailable'));
      try {
        await restoration.promise;
      } catch {
        // The App owns and sanitizes the invalidated restoration rejection.
      }
      disconnect.resolve({ status: 'disconnected', account: null, errorCode: null });
      await disconnect.promise;
      await Promise.resolve();
    });
    await user.click(screen.getByRole('button', { name: 'Back to chart' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Managed chart analysis' })).toBeTruthy();
    expect(runtime.analyze).not.toHaveBeenCalled();
  });

  it('cancels a pending startup restoration when the panel unmounts', async () => {
    const restoration = deferred<RestoredActiveAnalysis | null>();
    const runtime = fakeCloudRuntime();
    runtime.restoreActiveAnalysis = vi.fn(() => restoration.promise);
    const panel = render(<App dependencies={{
      loadConfig: async () => null,
      loadMode: async () => 'cloud',
      saveMode: async () => undefined,
      cloudGateway: {
        availability: () => ({ available: true }),
        runtime: () => runtime,
      },
      cloudConnectionManager: connectedCloudManager(),
      inspect,
      capture,
    }} />);

    await waitFor(() => expect(runtime.restoreActiveAnalysis).toHaveBeenCalledTimes(1));
    panel.unmount();

    expect(runtime.cancel).toHaveBeenCalledTimes(1);
    await act(async () => {
      restoration.resolve({ captures: outcome.captures, outputLanguage: 'en' });
      await restoration.promise;
      await Promise.resolve();
    });
    expect(runtime.analyze).not.toHaveBeenCalled();
  });

  it('contains legacy cleanup failure without blocking source configuration', async () => {
    let rejectCleanup!: (reason?: unknown) => void;
    const cleanupPromise = new Promise<void>((_resolve, reject) => { rejectCleanup = reject; });
    const cleanupLegacyCloudAnalysisStorage = vi.fn(() => cleanupPromise);
    const secret = 'legacy cleanup internal failure';
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);

    try {
      render(<App dependencies={{
        loadConfig: async () => ({
          provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash',
          customModel: false,
        }),
        ...directModeDependencies,
        cleanupLegacyCloudAnalysisStorage,
        inspect,
        capture,
        createDirectRuntime: () => fakeRuntime(),
      }} />);

      expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();
      expect(cleanupLegacyCloudAnalysisStorage).toHaveBeenCalledTimes(1);
      rejectCleanup(new Error(secret));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandled).toEqual([]);
      expect(document.body.textContent).not.toContain(secret);
      expect(await screen.findByText('BTCUSD')).toBeTruthy();
    } finally {
      process.off('unhandledRejection', onUnhandled);
      void cleanupPromise.catch(() => undefined);
    }
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
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    await screen.findByRole('heading', { name: 'Detected chart' });
    expect(events).toEqual(['config', 'mode', 'runtime']);
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
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await user.click(screen.getByRole('tab', { name: 'ChartViz Cloud' }));
    await user.type(screen.getByLabelText('Cloud access token'), `cv_live_${'c'.repeat(43)}`);
    await user.click(screen.getByRole('button', { name: 'Connect Cloud' }));
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
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await user.click(screen.getByRole('tab', { name: 'ChartViz Cloud' }));
    await user.type(screen.getByLabelText('Cloud access token'), `cv_live_${'e'.repeat(43)}`);
    await user.click(screen.getByRole('button', { name: 'Connect Cloud' }));
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

  it('restores newer Cloud persistence after an older Direct mode write resolves late', async () => {
    const user = userEvent.setup();
    const directModeSave = deferred<void>();
    let persistedMode: 'cloud' | 'direct' = 'direct';
    let firstDirectWrite = true;
    const saveMode = vi.fn(async (mode: 'cloud' | 'direct') => {
      if (mode === 'direct' && firstDirectWrite) {
        firstDirectWrite = false;
        await directModeSave.promise;
      }
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
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(saveMode).toHaveBeenCalledWith('direct'));
    await user.click(screen.getByRole('tab', { name: 'ChartViz Cloud' }));
    await user.type(screen.getByLabelText('Cloud access token'), `cv_live_${'m'.repeat(43)}`);
    await user.click(screen.getByRole('button', { name: 'Connect Cloud' }));
    expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();
    expect(persistedMode).toBe('cloud');

    await act(async () => {
      directModeSave.resolve();
      await directModeSave.promise;
      await Promise.resolve();
    });
    await waitFor(() => expect(persistedMode).toBe('cloud'));

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('tab', { name: 'ChartViz Cloud' }).getAttribute('aria-current')).toBe('true');
    expect(saveMode.mock.calls.at(-1)?.[0]).toBe('cloud');
    expect(createDirectRuntime).toHaveBeenCalledTimes(1);
    expect(directRuntime.analyze).not.toHaveBeenCalled();
  });

  it('keeps a newer Direct transition and persistence when an older Cloud mode write resolves late', async () => {
    const user = userEvent.setup();
    const cloudModeSave = deferred<void>();
    let persistedMode: 'cloud' | 'direct' = 'direct';
    let firstCloudWrite = true;
    const saveMode = vi.fn(async (mode: 'cloud' | 'direct') => {
      if (mode === 'cloud' && firstCloudWrite) {
        firstCloudWrite = false;
        await cloudModeSave.promise;
      }
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
    await user.click(screen.getByRole('button', { name: 'Connect Cloud' }));
    await waitFor(() => expect(saveMode).toHaveBeenCalledWith('cloud'));

    await user.click(screen.getByRole('tab', { name: 'Direct model' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByRole('heading', { name: 'Detected chart' })).toBeTruthy();
    expect(persistedMode).toBe('direct');

    await act(async () => {
      cloudModeSave.resolve();
      await cloudModeSave.promise;
      await Promise.resolve();
    });
    await waitFor(() => expect(persistedMode).toBe('direct'));

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('tab', { name: 'Direct model' }).getAttribute('aria-current')).toBe('true');
    expect(saveMode.mock.calls.at(-1)?.[0]).toBe('direct');
    expect(createDirectRuntime).toHaveBeenCalledTimes(2);
    expect(cloudRuntime.analyze).not.toHaveBeenCalled();
    expect(latestRuntime.analyze).not.toHaveBeenCalled();
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
