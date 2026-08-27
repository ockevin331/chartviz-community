// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnalysisRuntimeFailure,
  type AnalysisRuntime,
  type AnalysisRuntimeInput,
} from '../src/analysis/runtime/analysis-runtime';
import { parseCommunityReportV3 } from '../src/analysis/stages/community-report-v3';
import type { AnalysisDiagnostic } from '../src/providers/provider-diagnostics';
import { useAnalysisController } from '../src/ui/state/use-analysis-controller';
import { validReportV3 } from './three-stage-fixtures';

afterEach(cleanup);

const image = {
  mediaType: 'image/png' as const,
  dataUrl: 'data:image/png;base64,AAAA',
  width: 640,
  height: 360,
};
const annotations = { levels: null, signals: {}, patterns: {} };

function runtimeWith(analyze: AnalysisRuntime['analyze']): AnalysisRuntime {
  return {
    mode: 'direct',
    capabilities: () => ({ multiTimeframe: false, maxTimeframes: 1 }),
    analyze,
    cancel: vi.fn(),
  };
}

describe('V3 analysis controller integration', () => {
  it('passes the selected language and one capture through the runtime while exposing public progress only', async () => {
    const analyze = vi.fn(async (input: AnalysisRuntimeInput) => {
      input.onProgress?.('reading_chart');
      input.onProgress?.('organizing_evidence');
      input.onProgress?.('preparing_result');
      return {
        report: parseCommunityReportV3(structuredClone(validReportV3)),
        annotations,
      };
    });
    const runtime = runtimeWith(analyze);
    const { result } = renderHook(() => useAnalysisController());
    act(() => { result.current.configure(runtime); result.current.selectImage(image); });

    await act(async () => result.current.analyze({ instrument: 'BTC/USDT', timeframe: '15m' }, 'zh-CN'));

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0]?.[0]).toMatchObject({
      captures: [{ image, context: { instrument: 'BTC/USDT', timeframe: '15m' } }],
      outputLanguage: 'zh-CN',
    });
    expect(result.current.state.status).toBe('completed');
    expect(result.current.state.report?.schemaVersion).toBe('community-3.0');
    expect(result.current.state.report?.conclusion.direction).toBe('sideways');
    expect(result.current.state.progress).toEqual(['reading_chart', 'organizing_evidence', 'preparing_result']);
  });

  it('retains an exact safe runtime stage without adding secrets to the diagnostic', async () => {
    const diagnostic: AnalysisDiagnostic = {
      source: 'extension_local',
      pipelineVersion: 'community-3.0',
      requestId: 'safe-runtime-id',
      provider: 'openrouter',
      model: 'openai/gpt-5.6-terra',
      stage: 'signal_extraction_semantics',
      occurredAt: '2026-08-27T00:00:00.000Z',
      durationMs: 40,
      issues: [{ path: 'signals.0.stopLoss', code: 'custom' }],
    };
    const runtime = runtimeWith(async () => {
      throw new AnalysisRuntimeFailure('invalid_response', diagnostic);
    });
    const { result } = renderHook(() => useAnalysisController());
    act(() => { result.current.configure(runtime); result.current.selectImage(image); });

    await act(async () => result.current.analyze({ instrument: null, timeframe: null }, 'en'));

    expect(result.current.state.diagnostic).toMatchObject({
      stage: 'signal_extraction_semantics',
      issues: [{ path: 'signals.0.stopLoss', code: 'custom' }],
    });
    expect(JSON.stringify(result.current.state.diagnostic)).not.toMatch(/api.?key|data:image|systemPrompt|rawOutput/i);
  });
});
