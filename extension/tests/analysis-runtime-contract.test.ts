import { describe, expect, it, vi } from 'vitest';
import type {
  AnalysisCapture,
  AnalysisRuntime,
  AnalysisRuntimeInput,
} from '../src/analysis/runtime/analysis-runtime';
import {
  resolveCloudRuntime,
  unavailableCloudGateway,
  type CloudAnalysisGateway,
} from '../src/cloud/cloud-gateway';
import { annotatedImages, communityReport, processedImage } from './community-ui-fixtures';

const captures: readonly AnalysisCapture[] = [
  { image: processedImage, context: { instrument: 'BTC/USDT', timeframe: '4h' } },
  { image: processedImage, context: { instrument: 'BTC/USDT', timeframe: '1h' } },
  { image: processedImage, context: { instrument: 'BTC/USDT', timeframe: '15m' } },
];

describe('analysis runtime contract', () => {
  it('keeps the production Cloud gateway unavailable without exposing a runtime', () => {
    expect(unavailableCloudGateway.availability()).toEqual({
      available: false,
      code: 'cloud_not_available',
    });
    expect(unavailableCloudGateway.runtime()).toBeNull();
    expect(unavailableCloudGateway.runtime.length).toBe(0);
    expect(resolveCloudRuntime(unavailableCloudGateway)).toBeNull();
  });

  it('resolves an available C2 Cloud runtime for one capture', async () => {
    const singleCapture = [captures[2]!] as const;
    const analyze = vi.fn(async (input: AnalysisRuntimeInput) => {
      expect(input.captures).toEqual(singleCapture);
      expect(input.outputLanguage).toBe('zh-CN');
      return { report: communityReport, annotations: annotatedImages };
    });
    const runtime: AnalysisRuntime = {
      mode: 'cloud',
      capabilities: () => ({ multiTimeframe: false, maxTimeframes: 1 }),
      analyze,
      cancel: vi.fn(),
      restoreActiveAnalysis: vi.fn(async () => null),
    };
    const gateway: CloudAnalysisGateway = {
      availability: () => ({ available: true }),
      runtime: () => runtime,
    };

    const resolved = resolveCloudRuntime(gateway);
    expect(resolved?.capabilities()).toEqual({ multiTimeframe: false, maxTimeframes: 1 });
    const outcome = await resolved?.analyze({ captures: singleCapture, outputLanguage: 'zh-CN' });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ report: communityReport, annotations: annotatedImages });
  });

  it('rejects an available gateway that does not expose a Cloud runtime', () => {
    const directRuntime: AnalysisRuntime = {
      mode: 'direct',
      capabilities: () => ({ multiTimeframe: false, maxTimeframes: 1 }),
      analyze: async () => ({ report: communityReport, annotations: annotatedImages }),
      cancel: () => undefined,
    };
    const gateway: CloudAnalysisGateway = {
      availability: () => ({ available: true }),
      runtime: () => directRuntime,
    };

    expect(() => resolveCloudRuntime(gateway)).toThrowError(
      'Available Cloud gateway must expose a Cloud runtime.',
    );
  });
});
