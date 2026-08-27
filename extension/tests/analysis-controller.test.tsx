// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnalysisRuntimeFailure,
  type AnalysisRuntime,
  type AnalysisRuntimeInput,
  type AnalysisRuntimeOutcome,
} from '../src/analysis/runtime/analysis-runtime';
import type { AnalysisDiagnostic } from '../src/providers/provider-diagnostics';
import { useAnalysisController } from '../src/ui/state/use-analysis-controller';
import { annotatedImages, communityReport, processedImage } from './community-ui-fixtures';

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, reject, resolve };
}

const outcome: AnalysisRuntimeOutcome = {
  report: communityReport,
  annotations: annotatedImages,
};

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

function setup(runtime: AnalysisRuntime = fakeRuntime()) {
  const hook = renderHook(() => useAnalysisController());
  act(() => {
    hook.result.current.configure(runtime);
    hook.result.current.selectImage(processedImage);
  });
  return hook;
}

describe('useAnalysisController runtime boundary', () => {
  it('submits one capture to the runtime and exposes only concise progress', async () => {
    const runtime = fakeRuntime(async (input) => {
      input.onProgress?.('reading_chart');
      input.onProgress?.('organizing_evidence');
      input.onProgress?.('preparing_result');
      return outcome;
    });
    const { result } = setup(runtime);

    await act(async () => result.current.analyze(
      { instrument: 'BTC/USDT', timeframe: '15m' },
      'en',
    ));

    expect(runtime.analyze).toHaveBeenCalledTimes(1);
    expect(runtime.analyze.mock.calls[0]?.[0]).toMatchObject({
      captures: [{
        image: processedImage,
        context: { instrument: 'BTC/USDT', timeframe: '15m' },
      }],
      outputLanguage: 'en',
      onProgress: expect.any(Function),
    });
    expect(result.current.state).toMatchObject({
      status: 'completed',
      report: communityReport,
      annotations: annotatedImages,
      progress: ['reading_chart', 'organizing_evidence', 'preparing_result'],
    });
  });

  it('moves source → preview → analyzing → completed around one runtime call', async () => {
    const pending = deferred<AnalysisRuntimeOutcome>();
    const runtime = fakeRuntime(() => pending.promise);
    const hook = renderHook(() => useAnalysisController());

    act(() => hook.result.current.configure(runtime));
    expect(hook.result.current.state.status).toBe('source');
    act(() => hook.result.current.selectImage(processedImage));
    expect(hook.result.current.state.status).toBe('preview');
    let analysis!: Promise<void>;
    act(() => {
      analysis = hook.result.current.analyze(
        { instrument: 'BTC/USDT', timeframe: '15m' },
        'zh-CN',
      );
    });
    expect(hook.result.current.state.status).toBe('analyzing');
    expect(hook.result.current.state.progress).toEqual(['reading_chart']);

    pending.resolve(outcome);
    await act(async () => analysis);

    expect(runtime.analyze).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state.status).toBe('completed');
    expect(hook.result.current.state.report).toBe(communityReport);
  });

  it('retries only after an explicit user action', async () => {
    const runtime = fakeRuntime(vi.fn()
      .mockRejectedValueOnce(new AnalysisRuntimeFailure('network_timeout'))
      .mockResolvedValueOnce(outcome));
    const { result } = setup(runtime);

    await act(async () => result.current.analyze(
      { instrument: null, timeframe: null },
      'en',
    ));
    expect(result.current.state).toMatchObject({
      status: 'failed',
      errorCode: 'network_timeout',
    });
    expect(runtime.analyze).toHaveBeenCalledTimes(1);

    act(() => result.current.returnToPreview());
    await act(async () => result.current.analyze(
      { instrument: null, timeframe: null },
      'en',
    ));

    expect(runtime.analyze).toHaveBeenCalledTimes(2);
    expect(result.current.state.status).toBe('completed');
  });

  it('refreshes the workflow while retaining the configured runtime', () => {
    const runtime = fakeRuntime();
    const { result } = setup(runtime);

    act(() => result.current.refresh());

    expect(result.current.state).toMatchObject({
      status: 'source',
      image: null,
      report: null,
      annotations: null,
    });
    expect(runtime.cancel).not.toHaveBeenCalled();
  });

  it('cancels the active runtime and returns to preview', async () => {
    const pending = deferred<AnalysisRuntimeOutcome>();
    const runtime = fakeRuntime(() => pending.promise);
    const { result } = setup(runtime);

    act(() => {
      void result.current.analyze({ instrument: null, timeframe: null }, 'en');
    });
    await waitFor(() => expect(result.current.state.status).toBe('analyzing'));
    act(() => result.current.cancel());

    expect(runtime.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe('cancelled');
    act(() => result.current.returnToPreview());
    expect(result.current.state.status).toBe('preview');

    pending.resolve(outcome);
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores a non-cooperative runtime that settles by %s after cancellation',
    async (settlement) => {
      const pending = deferred<AnalysisRuntimeOutcome>();
      const runtime = fakeRuntime(() => pending.promise);
      const { result } = setup(runtime);
      let analysis!: Promise<void>;
      act(() => {
        analysis = result.current.analyze({ instrument: null, timeframe: null }, 'en');
      });
      act(() => {
        result.current.cancel();
        result.current.returnToPreview();
      });

      if (settlement === 'resolve') pending.resolve(outcome);
      else {
        void pending.promise.catch(() => undefined);
        pending.reject(new Error('late runtime failure'));
      }
      await act(async () => analysis);

      expect(result.current.state).toMatchObject({
        status: 'preview',
        report: null,
        errorCode: null,
      });
    },
  );

  it('allows a fresh analysis after cancellation and ignores the old completion', async () => {
    const stale = deferred<AnalysisRuntimeOutcome>();
    const freshReport = {
      ...communityReport,
      conclusion: { ...communityReport.conclusion, summary: 'Fresh report.' },
    };
    const runtime = fakeRuntime(vi.fn()
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce({ ...outcome, report: freshReport }));
    const { result } = setup(runtime);
    let staleAnalysis!: Promise<void>;
    act(() => {
      staleAnalysis = result.current.analyze({ instrument: null, timeframe: null }, 'en');
    });
    act(() => {
      result.current.cancel();
      result.current.returnToPreview();
    });

    await act(async () => result.current.analyze(
      { instrument: null, timeframe: null },
      'en',
    ));
    expect(result.current.state.report?.conclusion.summary).toBe('Fresh report.');

    stale.resolve(outcome);
    await act(async () => staleAnalysis);
    expect(result.current.state.report?.conclusion.summary).toBe('Fresh report.');
  });

  it('uses the runtime safe failure without reconstructing provider details', async () => {
    const diagnostic: AnalysisDiagnostic = {
      source: 'extension_local',
      pipelineVersion: 'community-3.0',
      requestId: 'safe-runtime-id',
      provider: 'openrouter',
      model: 'openai/gpt-5.6-terra',
      stage: 'visual_extraction_semantics',
      occurredAt: '2026-08-27T00:00:00.000Z',
      durationMs: 125,
      issues: [{ path: 'priceScaleAnchors.2', code: 'invalid_price_reference' }],
    };
    const runtime = fakeRuntime(async () => {
      throw new AnalysisRuntimeFailure('invalid_response', diagnostic);
    });
    const { result } = setup(runtime);

    await act(async () => result.current.analyze(
      { instrument: 'BTC/USDT', timeframe: '15m' },
      'en',
    ));

    expect(result.current.state).toMatchObject({
      status: 'failed',
      errorCode: 'invalid_response',
      diagnostic,
    });
    const serializedDiagnostic = JSON.stringify(result.current.state.diagnostic);
    expect(serializedDiagnostic).not.toMatch(/api.?key|data:image|systemPrompt|rawOutput/i);
  });

  it('configuring another runtime cancels the old operation and resets all analysis state', () => {
    const firstRuntime = fakeRuntime();
    const secondRuntime = fakeRuntime();
    const { result } = setup(firstRuntime);

    act(() => result.current.configure(secondRuntime));

    expect(firstRuntime.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({
      status: 'source',
      image: null,
      report: null,
      annotations: null,
      progress: [],
      errorCode: null,
      diagnostic: null,
    });
  });

  it('updates same-mode future execution without resetting the visible workflow', async () => {
    const firstRuntime = fakeRuntime();
    const secondRuntime = fakeRuntime();
    const { result } = setup(firstRuntime);
    expect(result.current.state.status).toBe('preview');

    act(() => result.current.updateRuntime(secondRuntime));
    expect(result.current.state.status).toBe('preview');

    await act(async () => result.current.analyze(
      { instrument: 'BTC/USDT', timeframe: '15m' },
      'en',
    ));
    expect(firstRuntime.analyze).not.toHaveBeenCalled();
    expect(secondRuntime.analyze).toHaveBeenCalledTimes(1);
  });
});
