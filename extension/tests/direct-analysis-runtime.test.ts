import { describe, expect, it, vi } from 'vitest';
import { AnalysisRuntimeFailure } from '../src/analysis/runtime/analysis-runtime';
import { DirectAnalysisRuntime } from '../src/analysis/runtime/direct-analysis-runtime';
import { attachProviderFailureDetail } from '../src/providers/provider-diagnostics';
import { ProviderError } from '../src/providers/provider-errors';
import type { StructuredVisionProvider } from '../src/providers/provider-types';
import { parsePresentationBundle } from '../src/presentation/report-presentation-model';
import { communityReport, presentationAnnotatedImages, processedImage } from './community-ui-fixtures';
import { validPresentationBundle } from './presentation-fixtures';

const config = {
  provider: 'openrouter',
  apiKey: 'secret-direct-key',
  model: 'openai/gpt-5.6-terra',
  customModel: false,
} as const;

const provider: StructuredVisionProvider = {
  kind: 'openrouter',
  validateConfig: () => ({ ok: true }),
  testConnection: async () => undefined,
  generateStructured: async () => {
    throw new Error('The injected pipeline owns this test boundary.');
  },
};

const capture = {
  image: processedImage,
  context: { instrument: 'BTC/USDT', timeframe: '15m' },
} as const;

function setup(overrides: Record<string, unknown> = {}) {
  const getProvider = vi.fn(() => provider);
  const runAnalysis = vi.fn(async () => communityReport);
  const adaptPresentation = vi.fn(() => parsePresentationBundle(structuredClone(validPresentationBundle)));
  const buildAnnotations = vi.fn(async () => presentationAnnotatedImages);
  const runtime = new DirectAnalysisRuntime(config, {
    getProvider,
    runAnalysis,
    adaptPresentation,
    buildAnnotations,
    createRequestId: () => 'runtime-request-id',
    now: () => 1_000,
    ...overrides,
  });
  return { runtime, getProvider, runAnalysis, adaptPresentation, buildAnnotations };
}

