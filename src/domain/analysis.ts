import { z } from 'zod';

export const evidenceSchema = z.object({
  claim: z.string().min(1),
  visualEvidence: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const scenarioSchema = z.object({
  trigger: z.string().min(1),
  confirmation: z.string().min(1),
  invalidation: z.string().min(1),
  targetLogic: z.string().min(1),
  mainRisk: z.string().min(1),
});

export const insightSchema = z.object({
  kind: z.enum(['trend', 'structure', 'volatility', 'volume', 'momentum', 'indicator']),
  label: z.string().min(1),
  value: z.string().min(1),
  evidence: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const keyLevelSchema = z.object({
  type: z.enum(['support', 'resistance', 'breakout_trigger', 'breakdown_trigger', 'trigger', 'invalidation', 'target']),
  tier: z.enum(['nearest', 'secondary', 'major']).default('nearest'),
  status: z.enum(['holding', 'testing', 'broken', 'flip_candidate']).default('holding'),
  priceLabel: z.string().min(1),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1),
  drawingId: z.string().nullable(),
});

export const patternSchema = z.object({
  name: z.string().min(1),
  status: z.enum(['forming', 'confirmed', 'invalidated']),
  bias: z.enum(['bullish', 'bearish', 'neutral']),
  timeRange: z.string().min(1),
  evidence: z.string().min(1),
  confirmation: z.string().min(1),
  invalidation: z.string().min(1),
  drawingRefs: z.array(z.string()).min(1).max(4).default([]),
  figureRefs: z.array(z.string()).max(4).default([]),
  confidence: z.number().min(0).max(1),
});

export const drawingToolSchema = z.enum([
  'support_line', 'resistance_line', 'support_zone', 'resistance_zone',
  'trend_line', 'breakout_marker', 'rejection_marker', 'time_marker',
  'entry_line', 'stop_line', 'target_line', 'note',
]);

export const drawingInstructionSchema = z.object({
  id: z.string().min(1),
  tool: drawingToolSchema,
  label: z.string().min(1),
  points: z.array(z.object({
    timestamp: z.number().int().nullable(),
    price: z.number(),
    timeLabel: z.string().nullable(),
    xRatio: z.number().min(0).max(1).nullable(),
    yRatio: z.number().min(0).max(1),
  })).min(1).max(2),
  reason: z.string().min(1),
  evidenceIds: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  figureId: z.string().nullable().optional(),
  signalDirection: z.enum(['long', 'short']).nullable().optional(),
  renderBounds: z.object({
    leftRatio: z.number().min(0).max(1),
    topRatio: z.number().min(0).max(1),
    rightRatio: z.number().min(0).max(1),
    bottomRatio: z.number().min(0).max(1),
  }).nullable().optional(),
});

export type DrawingInstruction = z.infer<typeof drawingInstructionSchema>;

export const segmentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['impulse_up', 'pullback_down', 'consolidation', 'breakout_up', 'impulse_down', 'rebound_up', 'breakdown', 'transition']),
  parentTrend: z.enum(['bullish', 'bearish', 'range', 'transition']),
  start: z.object({ timeLabel: z.string().min(1), timePrecision: z.enum(['visible', 'interpolated', 'relative']), price: z.number(), xRatio: z.number().min(0).max(1), yRatio: z.number().min(0).max(1) }),
  end: z.object({ timeLabel: z.string().min(1), timePrecision: z.enum(['visible', 'interpolated', 'relative']), price: z.number(), xRatio: z.number().min(0).max(1), yRatio: z.number().min(0).max(1) }),
  amplitude: z.object({ absolute: z.number(), percent: z.number() }),
  duration: z.object({ bars: z.number().int().min(1), timeLabel: z.string().min(1) }),
  strength: z.enum(['strong', 'moderate', 'weak', 'unclear']),
  priceAction: z.string().min(1), volumeBehavior: z.string().min(1),
  indicatorSignals: z.array(z.string()), evidence: z.array(evidenceSchema),
  drawingId: z.string(), figureRef: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

export const indicatorReadingSchema = z.object({
  id: z.string().min(1), name: z.enum(['RSI', 'MACD', 'OTHER']), state: z.string().min(1),
  signals: z.array(z.string()).min(1), timeAnchor: z.string().min(1), drawingIds: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const volumeAnalysisSchema = z.object({
  state: z.enum(['expanding', 'contracting', 'mixed', 'steady', 'unclear']),
  priceVolumeRelation: z.enum(['confirming', 'bullish_divergence', 'bearish_divergence', 'mixed', 'unclear']),
  observations: z.array(evidenceSchema), conflictZones: z.array(z.string()), confidence: z.number().min(0).max(1),
});

export const positioningEvidenceSchema = z.object({
  kind: z.enum(['cost_concentration', 'liquidation_cluster']),
  side: z.enum(['long', 'short', 'mixed', 'neutral']),
  priceLabel: z.string().nullable(), timeAnchor: z.string().min(1),
  observation: z.string().min(1), marketImplication: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const conclusionSchema = z.object({
  id: z.string().min(1), timeAnchor: z.string().min(1).default('Chart region'), title: z.string().min(1), verdict: z.string().min(1),
  strength: z.enum(['strong', 'moderate', 'weak', 'unclear']), reasoning: z.string().min(1),
  counterEvidence: z.array(z.string()), drawingRefs: z.array(z.string()).min(1),
  figureRefs: z.array(z.string()).default([]), confidence: z.number().min(0).max(1),
});

const analysisNarrativeSchema = z.object({
  imageQuality: z.object({
    quality: z.enum(['high', 'medium', 'low']),
    limitations: z.array(z.string()),
    confidence: z.number().min(0).max(1),
  }),
  marketReading: z.object({
    trend: z.enum(['bullish', 'bearish', 'sideways', 'unclear']),
    structure: z.enum(['hh-hl', 'lh-ll', 'range', 'transition', 'unclear']),
    evidence: z.array(evidenceSchema),
    confidence: z.number().min(0).max(1),
  }),
  bullishEvidence: z.array(z.string()),
  bearishEvidence: z.array(z.string()),
  conflicts: z.array(z.string()),
  dominantBias: z.enum(['bullish', 'bearish', 'neutral', 'unclear']),
  overallConfidence: z.number().min(0).max(1),
  decision: z.object({
    direction: z.enum(['long', 'short', 'wait']),
    status: z.enum(['waiting_trigger', 'waiting_confirmation', 'conditions_met', 'invalidated']),
    summary: z.string().min(1),
    primaryRisk: z.string().min(1),
  }),
  insights: z.array(insightSchema).max(6),
  keyLevels: z.array(keyLevelSchema).max(8),
  patterns: z.array(patternSchema).max(3),
  scenarios: z.object({
    long: scenarioSchema,
    short: scenarioSchema,
    wait: z.object({
      conditions: z.string().min(1),
      resolution: z.string().min(1),
    }),
  }),
  drawings: z.array(drawingInstructionSchema).max(24),
  conclusions: z.array(conclusionSchema).max(6).default([]),
  segments: z.array(segmentSchema).max(8).default([]),
  indicatorReadings: z.array(indicatorReadingSchema).max(8).default([]),
  volumeAnalysis: volumeAnalysisSchema.nullable().default(null),
  positioningEvidence: z.array(positioningEvidenceSchema).max(8).default([]),
  timeframeAnalyses: z.array(z.object({
    timeframe: z.string().min(1), trend: z.enum(['bullish', 'bearish', 'sideways', 'unclear']),
    structure: z.enum(['hh-hl', 'lh-ll', 'range', 'transition', 'unclear']),
    summary: z.string().min(1), evidence: z.array(z.string()).min(1).max(5),
    decision: z.enum(['long', 'short', 'wait']), confidence: z.number().min(0).max(1),
  })).max(6).default([]),
  tradeSignals: z.array(z.object({
    id: z.string().regex(/^S\d{2}$/), timeframe: z.string().min(1), direction: z.enum(['long', 'short']),
    signalType: z.string().min(1), signalTime: z.string().min(1), cutoffPoint: z.string().min(1),
    thesisAtSignal: z.string().min(1), evidenceAtSignal: z.array(z.string()).min(1).max(6),
    entry: z.string().min(1), stopLoss: z.string().min(1), takeProfits: z.array(z.string()).min(1).max(3),
    invalidation: z.string().min(1), riskReward: z.string().nullable().optional(),
    drawingRefs: z.array(z.string()).max(4).default([]), figureRefs: z.array(z.string()).max(4).default([]),
    confidence: z.number().min(0).max(1),
  })).max(6).default([]),
  riskNotice: z.string().min(1),
});

const priceBandV13Schema = z.object({
  lower: z.number().nullable(),
  upper: z.number().nullable(),
  label: z.string().min(1),
  precision: z.enum(['exact', 'estimated', 'spatial']),
});

export const analysisReportSchema = analysisNarrativeSchema.extend({
  schemaVersion: z.literal('1.3'),
  analysisContext: z.object({
    instrument: z.string().nullable(),
    venue: z.string().nullable(),
    capturedAt: z.string().nullable(),
    timeframes: z.array(z.object({
      timeframe: z.string().min(1),
      role: z.enum(['context', 'setup', 'trigger', 'setup_and_trigger', 'supplemental']),
    })).max(3),
    latestCandleClosed: z.boolean().nullable(),
    dataSources: z.array(z.enum(['screenshot', 'exchange_api', 'calculated', 'user_context'])),
    limitations: z.array(z.string()),
  }),
  evidence: z.array(z.object({
    id: z.string().regex(/^NE\d{3}$/),
    claim: z.string().min(1),
    source: z.enum(['screenshot', 'exchange_api', 'calculated', 'user_context']),
    timeframe: z.string().nullable(),
    timeAnchor: z.string().nullable(),
    observationClass: z.enum(['direct', 'estimated', 'calculated']),
    confidence: z.number().min(0).max(1),
  })),
  marketState: z.object({
    regime: z.enum(['trend', 'range', 'transition', 'insufficient']),
    directionalBias: z.enum(['bullish', 'bearish', 'neutral', 'unclear']),
    structure: z.enum(['hh-hl', 'lh-ll', 'range', 'transition', 'unclear']),
    currentLocation: z.string().nullable(),
    supportingEvidenceRefs: z.array(z.string()),
    opposingEvidenceRefs: z.array(z.string()),
    confidence: z.number().min(0).max(1),
  }),
  zones: z.array(z.object({
    id: z.string().regex(/^Z\d{2}$/),
    type: z.enum(['support', 'resistance', 'invalidation']),
    tier: z.enum(['nearest', 'secondary', 'major']),
    status: z.enum(['holding', 'testing', 'broken', 'flip_candidate']),
    band: priceBandV13Schema,
    timeframe: z.string().nullable(),
    score: z.number().int().min(-4).max(8),
    scoreFactors: z.array(z.string()),
    evidenceRefs: z.array(z.string()),
  })).max(5),
  setupEvaluation: z.object({
    playbook: z.enum(['trend_pullback', 'range_breakout', 'failed_breakout', 'none']),
    state: z.enum(['preparing', 'triggered', 'invalidated']),
    direction: z.enum(['long', 'short']).nullable(),
    location: z.string().nullable(),
    premise: z.string().nullable(),
    entry: priceBandV13Schema.nullable(),
    trigger: z.string().nullable(),
    confirmation: z.string().nullable(),
    triggerCandleClosed: z.boolean().nullable(),
    structuralStop: z.object({
      band: priceBandV13Schema,
      reason: z.string().min(1),
      buffer: z.string().nullable(),
    }).nullable(),
    targets: z.array(z.object({
      tier: z.enum(['T1', 'T2', 'T3']),
      band: priceBandV13Schema,
      source: z.enum(['structure', 'measured_move', 'extension']),
      active: z.boolean(),
      invalidation: z.string().min(1),
    })).max(3),
    effectiveRToT1: z.object({
      gross: z.number().min(0).nullable(),
      net: z.number().min(0).nullable(),
      feeAssumption: z.string().nullable(),
      slippageAssumption: z.string().nullable(),
    }).nullable(),
    actionability: z.enum(['TRADE', 'WAIT', 'NO_TRADE']),
    vetoes: z.array(z.string()),
    pendingConditions: z.array(z.string()),
    whatChangesDecision: z.array(z.string()),
    evidenceRefs: z.array(z.string()),
    opposingEvidenceRefs: z.array(z.string()),
  }),
});

export type AnalysisReport = z.infer<typeof analysisReportSchema>;

export const chartContextSchema = z.object({
  site: z.enum(['tradingview', 'binance', 'okx', 'bybit', 'hyperliquid', 'coinbase', 'bitget', 'gate', 'kucoin', 'mexc', 'crypto-com', 'htx', 'upbit', '10jqka', 'vergex', 'web-upload']),
  pageType: z.enum(['advanced-chart', 'spot-trade', 'futures-trade', 'stock-trade', 'web3-token', 'uploaded-chart']),
  url: z.string().url(),
  symbol: z.string().optional(),
  exchange: z.string().optional(),
  timeframe: z.string().optional(),
  currentOhlcText: z.string().optional(),
  outputLanguage: z.enum(['en', 'zh-CN']).optional(),
  captureSource: z.enum(['automatic', 'manual']).optional(),
  specializedEvidence: z.array(z.enum(['cost-distribution', 'liquidation-distribution'])).optional(),
  chart: z.object({
    id: z.string(),
    ariaLabel: z.string().optional(),
    bounds: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
  }),
  viewport: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    devicePixelRatio: z.number().positive(),
  }),
});

export type ChartContext = z.infer<typeof chartContextSchema>;

export const analysisEnvelopeSchema = z.object({
  requestId: z.string().min(1),
  context: chartContextSchema,
  report: analysisReportSchema,
});

export type AnalysisEnvelope = z.infer<typeof analysisEnvelopeSchema>;


export const instrumentNewsSchema = z.object({
  query: z.string().min(1),
  searchedAt: z.string().min(1),
  items: z.array(z.object({
    title: z.string().min(1),
    url: z.string().url(),
    snippet: z.string(),
    source: z.string().min(1),
  })).max(5),
});

export type InstrumentNews = z.infer<typeof instrumentNewsSchema>;
