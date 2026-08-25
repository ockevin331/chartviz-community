import { describe, expect, it } from 'vitest';
import { parseCommunityReport } from '../src/analysis/community-report';

const completeReportFixture = {
  schemaVersion: 'community-1.0',
  chart: {
    instrument: 'BTC/USDT',
    timeframe: '15m',
    limitations: ['The rightmost volume bar is partly obscured.'],
  },
  marketView: {
    bias: 'bullish',
    phase: 'trend',
    strength: 'moderate',
    summary: 'Price is making higher lows while testing nearby resistance.',
    evidenceIds: ['price-structure', 'price-pullback'],
  },
  evidence: [
    {
      id: 'price-structure',
      category: 'price',
      observation: 'The visible swing lows step upward from left to right.',
      implication: 'Buyers are defending progressively higher prices.',
      timeAnchor: 'Middle third to right edge',
      confidence: 0.88,
    },
    {
      id: 'price-pullback',
      category: 'price',
      observation: 'The latest pullback remains above the prior swing low.',
      implication: 'The visible uptrend structure is intact but conditional.',
      timeAnchor: 'Rightmost quarter',
      confidence: 0.82,
    },
    {
      id: 'volume-rise',
      category: 'volume',
      observation: 'Volume expands on the latest upward candle sequence.',
      implication: 'Participation supports the upward test.',
      timeAnchor: 'Right edge',
      confidence: 0.73,
    },
    {
      id: 'rsi-momentum',
      category: 'indicator',
      observation: 'RSI is above its midpoint without reaching the upper extreme.',
      implication: 'Momentum is positive but not visibly exhausted.',
      timeAnchor: 'Right edge of RSI pane',
      confidence: 0.79,
    },
    {
      id: 'macd-cross',
      category: 'indicator',
      observation: 'The MACD line is above the signal line and the histogram is positive.',
      implication: 'Short-term momentum supports the bullish view.',
      timeAnchor: 'Right edge of MACD pane',
      confidence: 0.77,
    },
    {
      id: 'level-support',
      category: 'level',
      observation: 'Two visible pullbacks react near the lower marked zone.',
      implication: 'This area may act as support while it holds.',
      timeAnchor: 'Lower third',
      confidence: 0.84,
    },
    {
      id: 'level-resistance',
      category: 'level',
      observation: 'Several candle highs cluster near the upper marked zone.',
      implication: 'This area may cap price until a confirmed break.',
      timeAnchor: 'Upper third',
      confidence: 0.86,
    },
    {
      id: 'pattern-channel',
      category: 'pattern',
      observation: 'Four alternating pivots fit a rising channel.',
      implication: 'The channel favors continuation while its lower boundary holds.',
      timeAnchor: 'Left-middle through right edge',
      confidence: 0.74,
    },
    {
      id: 'pattern-top',
      category: 'pattern',
      observation: 'Two highs test a similar price area.',
      implication: 'A reversal remains possible only after support breaks.',
      timeAnchor: 'Right half',
      confidence: 0.61,
    },
    {
      id: 'signal-long',
      category: 'signal',
      observation: 'A close above resistance would confirm a breakout attempt.',
      implication: 'A conditional long setup can be monitored.',
      timeAnchor: 'Rightmost candle',
      confidence: 0.71,
    },
    {
      id: 'signal-short',
      category: 'signal',
      observation: 'A rejection followed by a support break would weaken structure.',
      implication: 'A conditional short setup can be monitored.',
      timeAnchor: 'Rightmost candles',
      confidence: 0.64,
    },
  ],
  volume: {
    summary: 'Visible volume increases during the latest upward push.',
    evidenceIds: ['volume-rise'],
  },
  indicators: [
    {
      name: 'RSI',
      summary: 'RSI is visibly above its midpoint.',
      implication: 'Momentum currently leans upward.',
      evidenceIds: ['rsi-momentum'],
    },
    {
      name: 'MACD',
      summary: 'MACD is visibly above its signal line.',
      implication: 'The visible momentum signal is positive.',
      evidenceIds: ['macd-cross'],
    },
  ],
  levels: [
    {
      id: 'support-main',
      type: 'support',
      priceLabel: '63,900',
      reason: 'Repeated pullback reactions are visible here.',
      timeAnchor: 'Middle and right portions',
      yRatio: 0.72,
      evidenceIds: ['level-support'],
    },
    {
      id: 'support-near',
      type: 'support',
      priceLabel: '64,450',
      reason: 'The latest shallow pullback pauses here.',
      timeAnchor: 'Right quarter',
      yRatio: 0.61,
      evidenceIds: ['price-pullback'],
    },
    {
      id: 'resistance-near',
      type: 'resistance',
      priceLabel: '65,300',
      reason: 'Recent candle highs cluster here.',
      timeAnchor: 'Right quarter',
      yRatio: 0.34,
      evidenceIds: ['level-resistance'],
    },
    {
      id: 'resistance-main',
      type: 'resistance',
      priceLabel: '65,850',
      reason: 'The highest visible rejection begins here.',
      timeAnchor: 'Upper-right area',
      yRatio: 0.2,
      evidenceIds: ['level-resistance'],
    },
  ],
  scenarios: {
    long: {
      condition: 'Price closes above nearby resistance with visible follow-through.',
      entry: 'After a breakout close or a controlled retest.',
      stop: 'Below the reclaimed resistance area.',
      targets: ['The prior visible high', 'The upper chart boundary'],
      reason: 'Confirmation would preserve higher-low structure.',
      evidenceIds: ['price-structure', 'signal-long'],
    },
    short: {
      condition: 'Price rejects resistance and then closes below nearby support.',
      entry: 'After the support break is visible.',
      stop: 'Above the rejection high.',
      targets: ['The main support area'],
      reason: 'A support break would invalidate the latest higher low.',
      evidenceIds: ['price-pullback', 'signal-short'],
    },
    wait: {
      condition: 'Price remains between nearby support and resistance.',
      reason: 'Waiting avoids acting inside an unresolved range.',
      evidenceIds: ['level-support', 'level-resistance'],
    },
  },
  patterns: [
    {
      id: 'rising-channel',
      name: 'Rising channel',
      status: 'forming',
      bias: 'bullish',
      timeRange: 'Left-middle through right edge',
      explanation: 'Alternating pivots remain contained by rising boundaries.',
      confidence: 0.74,
      points: [
        { xRatio: 0.18, yRatio: 0.74 },
        { xRatio: 0.4, yRatio: 0.38 },
        { xRatio: 0.62, yRatio: 0.61 },
        { xRatio: 0.88, yRatio: 0.27 },
      ],
      evidenceIds: ['pattern-channel'],
    },
    {
      id: 'possible-double-top',
      name: 'Possible double top',
      status: 'forming',
      bias: 'bearish',
      timeRange: 'Right half',
      explanation: 'Two similar highs matter only if the intervening support breaks.',
      confidence: 0.61,
      points: [
        { xRatio: 0.58, yRatio: 0.31 },
        { xRatio: 0.72, yRatio: 0.55 },
        { xRatio: 0.86, yRatio: 0.3 },
      ],
      evidenceIds: ['pattern-top'],
    },
  ],
  signals: [
    {
      id: 'breakout-long',
      direction: 'long',
      timeAnchor: 'Rightmost candle',
      reason: 'Use only after a visible breakout close.',
      entry: { priceLabel: '65,350', xRatio: 0.91, yRatio: 0.33 },
      stop: { priceLabel: '64,900', yRatio: 0.49 },
      targets: [
        { priceLabel: '65,850', yRatio: 0.2 },
        { priceLabel: '66,200', yRatio: 0.1 },
      ],
      riskReward: 'Approximately 1:2 on the visible scale',
      confidence: 0.71,
      evidenceIds: ['signal-long', 'level-resistance'],
    },
    {
      id: 'breakdown-short',
      direction: 'short',
      timeAnchor: 'Rightmost candles',
      reason: 'Use only after visible support failure.',
      entry: { priceLabel: '64,400', xRatio: 0.94, yRatio: 0.62 },
      stop: { priceLabel: '64,950', yRatio: 0.48 },
      targets: [{ priceLabel: '63,900', yRatio: 0.72 }],
      riskReward: null,
      confidence: 0.64,
      evidenceIds: ['signal-short', 'level-support'],
    },
  ],
  riskNotice: 'This screenshot-based analysis is educational and each scenario requires visible confirmation.',
};

