// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCommunityReportV3 } from '../src/analysis/stages/community-report-v3';
import { attachProviderFailureDetail } from '../src/providers/provider-diagnostics';
import { ProviderError } from '../src/providers/provider-errors';
import { useAnalysisController } from '../src/ui/state/use-analysis-controller';
import { validReportV3 } from './three-stage-fixtures';

afterEach(cleanup);

const config = {
  provider: 'openrouter' as const,
  apiKey: 'controller-secret',
  model: 'openai/gpt-5.6-terra',
  customModel: false,
};
const image = {
  mediaType: 'image/png' as const,
  dataUrl: 'data:image/png;base64,AAAA',
  width: 640,
  height: 360,
};
const provider = {
  kind: 'openrouter' as const,
  validateConfig: () => ({ ok: true as const }),
  testConnection: async () => undefined,
  generateStructured: async () => { throw new Error('The injected pipeline owns this test boundary.'); },
};
const annotations = { levels: null, signals: {}, patterns: {} } as any;

describe('V3 analysis controller integration', () => {
  it('passes the selected language and one signal through the staged pipeline while exposing public progress only', async () => {
    const runAnalysis = vi.fn(async (input: any) => {
      input.onProgress('reading_chart');
      input.onProgress('organizing_evidence');
      input.onProgress('preparing_result');
      return parseCommunityReportV3(structuredClone(validReportV3));
    });
    const { result } = renderHook(() => useAnalysisController({
      getProvider: () => provider,
      runAnalysis,
      buildAnnotations: async () => annotations,
    }));
    act(() => { result.current.configure(config); result.current.selectImage(image); });

    await act(async () => result.current.analyze({ instrument: 'BTC/USDT', timeframe: '15m' }, 'zh-CN'));

    expect(runAnalysis).toHaveBeenCalledTimes(1);
    expect(runAnalysis.mock.calls[0]?.[0]).toMatchObject({
      provider,
      outputLanguage: 'zh-CN',
      context: { instrument: 'BTC/USDT', timeframe: '15m', site: null, exchange: null },
    });
    expect(runAnalysis.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
    expect(result.current.state.status).toBe('completed');
    expect(result.current.state.report?.schemaVersion).toBe('community-3.0');
    expect(result.current.state.report?.conclusion.direction).toBe('sideways');
    expect(result.current.state.progress).toEqual(['reading_chart', 'organizing_evidence', 'preparing_result']);
  });

  it('retains an exact safe pipeline stage without retaining the image or API key', async () => {
    const error = attachProviderFailureDetail(
      new ProviderError('invalid_response', { params: { provider: 'openrouter' } }),
      { stage: 'signal_extraction_semantics', issues: [{ path: 'signals.0.stopLoss', code: 'custom' }] },
    );
    const { result } = renderHook(() => useAnalysisController({
      getProvider: () => provider,
      runAnalysis: async () => { throw error; },
      buildAnnotations: async () => annotations,
    }));
    act(() => { result.current.configure(config); result.current.selectImage(image); });

    await act(async () => result.current.analyze({ instrument: null, timeframe: null }, 'en'));

    expect(result.current.state.diagnostic).toMatchObject({
      stage: 'signal_extraction_semantics',
      issues: [{ path: 'signals.0.stopLoss', code: 'custom' }],
    });
    expect(JSON.stringify(result.current.state.diagnostic)).not.toMatch(/controller-secret|data:image/);
  });
});