describe('DirectAnalysisRuntime', () => {
  it('advertises exactly one supported timeframe', () => {
    const { runtime } = setup();

    expect(runtime.mode).toBe('direct');
    expect(runtime.capabilities()).toEqual({
      multiTimeframe: false,
      maxTimeframes: 1,
    });
  });

  it('runs the unchanged pipeline and annotations once for one capture', async () => {
    const progress = vi.fn();
    const runAnalysis = vi.fn(async (input: any) => {
      input.onProgress?.('reviewing_clues');
      return communityReport;
    });
    const { runtime, getProvider, adaptPresentation, buildAnnotations } = setup({ runAnalysis });

    const outcome = await runtime.analyze({
      captures: [capture],
      outputLanguage: 'zh-CN',
      onProgress: progress,
    });

    expect(getProvider).toHaveBeenCalledTimes(1);
    expect(getProvider).toHaveBeenCalledWith('openrouter');
    expect(runAnalysis).toHaveBeenCalledTimes(1);
    expect(runAnalysis.mock.calls[0]?.[0]).toMatchObject({
      config,
      provider,
      image: {
        mediaType: processedImage.mediaType,
        dataUrl: processedImage.dataUrl,
      },
      context: {
        instrument: 'BTC/USDT',
        timeframe: '15m',
        site: null,
        exchange: null,
      },
      outputLanguage: 'zh-CN',
      onProgress: progress,
      signal: expect.any(AbortSignal),
    });
    expect(adaptPresentation).toHaveBeenCalledWith(communityReport, capture, 'zh-CN');
    expect(buildAnnotations).toHaveBeenCalledTimes(1);
    expect(buildAnnotations).toHaveBeenCalledWith(
      [{ captureId: 'C01', image: processedImage }],
      validPresentationBundle.drawings,
    );
    expect(outcome).toEqual({
      presentation: validPresentationBundle.report,
      annotations: presentationAnnotatedImages,
    });
    expect(progress).toHaveBeenCalledWith('reviewing_clues');
  });

  it('rejects multiple captures before resolving or calling a provider', async () => {
    const { runtime, getProvider, runAnalysis, buildAnnotations } = setup();

    await expect(runtime.analyze({
      captures: [capture, { ...capture, context: { ...capture.context, timeframe: '4h' } }],
      outputLanguage: 'en',
    })).rejects.toMatchObject({
      name: 'AnalysisRuntimeFailure',
      code: 'multi_timeframe_requires_cloud',
      diagnostic: null,
    });

    expect(getProvider).not.toHaveBeenCalled();
    expect(runAnalysis).not.toHaveBeenCalled();
    expect(buildAnnotations).not.toHaveBeenCalled();
  });

  it('cancels the active pipeline through its runtime-owned signal', async () => {
    const runAnalysis = vi.fn((input: any) => {
      return new Promise<typeof communityReport>((_resolve, reject) => {
        input.signal.addEventListener(
          'abort',
          () => reject(new ProviderError('cancelled', { params: { provider: 'openrouter' } })),
          { once: true },
        );
      });
    });
    const { runtime } = setup({ runAnalysis });

    const pending = runtime.analyze({ captures: [capture], outputLanguage: 'en' });
    runtime.cancel();

    await expect(pending).rejects.toMatchObject({ code: 'cancelled', diagnostic: null });
    expect(runAnalysis.mock.calls[0]?.[0].signal.aborted).toBe(true);
  });

  it('preserves safe provider diagnostics without retaining analysis inputs', async () => {
    const providerError = attachProviderFailureDetail(
      new ProviderError('invalid_response', {
        params: { provider: 'openrouter' },
        httpStatus: 502,
      }),
      {
        stage: 'report_semantics',
        issues: [{ path: 'tradePlan.long.entry', code: 'invalid_price_reference' }],
      },
    );
    const runAnalysis = vi.fn(async () => { throw providerError; });
    const now = vi.fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_125);
    const { runtime } = setup({ runAnalysis, now });

    let failure: AnalysisRuntimeFailure | null = null;
    try {
      await runtime.analyze({ captures: [capture], outputLanguage: 'en' });
    } catch (error) {
      failure = error as AnalysisRuntimeFailure;
    }

    expect(failure).toMatchObject({
      code: 'invalid_response',
      diagnostic: {
        requestId: 'runtime-request-id',
        provider: 'openrouter',
        model: 'openai/gpt-5.6-terra',
        stage: 'report_semantics',
        durationMs: 125,
        httpStatus: 502,
        issues: [{ path: 'tradePlan.long.entry', code: 'invalid_price_reference' }],
      },
    });
    const serialized = JSON.stringify(failure);
    expect(serialized).not.toContain(config.apiKey);
    expect(serialized).not.toContain(processedImage.dataUrl);
    expect(serialized).not.toMatch(/systemPrompt|userPrompt|rawOutput/i);
  });

  it('persists the complete local failure diagnostic before returning the error', async () => {
    const snapshot = {
      context: { instrument: 'BTC/USDT', timeframe: '15m', site: null, exchange: null },
      outputLanguage: 'en' as const,
      stages: [{
        stage: 'evidence_reasoning' as const,
        promptVersion: 'reasoning-1.0',
        schemaName: 'community_report_v3',
        hasImage: false,
        systemPrompt: 'system prompt',
        userPrompt: 'user prompt',
        output: { tradePlan: { summary: 'The 1h chart confirms this 15m chart.' } },
      }],
    };
    const providerError = attachProviderFailureDetail(
      new ProviderError('invalid_response', { params: { provider: 'openrouter' } }),
      {
        stage: 'report_semantics',
        issues: [{
          path: 'tradePlan.summary',
          code: 'multiple_timeframes',
          valuePreview: 'The 1h chart confirms this 15m chart.',
        }],
        snapshot,
      },
    );
    const saveFailureDiagnostic = vi.fn(async () => undefined);
    const { runtime } = setup({
      runAnalysis: vi.fn(async () => { throw providerError; }),
      saveFailureDiagnostic,
    });

    await expect(runtime.analyze({ captures: [capture], outputLanguage: 'en' }))
      .rejects.toMatchObject({ code: 'invalid_response' });

    expect(saveFailureDiagnostic).toHaveBeenCalledTimes(1);
    expect(saveFailureDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'runtime-request-id',
      stage: 'report_semantics',
      snapshot,
    }));
  });

  it('classifies annotation rendering failures without exposing the thrown message', async () => {
    const buildAnnotations = vi.fn(async () => {
      throw new Error(`canvas failed with ${config.apiKey}`);
    });
    const { runtime } = setup({ buildAnnotations });

    let failure: AnalysisRuntimeFailure | null = null;
    try {
      await runtime.analyze({ captures: [capture], outputLanguage: 'en' });
    } catch (error) {
      failure = error as AnalysisRuntimeFailure;
    }

    expect(failure).toMatchObject({
      code: 'invalid_image',
      diagnostic: {
        stage: 'annotation_rendering',
        provider: 'openrouter',
        model: 'openai/gpt-5.6-terra',
      },
    });
    expect(JSON.stringify(failure)).not.toContain(config.apiKey);
  });
});
