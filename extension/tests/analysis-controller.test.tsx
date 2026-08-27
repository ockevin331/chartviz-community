// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StructuredVisionProvider } from '../src/providers/provider-types';
import { ProviderError } from '../src/providers/provider-errors';
import { attachProviderFailureDetail } from '../src/providers/provider-diagnostics';
import { useAnalysisController, type AnalysisControllerDependencies } from '../src/ui/state/use-analysis-controller';
import { annotatedImages, communityReport, processedImage } from './community-ui-fixtures';
import { validReportV3 } from './three-stage-fixtures';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, reject, resolve };
}

const config = { provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false } as const;
function setup(
  runAnalysis: AnalysisControllerDependencies['runAnalysis'],
  overrides: Partial<Pick<AnalysisControllerDependencies, 'buildAnnotations'>> = {},
) {
  const provider: StructuredVisionProvider = {
    kind: 'openrouter', validateConfig: () => ({ ok: true }), testConnection: async () => undefined,
    generateStructured: async () => { throw new Error('The injected pipeline owns this test boundary.'); },
  };
  const buildAnnotations = vi.fn(async () => annotatedImages);
  const hook = renderHook(() => useAnalysisController({
    getProvider: () => provider,
    runAnalysis,
    buildAnnotations: overrides.buildAnnotations ?? buildAnnotations,
  }));
  return { ...hook, buildAnnotations, runAnalysis };
}

