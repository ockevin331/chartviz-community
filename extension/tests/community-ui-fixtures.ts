import type { CommunityReportV3 } from '../src/analysis/stages/community-report-v3-schema';
import type { AnnotatedReportImages, PresentationAnnotatedImages } from '../src/annotations/annotation-types';
import type { ProcessedImage } from '../src/capture/image-types';

export const processedImage: ProcessedImage = {
  mediaType: 'image/png',
  dataUrl: 'data:image/png;base64,AAAA',
  width: 640,
  height: 360,
};

export const communityReport: CommunityReportV3 = {
  schemaVersion: 'community-3.0',
  chart: { instrument: 'BTC/USDT', timeframe: '15m' },
  conclusion: {
    direction: 'long', trend: 'bullish', structure: 'hh-hl', strength: 'moderate',
    summary: 'Higher lows remain visible.', primaryRisk: 'Resistance may reject price.', confidence: 0.78,
  },
  marketExplanation: {
    priceAction: { summary: 'Price advances in steps.', evidence: ['Visible lows step upward.', 'Buyers defend higher prices.'], timeAnchor: 'Right half' },
    volume: { summary: 'Volume expands on the latest upward candles.', implication: 'Participation supports the upward test.', timeAnchor: 'Right-side volume bars' },
    indicators: [{ id: 'I01', name: 'RSI', state: 'RSI is above its midpoint.', implication: 'Momentum leans upward.', timeAnchor: 'Right edge of RSI pane' }],
  },
  levels: [{
    id: 'L01', type: 'support', tier: 'major', status: 'holding', priceLabel: '63,900', reason: 'Repeated reactions are visible.', timeAnchor: 'Right half', yRatio: 0.7, confidence: 0.84,
  }],
  tradePlan: {
    summary: 'Wait for the visible range boundary to resolve.',
    long: {
      condition: 'Close above resistance.', entry: 'Enter after confirmation.', stop: 'Below support.', targets: ['Prior high', 'Upper boundary'], reason: 'Structure stays constructive.',
    },
    short: {
      condition: 'Close below support.', entry: 'Enter after confirmation.', stop: 'Above resistance.', targets: ['Lower boundary'], reason: 'Support failure weakens structure.',
    },
    wait: { condition: 'Remain inside the range.', reason: 'No visible confirmation yet.' },
  },
  patterns: [{
    id: 'P01', name: 'Rising channel', status: 'forming', bias: 'bullish', timeRange: 'Left to right', evidence: 'Alternating pivots stay inside rising boundaries.',
    confirmation: 'Close above the upper boundary.', invalidation: 'Close below the lower boundary.', confidence: 0.74,
    geometry: {
      geometryKind: 'channel', points: [],
      upperBoundary: { start: { xRatio: 0.2, yRatio: 0.5 }, end: { xRatio: 0.8, yRatio: 0.2 } },
      lowerBoundary: { start: { xRatio: 0.2, yRatio: 0.7 }, end: { xRatio: 0.8, yRatio: 0.4 } },
    },
  }],
  tradeSignals: [{
    id: 'S01', direction: 'long', signalType: 'Breakout and retest', signalTime: 'Rightmost candle',
    thesisAtSignal: 'Wait for a visible breakout close.', evidenceAtSignal: ['Higher lows lead into resistance.'],
    entry: { priceLabel: '65,350', xRatio: 0.9, yRatio: 0.33 }, stopLoss: { priceLabel: '64,900', yRatio: 0.49 },
    takeProfits: [{ priceLabel: '65,850', yRatio: 0.2 }, { priceLabel: '66,200', yRatio: 0.1 }],
    riskReward: 'Approximately 1:2', confidence: 0.71,
  }],
  riskNotice: 'Educational screenshot analysis only.',
};

export const annotatedImages: AnnotatedReportImages = {
  levels: { id: 'levels', kind: 'levels', title: 'Support and resistance', dataUrl: 'data:image/png;base64,LEVELS', width: 640, height: 360 },
  signals: {
    S01: { id: 'S01', kind: 'signal', title: 'LONG signal', dataUrl: 'data:image/png;base64,SIGNAL', width: 640, height: 360 },
  },
  patterns: {
    P01: { id: 'P01', kind: 'pattern', title: 'Rising channel', dataUrl: 'data:image/png;base64,PATTERN', width: 640, height: 360 },
  },
};

export const presentationAnnotatedImages: PresentationAnnotatedImages = {
  levels: {
    C01: { ...annotatedImages.levels!, id: 'levels-C01' },
  },
  signals: annotatedImages.signals,
  patterns: annotatedImages.patterns,
};
