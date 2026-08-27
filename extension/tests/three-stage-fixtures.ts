export const validVisualFacts = {
  schemaVersion: 'community-visual-1.0',
  chart: { instrument: 'BTC/USDT', timeframe: '15m' },
  imageQuality: { usable: true, summary: 'The candles and price scale are readable.', limitations: [] },
  pricePanelBounds: { leftRatio: 0.05, topRatio: 0.12, rightRatio: 0.94, bottomRatio: 0.72 },
  priceScaleAnchors: [
    { price: 66_000, label: '66,000', yRatio: 0.2 },
    { price: 64_000, label: '64,000', yRatio: 0.6 },
  ],
  priceAction: {
    trend: 'bullish', structure: 'hh-hl', strength: 'moderate',
    summary: 'Visible swing lows rise from left to right.',
    timeAnchor: 'Middle to right side', evidence: ['The latest pullback remains above the prior swing low.'],
  },
  volume: {
    summary: 'Volume expands on the latest upward leg.',
    implication: 'Participation supports the move but does not confirm a breakout.',
    timeAnchor: 'Right-side volume bars',
  },
  indicators: [{
    id: 'I01', name: 'RSI', state: 'Above its visible midpoint.',
    implication: 'Momentum leans upward without a readable extreme.',
    timeAnchor: 'Right edge of the RSI panel', confidence: 0.8,
  }],
  levels: [{
    id: 'L01', type: 'support', priceLabel: '64,000', price: 64_000,
    yRatio: 0.6, reason: 'Several pullbacks react near this price.',
    timeAnchor: 'Middle and right side', confidence: 0.86,
  }],
  patterns: [{
    id: 'P01', name: 'Rising channel', status: 'forming', bias: 'bullish',
    timeRange: 'Left side to right edge', evidence: 'Swing highs and lows rise inside parallel boundaries.',
    confirmation: 'A close above the upper boundary.', invalidation: 'A close below the lower boundary.',
    confidence: 0.74,
    geometry: {
      geometryKind: 'channel', points: [],
      upperBoundary: { start: { xRatio: 0.2, yRatio: 0.45 }, end: { xRatio: 0.82, yRatio: 0.2 } },
      lowerBoundary: { start: { xRatio: 0.2, yRatio: 0.65 }, end: { xRatio: 0.82, yRatio: 0.4 } },
    },
  }],
  segments: [{
    id: 'SEG01', type: 'impulse_up', startAnchor: 'Middle of chart', endAnchor: 'Right side',
    startPriceLabel: '64,000', endPriceLabel: '65,500',
    startPoint: { xRatio: 0.42, yRatio: 0.6 }, endPoint: { xRatio: 0.82, yRatio: 0.3 },
    strength: 'moderate', priceAction: 'Price advances with higher swing lows.',
    volumeBehavior: 'Volume expands during the advance.', indicatorSignals: ['RSI stays above its midpoint.'],
    evidence: ['Pullbacks remain shallow relative to the upward legs.'],
  }, {
    id: 'SEG02', type: 'pullback_down', startAnchor: 'Right side', endAnchor: 'Rightmost candles',
    startPriceLabel: '65,500', endPriceLabel: '65,100',
    startPoint: { xRatio: 0.82, yRatio: 0.3 }, endPoint: { xRatio: 0.92, yRatio: 0.38 },
    strength: 'weak', priceAction: 'The pullback remains above the prior swing low.',
    volumeBehavior: 'Volume contracts during the pullback.', indicatorSignals: ['RSI remains above its midpoint.'],
    evidence: ['The decline covers less distance than the preceding advance.'],
  }],
} as const;