describe('useAnalysisController', () => {
  it('delegates one analysis to the three-stage pipeline and exposes only concise public progress', async () => {
    const runAnalysis = vi.fn(async (input: any) => {
      input.onProgress('reading_chart');
      input.onProgress('organizing_evidence');
      input.onProgress('preparing_result');
      return structuredClone(validReportV3);
    });
    const provider = {
      kind: 'openrouter', validateConfig: () => ({ ok: true }), testConnection: async () => undefined,
      generateStructured: async () => { throw new Error('Pipeline transport is injected in this controller test.'); },
    } as any;
    const result = renderHook(() => useAnalysisController({
      getProvider: () => provider,
      runAnalysis,
      buildAnnotations: async () => annotatedImages,
    } as any)).result;

    act(() => { result.current.configure(config); result.current.selectImage(processedImage); });
    await act(async () => result.current.analyze({ instrument: 'BTC/USDT', timeframe: '15m' }, 'en'));

    expect(runAnalysis).toHaveBeenCalledTimes(1);
    expect(runAnalysis.mock.calls[0]?.[0]).toMatchObject({
      config, provider, outputLanguage: 'en',
      context: { instrument: 'BTC/USDT', timeframe: '15m', site: null, exchange: null },
    });
    expect(result.current.state.progress).toEqual(['reading_chart', 'organizing_evidence', 'preparing_result']);
    expect(result.current.state.status).toBe('completed');
    expect(result.current.state.report?.conclusion.direction).toBe('sideways');
  });

  it('moves setup → source → preview → analyzing → completed with one provider call and three public progress categories', async () => {
    const pending = deferred<typeof communityReport>();
    const analyze = vi.fn((_input: Parameters<AnalysisControllerDependencies['runAnalysis']>[0]) => pending.promise);
    const { result, buildAnnotations } = setup(analyze);
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
    expect(analyze.mock.calls[0]?.[0]).toMatchObject({
      outputLanguage: 'zh-CN',
      context: { instrument: 'BTC/USDT', timeframe: '15m', site: null, exchange: null },
    });
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

  it('resets the current workflow while retaining configured access', () => {
    const { result } = setup(vi.fn(async () => communityReport));
    act(() => { result.current.configure(config); result.current.selectImage(processedImage); });
    expect(result.current.state.status).toBe('preview');

    act(() => result.current.refresh());

    expect(result.current.state).toMatchObject({ status: 'source', image: null, report: null, annotations: null });
  });

  it('moves analyzing → cancelled → preview and aborts the one active call', async () => {
    const analyze = vi.fn((request: Parameters<AnalysisControllerDependencies['runAnalysis']>[0]) => new Promise<typeof communityReport>((_resolve, reject) => {
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

    if (settlement === 'resolve') pending.resolve({ ...communityReport, conclusion: { ...communityReport.conclusion, summary: 'Stale report.' } });
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
    const freshReport = { ...communityReport, conclusion: { ...communityReport.conclusion, summary: 'Fresh report.' } };
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
    expect(result.current.state.report?.conclusion.summary).toBe('Fresh report.');

    stale.resolve({ ...communityReport, conclusion: { ...communityReport.conclusion, summary: 'Stale report.' } });
    await act(async () => staleAnalysis);
    expect(result.current.state.status).toBe('completed');
    expect(result.current.state.report?.conclusion.summary).toBe('Fresh report.');
  });

  it('maps report validation details to the stable invalid_response code', async () => {
    const invalidReport = attachProviderFailureDetail(
      new ProviderError('invalid_response', { params: { provider: 'openrouter' } }),
      { stage: 'report_shape', issues: [{ path: 'chart.timeframe', code: 'invalid_type' }] },
    );
    const { result } = setup(vi.fn(async () => { throw invalidReport; }));
    act(() => { result.current.configure(config); result.current.selectImage(processedImage); });
    await act(async () => result.current.analyze({ instrument: null, timeframe: null }, 'en'));

    expect(result.current.state.status).toBe('failed');
    expect(result.current.state.errorCode).toBe('invalid_response');
    expect(JSON.stringify(result.current.state)).not.toContain('schemaVersion');
  });

  it('records safe stage diagnostics for an intermittent malformed provider response', async () => {
    const providerError = attachProviderFailureDetail(
      new ProviderError('invalid_response', { params: { provider: 'openrouter' } }),
      { stage: 'json_parse', issues: [] },
    );
    const { result } = setup(vi.fn(async () => { throw providerError; }));
    act(() => { result.current.configure(config); result.current.selectImage(processedImage); });

    await act(async () => result.current.analyze({ instrument: null, timeframe: null }, 'en'));

    expect(result.current.state.diagnostic).toMatchObject({
      provider: 'openrouter',
      model: 'google/gemini-3.7-flash',
      stage: 'json_parse',
      issues: [],
    });
    const serialized = JSON.stringify(result.current.state.diagnostic);
    expect(serialized).not.toContain('key');
    expect(serialized).not.toContain(processedImage.dataUrl);
  });

  it('preserves the exact pipeline failure stage without storing prompts, images, or model output', async () => {
    const pipelineError = attachProviderFailureDetail(
      new ProviderError('invalid_response', { params: { provider: 'openrouter' } }),
      { stage: 'visual_extraction_semantics', issues: [{ path: 'priceScaleAnchors.2', code: 'custom' }] },
    );
    const runAnalysis = vi.fn(async () => { throw pipelineError; });
    const provider = {
      kind: 'openrouter', validateConfig: () => ({ ok: true }), testConnection: async () => undefined,
      generateStructured: async () => { throw new Error('unused'); },
    } as any;
    const { result } = renderHook(() => useAnalysisController({
      getProvider: () => provider,
      runAnalysis,
      buildAnnotations: async () => annotatedImages,
    } as any));
    act(() => { result.current.configure(config); result.current.selectImage(processedImage); });

    await act(async () => result.current.analyze({ instrument: 'BTC/USDT', timeframe: '15m' }, 'en'));

    expect(result.current.state.diagnostic).toMatchObject({
      stage: 'visual_extraction_semantics',
      issues: [{ path: 'priceScaleAnchors.2', code: 'custom' }],
    });
    const serialized = JSON.stringify(result.current.state.diagnostic);
    expect(serialized).not.toContain(processedImage.dataUrl);
    expect(serialized).not.toContain('test-key');
    expect(serialized).not.toContain('Previously validated visual facts');
  });
});
