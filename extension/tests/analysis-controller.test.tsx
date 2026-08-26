// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisionProvider } from '../src/providers/provider-types';
import { useAnalysisController, type AnalysisControllerDependencies } from '../src/ui/state/use-analysis-controller';
import { annotatedImages, communityReport, processedImage } from './community-ui-fixtures';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, reject, resolve };
}

const config = { provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false } as const;

function setup(
  analyze: VisionProvider['analyze'],
  overrides: Partial<Pick<AnalysisControllerDependencies, 'validateReport' | 'buildAnnotations'>> = {},
) {
  const provider: VisionProvider = { kind: 'openrouter', validateConfig: () => ({ ok: true }), testConnection: async () => undefined, analyze };
  const buildPrompt = vi.fn(() => ({ system: 'system', user: 'user' }));
  const buildAnnotations = vi.fn(async () => annotatedImages);
  const hook = renderHook(() => useAnalysisController({
    getProvider: () => provider,
    buildPrompt,
    validateReport: overrides.validateReport ?? ((value) => value as typeof communityReport),
    buildAnnotations: overrides.buildAnnotations ?? buildAnnotations,
  }));
  return { ...hook, buildAnnotations, buildPrompt };
}

describe('useAnalysisController', () => {
  it('moves setup → source → preview → analyzing → completed with one provider call and three public progress categories', async () => {
    const pending = deferred<typeof communityReport>();
    const analyze = vi.fn(() => pending.promise);
    const { result, buildAnnotations, buildPrompt } = setup(analyze);
    act(() => result.current.configure(config));
    expect(result.current.state.status).toBe('source');
    act(() => result.current.selectImage(processedImage));
    expect(result.current.state.status).toBe('preview');
    let analysis!: Promise<void>;
    act(() => { analysis = result.current.analyze({ instrument: 'BTC/USDT', timeframe: '15m' }, 'zh-CN'); });
    expect(result.current.state.status).toBe('analyzing');
    expect(result.current.state.progress).toEqual(['reading_chart']);
    expect(analyze).toHaveBeenCalledTimes(1);
    pending.resolve(communityReport);
    await act(async () => analysis);

    expect(result.current.state.status).toBe('completed');
    expect(result.current.state.progress).toEqual(['reading_chart', 'organizing_evidence', 'preparing_result']);
    expect(buildPrompt).toHaveBeenCalledWith({ language: 'zh-CN', pageContext: { instrument: 'BTC/USDT', timeframe: '15m' } });
    expect(buildAnnotations).toHaveBeenCalledWith(processedImage, communityReport);
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it('moves failed → preview without automatic retry, and a new Analyze action makes exactly one new call', async () => {
    const analyze = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(communityReport);
    const { result } = setup(analyze);
    act(() => { result.current.configure(config); result.current.selectImage(processedImage); });
    await act(async () => result.current.analyze({ instrument: null, timeframe: null }, 'en'));
    expect(result.current.state.status).toBe('failed');
    expect(analyze).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(analyze).toHaveBeenCalledTimes(1);
    act(() => result.current.returnToPreview());
    expect(result.current.state.status).toBe('preview');
    await act(async () => result.current.analyze({ instrument: null, timeframe: null }, 'en'));
    expect(result.current.state.status).toBe('completed');
    expect(analyze).toHaveBeenCalledTimes(2);
  });

  it('moves analyzing → cancelled → preview and aborts the one active call', async () => {
    const analyze = vi.fn((_config, request) => new Promise<typeof communityReport>((_resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
    }));
    const { result } = setup(analyze);
    act(() => { result.current.configure(config); result.current.selectImage(processedImage); });
    act(() => { void result.current.analyze({ instrument: null, timeframe: null }, 'en'); });
    await waitFor(() => expect(result.current.state.status).toBe('analyzing'));
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.state.status).toBe('cancelled'));
    expect(analyze).toHaveBeenCalledTimes(1);
    act(() => result.current.returnToPreview());
    expect(result.current.state.status).toBe('preview');
  });

  it.each(['resolve', 'reject'] as const)('ignores a non-cooperative provider that settles by %s after cancel → preview', async (settlement) => {
    const pending = deferred<typeof communityReport>();
    const { result } = setup(vi.fn(() => pending.promise));
    act(() => { result.current.configure(config); result.current.selectImage(processedImage); });
    let analysis!: Promise<void>;
    act(() => { analysis = result.current.analyze({ instrument: null, timeframe: null }, 'en'); });
    act(() => { result.current.cancel(); result.current.returnToPreview(); });
    expect(result.current.state.status).toBe('preview');

    if (settlement === 'resolve') pending.resolve({ ...communityReport, marketView: { ...communityReport.marketView, summary: 'Stale report.' } });
    else pending.reject(new Error('stale provider rejection'));
    await act(async () => analysis);

    expect(result.current.state.status).toBe('preview');
    expect(result.current.state.report).toBeNull();
    expect(result.current.state.errorCode).toBeNull();
  });

  it('invalidates cancellation during the final preparation window', async () => {
    vi.useFakeTimers();
    const pendingAnnotations = deferred<typeof annotatedImages>();
    const { result } = setup(vi.fn(async () => communityReport), {
      buildAnnotations: () => pendingAnnotations.promise,
    });
    act(() => { result.current.configure(config); result.current.selectImage(processedImage); });
    let analysis!: Promise<void>;
    act(() => { analysis = result.current.analyze({ instrument: null, timeframe: null }, 'en'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state.progress).toContain('organizing_evidence');
    await act(async () => { pendingAnnotations.resolve(annotatedImages); await Promise.resolve(); });
    expect(result.current.state.progress).toContain('preparing_result');

    act(() => result.current.cancel());
    await act(async () => { await vi.runAllTimersAsync(); await analysis; });

    expect(result.current.state.status).toBe('cancelled');
    expect(result.current.state.report).toBeNull();
  });

  it('starts a new analysis immediately after cancel and late old completion cannot overwrite it', async () => {
    const stale = deferred<typeof communityReport>();
    const freshReport = { ...communityReport, marketView: { ...communityReport.marketView, summary: 'Fresh report.' } };
    const analyze = vi.fn()
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce(freshReport);
    const { result } = setup(analyze);
    act(() => { result.current.configure(config); result.current.selectImage(processedImage); });
    let staleAnalysis!: Promise<void>;
    act(() => { staleAnalysis = result.current.analyze({ instrument: null, timeframe: null }, 'en'); });
    act(() => { result.current.cancel(); result.current.returnToPreview(); });

    await act(async () => result.current.analyze({ instrument: null, timeframe: null }, 'en'));
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(result.current.state.report?.marketView.summary).toBe('Fresh report.');

    stale.resolve({ ...communityReport, marketView: { ...communityReport.marketView, summary: 'Stale report.' } });
    await act(async () => staleAnalysis);
    expect(result.current.state.status).toBe('completed');
    expect(result.current.state.report?.marketView.summary).toBe('Fresh report.');
  });

  it('maps report validation details to the stable invalid_response code', async () => {
    const { result } = setup(vi.fn(async () => communityReport), {
      validateReport: () => { throw new Error('schemaVersion at chart.timeframe failed private schema path'); },
    });
    act(() => { result.current.configure(config); result.current.selectImage(processedImage); });
    await act(async () => result.current.analyze({ instrument: null, timeframe: null }, 'en'));

    expect(result.current.state.status).toBe('failed');
    expect(result.current.state.errorCode).toBe('invalid_response');
    expect(JSON.stringify(result.current.state)).not.toContain('schemaVersion');
  });
});
