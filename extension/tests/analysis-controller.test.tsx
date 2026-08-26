// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisionProvider } from '../src/providers/provider-types';
import { useAnalysisController } from '../src/ui/state/use-analysis-controller';
import { annotatedImages, communityReport, processedImage } from './community-ui-fixtures';

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, reject, resolve };
}

const config = { provider: 'openrouter', apiKey: 'key', model: 'google/gemini-3.7-flash', customModel: false } as const;

function setup(analyze: VisionProvider['analyze']) {
  const provider: VisionProvider = { kind: 'openrouter', validateConfig: () => ({ ok: true }), testConnection: async () => undefined, analyze };
  const buildPrompt = vi.fn(() => ({ system: 'system', user: 'user' }));
  const buildAnnotations = vi.fn(async () => annotatedImages);
  const hook = renderHook(() => useAnalysisController({
    getProvider: () => provider,
    buildPrompt,
    validateReport: (value) => value as typeof communityReport,
    buildAnnotations,
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
});