// The mutation table intentionally creates values outside the production type.
// Keep that unsafety confined to this test-only boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MutableReport = Record<string, any>;
type Mutation = (report: MutableReport) => void;

function mutated(mutate: Mutation): MutableReport {
  const report = structuredClone(completeReportFixture) as MutableReport;
  mutate(report);
  return report;
}

function expectRejected(mutate: Mutation): void {
  expect(() => parseCommunityReport(mutated(mutate))).toThrow();
}

describe('parseCommunityReport', () => {
  it('accepts the complete hand-checked Community report fixture', () => {
    const parsed = parseCommunityReport(completeReportFixture);

    expect(parsed).toEqual(completeReportFixture);
    expect(parsed.evidence).toHaveLength(11);
    expect(parsed.levels).toHaveLength(4);
    expect(parsed.patterns).toHaveLength(2);
    expect(parsed.signals).toHaveLength(2);
    expect(parsed.indicators.map(({ name }) => name)).toEqual(['RSI', 'MACD']);
  });

  it('allows no trade signals and does not synthesize one', () => {
    const parsed = parseCommunityReport(mutated((report) => { report.signals = []; }));
    expect(parsed.signals).toEqual([]);
  });

  it('allows volume to be omitted with null', () => {
    const parsed = parseCommunityReport(mutated((report) => { report.volume = null; }));
    expect(parsed.volume).toBeNull();
  });

  it.each([
    ['root', (report) => { report.unexpected = true; }],
    ['chart', (report) => { Object.assign(report.chart, { unexpected: true }); }],
    ['market view', (report) => { Object.assign(report.marketView, { unexpected: true }); }],
    ['evidence item', (report) => { Object.assign(report.evidence[0], { unexpected: true }); }],
    ['volume observation', (report) => { Object.assign(report.volume!, { unexpected: true }); }],
    ['indicator observation', (report) => { Object.assign(report.indicators[0], { unexpected: true }); }],
    ['level', (report) => { Object.assign(report.levels[0], { unexpected: true }); }],
    ['scenarios container', (report) => { Object.assign(report.scenarios, { unexpected: true }); }],
    ['long scenario', (report) => { Object.assign(report.scenarios.long, { unexpected: true }); }],
    ['short scenario', (report) => { Object.assign(report.scenarios.short, { unexpected: true }); }],
    ['wait scenario', (report) => { Object.assign(report.scenarios.wait, { unexpected: true }); }],
    ['pattern', (report) => { Object.assign(report.patterns[0], { unexpected: true }); }],
    ['pattern point', (report) => { Object.assign(report.patterns[0].points[0], { unexpected: true }); }],
    ['trade signal', (report) => { Object.assign(report.signals[0], { unexpected: true }); }],
    ['signal entry', (report) => { Object.assign(report.signals[0].entry, { unexpected: true }); }],
    ['signal stop', (report) => { Object.assign(report.signals[0].stop, { unexpected: true }); }],
    ['signal target', (report) => { Object.assign(report.signals[0].targets[0], { unexpected: true }); }],
  ] satisfies Array<[string, Mutation]>)('rejects an unknown property on the %s object', (_name, mutate) => {
    expectRejected(mutate);
  });

  it.each([
    ['evidence confidence below zero', (report) => { report.evidence[0].confidence = -0.01; }],
    ['evidence confidence above one', (report) => { report.evidence[0].confidence = 1.01; }],
    ['level y coordinate below zero', (report) => { report.levels[0].yRatio = -0.01; }],
    ['level y coordinate above one', (report) => { report.levels[0].yRatio = 1.01; }],
    ['pattern confidence below zero', (report) => { report.patterns[0].confidence = -0.01; }],
    ['pattern confidence above one', (report) => { report.patterns[0].confidence = 1.01; }],
    ['pattern point x coordinate below zero', (report) => { report.patterns[0].points[0].xRatio = -0.01; }],
    ['pattern point x coordinate above one', (report) => { report.patterns[0].points[0].xRatio = 1.01; }],
    ['pattern point y coordinate below zero', (report) => { report.patterns[0].points[0].yRatio = -0.01; }],
    ['pattern point y coordinate above one', (report) => { report.patterns[0].points[0].yRatio = 1.01; }],
    ['signal entry x coordinate below zero', (report) => { report.signals[0].entry.xRatio = -0.01; }],
    ['signal entry x coordinate above one', (report) => { report.signals[0].entry.xRatio = 1.01; }],
    ['signal entry y coordinate below zero', (report) => { report.signals[0].entry.yRatio = -0.01; }],
    ['signal entry y coordinate above one', (report) => { report.signals[0].entry.yRatio = 1.01; }],
    ['signal stop y coordinate below zero', (report) => { report.signals[0].stop.yRatio = -0.01; }],
    ['signal stop y coordinate above one', (report) => { report.signals[0].stop.yRatio = 1.01; }],
    ['signal target y coordinate below zero', (report) => { report.signals[0].targets[0].yRatio = -0.01; }],
    ['signal target y coordinate above one', (report) => { report.signals[0].targets[0].yRatio = 1.01; }],
    ['signal confidence below zero', (report) => { report.signals[0].confidence = -0.01; }],
    ['signal confidence above one', (report) => { report.signals[0].confidence = 1.01; }],
  ] satisfies Array<[string, Mutation]>)('rejects %s', (_name, mutate) => {
    expectRejected(mutate);
  });

  it('accepts inclusive zero and one numeric boundaries', () => {
    const parsed = parseCommunityReport(mutated((report) => {
      report.evidence[0].confidence = 0;
      report.evidence[1].confidence = 1;
      report.levels[0].yRatio = 0;
      report.levels[1].yRatio = 1;
      report.patterns[0].confidence = 0;
      report.patterns[1].confidence = 1;
      report.patterns[0].points[0] = { xRatio: 0, yRatio: 1 };
      report.signals[0].entry = { priceLabel: '65,350', xRatio: 1, yRatio: 0 };
      report.signals[0].stop.yRatio = 1;
      report.signals[0].targets[0].yRatio = 0;
      report.signals[0].confidence = 1;
    }));

    expect(parsed.signals.at(0)!.entry).toEqual({ priceLabel: '65,350', xRatio: 1, yRatio: 0 });
  });

  it.each([
    ['more than 12 evidence items', (report) => {
      report.evidence.push(
        { ...structuredClone(report.evidence[0]), id: 'evidence-12' },
        { ...structuredClone(report.evidence[1]), id: 'evidence-13' },
      );
    }],
    ['more than 4 indicators', (report) => { report.indicators.push(structuredClone(report.indicators[0]), structuredClone(report.indicators[1]), structuredClone(report.indicators[0])); }],
    ['more than 4 levels', (report) => { report.levels.push(structuredClone(report.levels[0])); }],
    ['more than 3 patterns', (report) => { report.patterns.push(structuredClone(report.patterns[0]), structuredClone(report.patterns[1])); }],
    ['more than 3 signals', (report) => { report.signals.push(structuredClone(report.signals[0]), structuredClone(report.signals[1])); }],
    ['fewer than 2 pattern points', (report) => { report.patterns[0].points = [report.patterns[0].points[0]]; }],
    ['more than 8 pattern points', (report) => { report.patterns[0].points = Array.from({ length: 9 }, (_, index) => ({ xRatio: index / 10, yRatio: index / 10 })); }],
    ['fewer than 1 signal target', (report) => { report.signals[0].targets = []; }],
    ['more than 3 signal targets', (report) => { report.signals[0].targets = Array.from({ length: 4 }, (_, index) => ({ priceLabel: `Target ${index + 1}`, yRatio: index / 4 })); }],
  ] satisfies Array<[string, Mutation]>)('rejects %s', (_name, mutate) => {
    expectRejected(mutate);
  });

  it('accepts every collection at its exact inclusive boundary', () => {
    const parsed = parseCommunityReport(mutated((report) => {
      report.evidence.push({ ...structuredClone(report.evidence[0]), id: 'evidence-12' });
      report.indicators.push(structuredClone(report.indicators[0]), structuredClone(report.indicators[1]));
      report.patterns.push({ ...structuredClone(report.patterns[0]), id: 'third-pattern' });
      report.signals.push({ ...structuredClone(report.signals[0]), id: 'third-signal' });
      report.patterns[0].points = Array.from({ length: 8 }, (_, index) => ({ xRatio: index / 7, yRatio: 1 - (index / 7) }));
      report.patterns[1].points = report.patterns[1].points.slice(0, 2);
      report.signals[0].targets.push({ priceLabel: '66,500', yRatio: 0 });
    }));

    expect([
      parsed.evidence.length,
      parsed.indicators.length,
      parsed.levels.length,
      parsed.patterns.length,
      parsed.signals.length,
      parsed.patterns.at(0)!.points.length,
      parsed.patterns.at(1)!.points.length,
      parsed.signals.at(0)!.targets.length,
      parsed.signals.at(1)!.targets.length,
    ]).toEqual([12, 4, 4, 3, 3, 8, 2, 3, 1]);
  });

  it('rejects duplicate evidence IDs', () => {
    expectRejected((report) => { report.evidence[1].id = report.evidence[0].id; });
  });

  it.each([
    ['market view', (report) => { report.marketView.evidenceIds = ['missing']; }],
    ['volume observation', (report) => { report.volume!.evidenceIds = ['missing']; }],
    ['indicator observation', (report) => { report.indicators[0].evidenceIds = ['missing']; }],
    ['level', (report) => { report.levels[0].evidenceIds = ['missing']; }],
    ['long scenario', (report) => { report.scenarios.long.evidenceIds = ['missing']; }],
    ['short scenario', (report) => { report.scenarios.short.evidenceIds = ['missing']; }],
    ['wait scenario', (report) => { report.scenarios.wait.evidenceIds = ['missing']; }],
    ['pattern', (report) => { report.patterns[0].evidenceIds = ['missing']; }],
    ['trade signal', (report) => { report.signals[0].evidenceIds = ['missing']; }],
  ] satisfies Array<[string, Mutation]>)('rejects a dangling evidence reference from the %s branch', (_name, mutate) => {
    expectRejected(mutate);
  });

  it.each([
    '15m + 1h',
    '15m/1h',
    '15m and 1h',
    '15m，1h',
    '["15m", "1h"]',
    "['15m', '1h']",
    'daily / weekly',
    '日线/周线',
    '15m + 日线',
    '15分钟和1小时',
    '第二个周期为1小时',
    '15m with a second timeframe of 1h',
  ])('rejects combined or second-timeframe bypass %j', (timeframe) => {
    expectRejected((report) => { report.chart.timeframe = timeframe; });
  });

  it('accepts one visible timeframe and a null timeframe', () => {
    expect(parseCommunityReport(mutated((report) => { report.chart.timeframe = '4-hour chart'; })).chart.timeframe).toBe('4-hour chart');
    expect(parseCommunityReport(mutated((report) => { report.chart.timeframe = null; })).chart.timeframe).toBeNull();
  });

  it.each([
    ['chart instrument', (report) => { report.chart.instrument = 'BTC from Binance API'; }],
    ['chart timeframe', (report) => { report.chart.timeframe = '15m from exchange API'; }],
    ['chart limitation', (report) => { report.chart.limitations[0] = 'Web search filled the obscured value.'; }],
    ['market summary', (report) => { report.marketView.summary = 'News reports support the bullish view.'; }],
    ['evidence observation', (report) => { report.evidence[0].observation = 'A calculated feed confirms the low.'; }],
    ['evidence implication', (report) => { report.evidence[0].implication = 'External data confirms buyers.'; }],
    ['evidence time anchor', (report) => { report.evidence[0].timeAnchor = 'Binance API timestamp'; }],
    ['volume summary', (report) => { report.volume!.summary = 'Volume comes from exchange API.'; }],
    ['indicator summary', (report) => { report.indicators[0].summary = 'RSI comes from a calculated feed.'; }],
    ['indicator implication', (report) => { report.indicators[0].implication = '新闻报道确认动能。'; }],
    ['level price label', (report) => { report.levels[0].priceLabel = '来自交易所 API 的 63,900'; }],
    ['level reason', (report) => { report.levels[0].reason = '网页搜索确认此处。'; }],
    ['level time anchor', (report) => { report.levels[0].timeAnchor = '外部数据时间戳'; }],
    ['long condition', (report) => { report.scenarios.long.condition = 'News reports turn positive.'; }],
    ['long entry', (report) => { report.scenarios.long.entry = 'Use the calculated feed entry.'; }],
    ['long stop', (report) => { report.scenarios.long.stop = 'Stop from Binance API.'; }],
    ['long target', (report) => { report.scenarios.long.targets[0] = 'Target from web search.'; }],
    ['long reason', (report) => { report.scenarios.long.reason = 'Exchange API confirms it.'; }],
    ['short condition', (report) => { report.scenarios.short.condition = '币安 API 转弱。'; }],
    ['short entry', (report) => { report.scenarios.short.entry = '外部数据入场。'; }],
    ['short stop', (report) => { report.scenarios.short.stop = '计算数据源止损。'; }],
    ['short target', (report) => { report.scenarios.short.targets[0] = '新闻报告目标。'; }],
    ['short reason', (report) => { report.scenarios.short.reason = '网络搜索确认。'; }],
    ['wait condition', (report) => { report.scenarios.wait.condition = 'Wait for exchange API data.'; }],
    ['wait reason', (report) => { report.scenarios.wait.reason = 'Web search remains mixed.'; }],
    ['pattern name', (report) => { report.patterns[0].name = 'Calculated feed channel'; }],
    ['pattern time range', (report) => { report.patterns[0].timeRange = 'Exchange API window'; }],
    ['pattern explanation', (report) => { report.patterns[0].explanation = 'News reports confirm the pattern.'; }],
    ['signal time anchor', (report) => { report.signals[0].timeAnchor = 'External data timestamp'; }],
    ['signal reason', (report) => { report.signals[0].reason = 'Binance API confirms entry.'; }],
    ['signal entry price label', (report) => { report.signals[0].entry.priceLabel = 'Exchange API 65,350'; }],
    ['signal stop price label', (report) => { report.signals[0].stop.priceLabel = 'Web search 64,900'; }],
    ['signal target price label', (report) => { report.signals[0].targets[0].priceLabel = 'News reports 65,850'; }],
    ['signal risk/reward', (report) => { report.signals[0].riskReward = 'Calculated feed says 1:2'; }],
    ['risk notice', (report) => { report.riskNotice = 'External data makes this certain.'; }],
  ] satisfies Array<[string, Mutation]>)('rejects prohibited external-source claims in the %s text branch', (_name, mutate) => {
    expectRejected(mutate);
  });

  it('accepts a neutral screenshot-visible exchange label', () => {
    const parsed = parseCommunityReport(mutated((report) => {
      report.chart.limitations[0] = 'The exchange name visible in the screenshot is Binance.';
    }));

    expect(parsed.chart.limitations[0]).toBe('The exchange name visible in the screenshot is Binance.');
  });

  it.each([
    ['chart instrument', (report) => { report.chart.instrument = '   '; }],
    ['chart timeframe', (report) => { report.chart.timeframe = '\n\t'; }],
    ['chart limitation', (report) => { report.chart.limitations[0] = '  '; }],
    ['market summary', (report) => { report.marketView.summary = '  '; }],
    ['evidence ID', (report) => { report.evidence[0].id = ' '; }],
    ['evidence observation', (report) => { report.evidence[0].observation = ' '; }],
    ['evidence implication', (report) => { report.evidence[0].implication = ' '; }],
    ['evidence time anchor', (report) => { report.evidence[0].timeAnchor = ' '; }],
    ['evidence reference', (report) => { report.marketView.evidenceIds[0] = ' '; }],
    ['volume summary', (report) => { report.volume!.summary = ' '; }],
    ['indicator summary', (report) => { report.indicators[0].summary = ' '; }],
    ['indicator implication', (report) => { report.indicators[0].implication = ' '; }],
    ['level ID', (report) => { report.levels[0].id = ' '; }],
    ['level price label', (report) => { report.levels[0].priceLabel = ' '; }],
    ['level reason', (report) => { report.levels[0].reason = ' '; }],
    ['level time anchor', (report) => { report.levels[0].timeAnchor = ' '; }],
    ['long condition', (report) => { report.scenarios.long.condition = ' '; }],
    ['long entry', (report) => { report.scenarios.long.entry = ' '; }],
    ['long stop', (report) => { report.scenarios.long.stop = ' '; }],
    ['long target', (report) => { report.scenarios.long.targets[0] = ' '; }],
    ['long reason', (report) => { report.scenarios.long.reason = ' '; }],
    ['short condition', (report) => { report.scenarios.short.condition = ' '; }],
    ['short entry', (report) => { report.scenarios.short.entry = ' '; }],
    ['short stop', (report) => { report.scenarios.short.stop = ' '; }],
    ['short target', (report) => { report.scenarios.short.targets[0] = ' '; }],
    ['short reason', (report) => { report.scenarios.short.reason = ' '; }],
    ['wait condition', (report) => { report.scenarios.wait.condition = ' '; }],
    ['wait reason', (report) => { report.scenarios.wait.reason = ' '; }],
    ['pattern ID', (report) => { report.patterns[0].id = ' '; }],
    ['pattern name', (report) => { report.patterns[0].name = ' '; }],
    ['pattern time range', (report) => { report.patterns[0].timeRange = ' '; }],
    ['pattern explanation', (report) => { report.patterns[0].explanation = ' '; }],
    ['signal ID', (report) => { report.signals[0].id = ' '; }],
    ['signal time anchor', (report) => { report.signals[0].timeAnchor = ' '; }],
    ['signal reason', (report) => { report.signals[0].reason = ' '; }],
    ['signal entry price label', (report) => { report.signals[0].entry.priceLabel = ' '; }],
    ['signal stop price label', (report) => { report.signals[0].stop.priceLabel = ' '; }],
    ['signal target price label', (report) => { report.signals[0].targets[0].priceLabel = ' '; }],
    ['signal risk/reward', (report) => { report.signals[0].riskReward = ' '; }],
    ['risk notice', (report) => { report.riskNotice = ' '; }],
  ] satisfies Array<[string, Mutation]>)('rejects empty trimmed text in %s', (_name, mutate) => {
    expectRejected(mutate);
  });

  it('trims accepted text before returning it', () => {
    const parsed = parseCommunityReport(mutated((report) => {
      report.marketView.summary = '  Price is holding above support.  ';
      report.signals[0].riskReward = '  Approximately 1:2  ';
    }));

    expect(parsed.marketView.summary).toBe('Price is holding above support.');
    expect(parsed.signals.at(0)!.riskReward).toBe('Approximately 1:2');
  });
});
