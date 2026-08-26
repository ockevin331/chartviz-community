import type { CommunityReport } from '../src/analysis/community-report';
import type { AnnotatedReportImages } from '../src/annotations/annotation-types';
import type { ProcessedImage } from '../src/capture/image-types';

export const processedImage: ProcessedImage = {
  mediaType: 'image/png',
  dataUrl: 'data:image/png;base64,AAAA',
  width: 640,
  height: 360,
};

export const communityReport: CommunityReport = {
  schemaVersion: 'community-1.0',
  chart: { instrument: 'BTC/USDT', timeframe: '15m', limitations: ['Right edge partly obscured.'] },
  marketView: {
    bias: 'bullish', phase: 'trend', strength: 'moderate', summary: 'Higher lows remain visible.', evidenceIds: ['e-price'],
  },
  evidence: [{
    id: 'e-price', category: 'price', observation: 'Visible lows step upward.', implication: 'Buyers defend higher prices.', timeAnchor: 'Right half', confidence: 0.82,
  }],
  volume: { summary: 'Volume expands on the latest upward candles.', evidenceIds: ['e-price'] },
  indicators: [{ name: 'RSI', summary: 'RSI is above its midpoint.', implication: 'Momentum leans upward.', evidenceIds: ['e-price'] }],
  levels: [{
    id: 'support-main', type: 'support', priceLabel: '63,900', reason: 'Repeated reactions are visible.', timeAnchor: 'Right half', yRatio: 0.7, evidenceIds: ['e-price'],
  }],
  scenarios: {
    long: {
      condition: 'Close above resistance.', entry: 'Enter after confirmation.', stop: 'Below support.', targets: ['Prior high', 'Upper boundary'], reason: 'Structure stays constructive.', evidenceIds: ['e-price'],
    },
    short: {
      condition: 'Close below support.', entry: 'Enter after confirmation.', stop: 'Above resistance.', targets: ['Lower boundary'], reason: 'Support failure weakens structure.', evidenceIds: ['e-price'],
    },
    wait: { condition: 'Remain inside the range.', reason: 'No visible confirmation yet.', evidenceIds: ['e-price'] },
  },
  patterns: [{
    id: 'channel', name: 'Rising channel', status: 'forming', bias: 'bullish', timeRange: 'Left to right', explanation: 'Alternating pivots stay inside rising boundaries.', confidence: 0.74,
    points: [{ xRatio: 0.2, yRatio: 0.7 }, { xRatio: 0.8, yRatio: 0.3 }], evidenceIds: ['e-price'],
  }],
  signals: [{
    id: 'breakout-long', direction: 'long', timeAnchor: 'Rightmost candle', reason: 'Wait for a visible breakout close.',
    entry: { priceLabel: '65,350', xRatio: 0.9, yRatio: 0.33 }, stop: { priceLabel: '64,900', yRatio: 0.49 },
    targets: [{ priceLabel: '65,850', yRatio: 0.2 }, { priceLabel: '66,200', yRatio: 0.1 }],
    riskReward: 'Approximately 1:2', confidence: 0.71, evidenceIds: ['e-price'],
  }],
  riskNotice: 'Educational screenshot analysis only.',
};

export const annotatedImages: AnnotatedReportImages = {
  levels: { id: 'levels', kind: 'levels', title: 'Support and resistance', dataUrl: 'data:image/png;base64,LEVELS', width: 640, height: 360 },
  signals: {
    'breakout-long': { id: 'breakout-long', kind: 'signal', title: 'LONG breakout-long', dataUrl: 'data:image/png;base64,SIGNAL', width: 640, height: 360 },
  },
  patterns: {
    channel: { id: 'channel', kind: 'pattern', title: 'Rising channel', dataUrl: 'data:image/png;base64,PATTERN', width: 640, height: 360 },
  },
};
