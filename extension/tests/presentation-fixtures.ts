export const validPresentationBundle = {
  report: {
    schemaVersion: 'presentation-1.0',
    context: {
      instrument: 'BTC/USDT',
      venue: 'BINANCE',
      outputLanguage: 'en',
      captures: [{
        captureId: 'C01', timeframe: '15m', role: null,
        instrument: 'BTC/USDT', width: 640, height: 360,
      }],
    },
    conclusion: {
      direction: 'long', trend: 'bullish', structure: 'hh-hl', strength: 'moderate',
      summary: 'Higher lows remain visible.', primaryRisk: 'Resistance may reject price.', confidence: 0.78,
    },
    marketExplanation: {
      priceAction: {
        summary: 'Price advances in steps.',
        evidence: ['Visible lows step upward.', 'Buyers defend higher prices.'],
        timeAnchor: 'Right half',
      },
      volume: {
        summary: 'Volume expands on the latest upward candles.',
        implication: 'Participation supports the upward test.',
        timeAnchor: 'Right-side volume bars',
      },
      indicators: [{
        id: 'I01', name: 'RSI', state: 'RSI is above its midpoint.',
        implication: 'Momentum leans upward.', timeAnchor: 'Right edge of RSI pane',
      }],
    },
    levels: [{
      id: 'L01', captureId: 'C01', type: 'support', tier: 'major', status: 'holding',
      priceLabel: '63,900', reason: 'Repeated reactions are visible.',
      timeAnchor: 'Right half', confidence: 0.84,
    }],
    tradePlan: {
      summary: 'Wait for the visible range boundary to resolve.',
      long: {
        condition: 'Close above resistance.', entry: 'Enter after confirmation.',
        stop: 'Below support.', targets: ['Prior high', 'Upper boundary'],
        reason: 'Structure stays constructive.',
      },
      short: {
        condition: 'Close below support.', entry: 'Enter after confirmation.',
        stop: 'Above resistance.', targets: ['Lower boundary'],
        reason: 'Support failure weakens structure.',
      },
      wait: { condition: 'Remain inside the range.', reason: 'No visible confirmation yet.' },
    },
    tradeSignals: [{
      id: 'S01', captureId: 'C01', direction: 'long', signalType: 'Breakout and retest',
      signalTime: 'Rightmost candle', thesisAtSignal: 'Wait for a visible breakout close.',
      evidenceAtSignal: ['Higher lows lead into resistance.'],
      entry: { priceLabel: '65,350' }, stopLoss: { priceLabel: '64,900' },
      takeProfits: [{ priceLabel: '65,850' }], riskReward: 'Approximately 1:2', confidence: 0.71,
      invalidation: 'A close below support invalidates the signal.',
    }],
    patterns: [{
      id: 'P01', captureId: 'C01', name: 'Rising channel', status: 'forming', bias: 'bullish',
      timeRange: 'Left to right', evidence: 'Pivots remain inside rising boundaries.',
      confirmation: 'Close above the upper boundary.', invalidation: 'Close below the lower boundary.',
      confidence: 0.74,
    }],
    timeframeViews: [{
      captureId: 'C01', timeframe: '15m', role: null, trend: 'bullish', structure: 'hh-hl',
      conclusion: 'Higher lows support a bullish view.', confidence: 0.78,
      evidence: ['Visible lows step upward.'],
    }],
    riskNotice: 'Educational screenshot analysis only.',
  },
  drawings: [
    {
      id: 'D01', captureId: 'C01', layer: 'levels', refId: 'L01',
      meaning: 'support', caption: null, tool: 'horizontal_line',
      points: [{ xRatio: null, yRatio: 0.7, priceLabel: '63,900', timeAnchor: 'Right half' }],
    },
    {
      id: 'D02', captureId: 'C01', layer: 'signal', refId: 'S01',
      meaning: 'long_entry', caption: 'Approximately 1:2', tool: 'entry_arrow',
      points: [{ xRatio: 0.9, yRatio: 0.33, priceLabel: '65,350', timeAnchor: 'Rightmost candle' }],
    },
    {
      id: 'D03', captureId: 'C01', layer: 'signal', refId: 'S01',
      meaning: 'stop', caption: null, tool: 'stop_line',
      points: [{ xRatio: null, yRatio: 0.49, priceLabel: '64,900', timeAnchor: null }],
    },
    {
      id: 'D04', captureId: 'C01', layer: 'signal', refId: 'S01',
      meaning: 'target', caption: null, tool: 'target_line',
      points: [{ xRatio: null, yRatio: 0.2, priceLabel: '65,850', timeAnchor: null }],
    },
    {
      id: 'D05', captureId: 'C01', layer: 'pattern', refId: 'P01',
      meaning: 'pattern', caption: 'Rising channel', tool: 'channel',
      points: [
        { xRatio: 0.2, yRatio: 0.5, priceLabel: null, timeAnchor: null },
        { xRatio: 0.8, yRatio: 0.2, priceLabel: null, timeAnchor: null },
        { xRatio: 0.2, yRatio: 0.7, priceLabel: null, timeAnchor: null },
        { xRatio: 0.8, yRatio: 0.4, priceLabel: null, timeAnchor: null },
      ],
    },
  ],
} as const;