export const validSignalFacts = {
  schemaVersion: 'community-signals-1.0',
  signals: [{
    id: 'S01', direction: 'long', signalType: 'Breakout and retest', signalTime: 'Rightmost closed candle',
    thesisAtSignal: 'Price accepts above the visible boundary after a controlled retest.',
    evidenceAtSignal: ['Higher lows lead into resistance.', 'Volume expands on the breakout attempt.'],
    entry: { priceLabel: '65,300', price: 65_300, xRatio: 0.86, yRatio: 0.36 },
    stopLoss: { priceLabel: '64,900', price: 64_900, yRatio: 0.44 },
    takeProfits: [{ priceLabel: '66,100', price: 66_100, yRatio: 0.18 }],
    riskReward: '1:2', confidence: 0.76,
  }],
} as const;

export const validReportV3 = {
  schemaVersion: 'community-3.0',
  chart: { instrument: 'BTC/USDT', timeframe: '15m' },
  conclusion: {
    direction: 'sideways', trend: 'sideways', structure: 'range', strength: 'moderate',
    summary: 'Price is rotating between visible support and resistance.',
    primaryRisk: 'A close outside the range can invalidate the sideways conclusion.', confidence: 0.72,
  },
  marketExplanation: {
    priceAction: {
      summary: 'Recent candles overlap inside the visible range.',
      evidence: ['Repeated reactions appear near both range boundaries.'], timeAnchor: 'Right half of chart',
    },
    volume: {
      summary: 'Volume contracts during the latest rotation.',
      implication: 'Participation is insufficient to confirm a directional break.', timeAnchor: 'Right-side volume bars',
    },
    indicators: [{
      id: 'I01', name: 'RSI', state: 'Near its midpoint.',
      implication: 'Momentum is balanced rather than directional.', timeAnchor: 'Right edge of RSI panel',
    }],
  },
  levels: [{
    id: 'L01', type: 'support', tier: 'nearest', status: 'holding', priceLabel: '64,000',
    reason: 'Several visible pullbacks react here.', timeAnchor: 'Middle and right side', yRatio: 0.6, confidence: 0.86,
  }],
  tradePlan: {
    summary: 'Treat the current range as unresolved until one boundary is accepted.',
    long: {
      condition: 'Price closes above resistance and holds it on a retest.', entry: 'After visible acceptance above resistance.',
      stop: 'Below the reclaimed boundary.', targets: ['The next visible swing high.'],
      reason: 'Acceptance would show buyers sustaining higher prices.',
    },
    short: {
      condition: 'Price closes below support and fails to reclaim it.', entry: 'After visible acceptance below support.',
      stop: 'Above the lost boundary.', targets: ['The next visible swing low.'],
      reason: 'Acceptance would show sellers sustaining lower prices.',
    },
    wait: { condition: 'Price remains inside the range.', reason: 'Neither side has established acceptance.' },
  },
  tradeSignals: [{
    id: 'S01', direction: 'long', signalType: 'Breakout and retest', signalTime: 'Rightmost closed candle',
    thesisAtSignal: 'Price accepts above the visible boundary after a controlled retest.',
    evidenceAtSignal: ['Higher lows lead into resistance.', 'Volume expands on the breakout attempt.'],
    entry: { priceLabel: '65,300', xRatio: 0.86, yRatio: 0.36 },
    stopLoss: { priceLabel: '64,900', yRatio: 0.44 },
    takeProfits: [{ priceLabel: '66,100', yRatio: 0.18 }], riskReward: '1:2', confidence: 0.76,
  }],
  patterns: [{
    id: 'P01', name: 'Rising channel', status: 'forming', bias: 'bullish',
    timeRange: 'Left side to right edge', evidence: 'Swing highs and lows rise inside parallel boundaries.',
    confirmation: 'A close above the upper boundary.', invalidation: 'A close below the lower boundary.',
    confidence: 0.74,
    geometry: {
      geometryKind: 'channel', points: [],
      upperBoundary: { start: { xRatio: 0.2, yRatio: 0.45 }, end: { xRatio: 0.82, yRatio: 0.2 } },
      lowerBoundary: { start: { xRatio: 0.2, yRatio: 0.65 }, end: { xRatio: 0.82, yRatio: 0.4 } },
    },
  }],
  riskNotice: 'Educational screenshot analysis only.',
} as const;
