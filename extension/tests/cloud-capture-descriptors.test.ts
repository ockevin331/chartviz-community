import { describe, expect, it } from 'vitest';
import type { AnalysisCapture } from '../src/analysis/runtime/analysis-runtime';
import { describeCloudCaptures } from '../src/cloud/cloud-capture-descriptors';

const baseCapture: AnalysisCapture = {
  image: {
    mediaType: 'image/png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    width: 1280,
    height: 720,
  },
  context: {
    instrument: 'BTC/USDT',
    timeframe: '15m',
    site: 'binance',
    exchange: 'Binance',
    pageType: 'spot-trade',
  },
};

function captures(...timeframes: string[]): readonly AnalysisCapture[] {
  return timeframes.map((timeframe) => ({
    ...baseCapture,
    context: { ...baseCapture.context, timeframe },
  }));
}

describe('Cloud capture descriptors', () => {
  it('describes a single capture with sequential ID and no duration role', () => {
    expect(describeCloudCaptures(captures('15m'))).toEqual([{
      captureId: 'C01', timeframe: '15m', role: null,
      instrument: 'BTC/USDT', site: 'binance', exchange: 'Binance',
      pageType: 'spot-trade', width: 1280, height: 720,
    }]);
  });

  it('assigns two duration roles without changing submitted order', () => {
    expect(describeCloudCaptures(captures('4h', '15m'))).toMatchObject([
      { captureId: 'C01', timeframe: '4h', role: 'context' },
      { captureId: 'C02', timeframe: '15m', role: 'setup_and_trigger' },
    ]);
  });

  it('assigns all three canonical duration roles with sequential IDs', () => {
    expect(describeCloudCaptures(captures('15m', '4h', '1h'))).toMatchObject([
      { captureId: 'C01', timeframe: '15m', role: 'trigger' },
      { captureId: 'C02', timeframe: '4h', role: 'context' },
      { captureId: 'C03', timeframe: '1h', role: 'setup' },
    ]);
  });

  it.each([
    ['no captures', [], 'invalid_image'],
    ['too many captures', captures('1d', '4h', '1h', '15m'), 'invalid_image'],
    ['unsupported timeframe', captures('45m'), 'unsupported_timeframe'],
    ['duplicate timeframe', captures('4h', '4h'), 'unsupported_timeframe'],
    ['invalid image dimensions', [{
      ...baseCapture, image: { ...baseCapture.image, width: 319 },
    }], 'invalid_image'],
    ['overlong instrument', [{
      ...baseCapture, context: { ...baseCapture.context, instrument: 'x'.repeat(121) },
    }], 'invalid_image'],
  ])('rejects %s before upload or persistence', (_name, input, code) => {
    expect(() => describeCloudCaptures(input)).toThrow(expect.objectContaining({ code }));
  });
});
