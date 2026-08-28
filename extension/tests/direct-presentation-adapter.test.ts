import { describe, expect, it } from 'vitest';
import type { AnalysisCapture } from '../src/analysis/runtime/analysis-runtime';
import type { CommunityReportV3 } from '../src/analysis/stages/community-report-v3';
import { adaptDirectPresentation } from '../src/presentation/direct-presentation-adapter';
import { communityReport, processedImage } from './community-ui-fixtures';

const capture: AnalysisCapture = {
  image: processedImage,
  context: {
    instrument: 'BTC/USDT', timeframe: '15m', site: 'tradingview',
    exchange: 'BINANCE', pageType: 'advanced-chart',
  },
};

function report(): CommunityReportV3 {
  return structuredClone(communityReport);
}

describe('Direct presentation adapter', () => {
  it('maps the complete visible report and actual capture metadata', () => {
    const bundle = adaptDirectPresentation(report(), capture, 'en');

    expect(bundle.report).toMatchObject({
      schemaVersion: 'presentation-1.0',
      context: {
        instrument: 'BTC/USDT', venue: 'BINANCE', outputLanguage: 'en',
        captures: [{
          captureId: 'C01', timeframe: '15m', role: null,
          instrument: 'BTC/USDT', width: 640, height: 360,
        }],
      },
      conclusion: communityReport.conclusion,
      levels: [{ id: 'L01', captureId: 'C01', type: 'support' }],
      tradeSignals: [{
        id: 'S01', captureId: 'C01', direction: 'long',
        entry: { priceLabel: '65,350' }, stopLoss: { priceLabel: '64,900' },
        invalidation: null,
      }],
      patterns: [{ id: 'P01', captureId: 'C01', name: 'Rising channel' }],
      timeframeViews: [{
        captureId: 'C01', timeframe: '15m', role: null,
        trend: 'bullish', structure: 'hh-hl', conclusion: 'Higher lows remain visible.',
      }],
    });
  });

  it('turns Direct coordinates into deterministic normalized drawings', () => {
    const bundle = adaptDirectPresentation(report(), capture, 'en');

    expect(bundle.drawings.map(({ id, refId, meaning, tool }) => ({ id, refId, meaning, tool }))).toEqual([
      { id: 'D01', refId: 'L01', meaning: 'support', tool: 'horizontal_line' },
      { id: 'D02', refId: 'S01', meaning: 'long_entry', tool: 'entry_arrow' },
      { id: 'D03', refId: 'S01', meaning: 'stop', tool: 'stop_line' },
      { id: 'D04', refId: 'S01', meaning: 'target', tool: 'target_line' },
      { id: 'D05', refId: 'S01', meaning: 'target', tool: 'target_line' },
      { id: 'D06', refId: 'P01', meaning: 'pattern', tool: 'channel' },
    ]);
    expect(bundle.drawings[1]).toMatchObject({
      caption: 'Approximately 1:2',
      points: [{ xRatio: 0.9, yRatio: 0.33, priceLabel: '65,350', timeAnchor: 'Rightmost candle' }],
    });
    expect(bundle.drawings[5]?.points).toEqual([
      { xRatio: 0.2, yRatio: 0.5, priceLabel: null, timeAnchor: null },
      { xRatio: 0.8, yRatio: 0.2, priceLabel: null, timeAnchor: null },
      { xRatio: 0.2, yRatio: 0.7, priceLabel: null, timeAnchor: null },
      { xRatio: 0.8, yRatio: 0.4, priceLabel: null, timeAnchor: null },
    ]);
  });

  it('preserves short direction and converts range and polyline geometry without guessing', () => {
    const value = report();
    value.tradeSignals[0]!.direction = 'short';
    value.patterns = [
      {
        ...value.patterns[0]!, id: 'P01', name: 'Range',
        geometry: {
          geometryKind: 'range', points: [],
          upperBoundary: { start: { xRatio: 0.1, yRatio: 0.2 }, end: { xRatio: 0.9, yRatio: 0.2 } },
          lowerBoundary: { start: { xRatio: 0.1, yRatio: 0.8 }, end: { xRatio: 0.9, yRatio: 0.8 } },
        },
      },
      {
        ...value.patterns[0]!, id: 'P02', name: 'Trend line',
        geometry: {
          geometryKind: 'polyline',
          points: [{ xRatio: 0.2, yRatio: 0.7 }, { xRatio: 0.8, yRatio: 0.3 }],
          upperBoundary: null, lowerBoundary: null,
        },
      },
    ];

    const bundle = adaptDirectPresentation(value, capture, 'zh-CN');

    expect(bundle.drawings.find(({ tool }) => tool === 'entry_arrow')?.meaning).toBe('short_entry');
    expect(bundle.drawings.filter(({ layer }) => layer === 'pattern').map(({ refId, tool }) => ({ refId, tool }))).toEqual([
      { refId: 'P01', tool: 'range' },
      { refId: 'P02', tool: 'trend_line' },
    ]);
    expect(bundle.report.context.outputLanguage).toBe('zh-CN');
  });

  it('keeps an undetected Direct timeframe nullable instead of inventing one', () => {
    const value = report();
    value.chart.timeframe = null;
    const withoutTimeframe: AnalysisCapture = {
      ...capture,
      context: { ...capture.context, timeframe: null },
    };

    const bundle = adaptDirectPresentation(value, withoutTimeframe, 'en');

    expect(bundle.report.context.captures[0]?.timeframe).toBeNull();
    expect(bundle.report.timeframeViews[0]?.timeframe).toBeNull();
  });
});
