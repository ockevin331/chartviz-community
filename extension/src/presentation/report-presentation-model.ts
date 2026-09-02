import { z } from 'zod';

const text = z.string().trim().min(1);
const ratio = z.number().finite().min(0).max(1);
const nullableText = text.nullable();

const captureSchema = z.object({
  captureId: z.string().regex(/^C\d{2}$/),
  timeframe: text.nullable(),
  role: z.enum(['context', 'setup', 'trigger', 'setup_and_trigger']).nullable(),
  instrument: text.nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();

const conclusionSchema = z.object({
  direction: z.enum(['long', 'short', 'sideways']),
  trend: z.enum(['bullish', 'bearish', 'sideways', 'unclear']),
  structure: z.enum(['hh-hl', 'lh-ll', 'range', 'transition', 'unclear']),
  strength: z.enum(['strong', 'moderate', 'weak', 'unclear']),
  summary: text,
  primaryRisk: text,
  confidence: ratio,
}).strict();

const evidenceExplanationSchema = z.object({
  summary: text,
  evidence: z.array(text).min(1).max(6),
  timeAnchor: text,
}).strict();

const volumeExplanationSchema = z.object({
  summary: text,
  implication: text,
  timeAnchor: text,
}).strict();

const indicatorSchema = z.object({
  id: z.string().regex(/^I\d{2}$/),
  name: z.enum(['RSI', 'MACD', 'OTHER']),
  state: text,
  implication: text,
  timeAnchor: text,
}).strict();

const marketExplanationSchema = z.object({
  priceAction: evidenceExplanationSchema,
  volume: volumeExplanationSchema.nullable(),
  indicators: z.array(indicatorSchema).max(8),
}).strict();

const levelSchema = z.object({
  id: z.string().regex(/^L\d{2}$/),
  captureId: z.string().regex(/^C\d{2}$/),
  type: z.enum(['support', 'resistance']),
  tier: z.enum(['nearest', 'secondary', 'major']),
  status: z.enum(['holding', 'testing', 'broken', 'flip_candidate']),
  priceLabel: text,
  reason: text,
  timeAnchor: text,
  confidence: ratio,
}).strict();

const scenarioSchema = z.object({
  condition: text,
  entry: text,
  stop: text,
  targets: z.array(text).min(1).max(3),
  reason: text,
}).strict();

const tradePlanSchema = z.object({
  summary: text,
  long: scenarioSchema,
  short: scenarioSchema,
  wait: z.object({ condition: text, reason: text }).strict(),
}).strict();

const signalPriceSchema = z.object({ priceLabel: text }).strict();

const tradeSignalSchema = z.object({
  id: z.string().regex(/^S\d{2}$/),
  captureId: z.string().regex(/^C\d{2}$/),
  direction: z.enum(['long', 'short']),
  signalType: text,
  signalTime: text,
  thesisAtSignal: text,
  evidenceAtSignal: z.array(text).min(1).max(6),
  entry: signalPriceSchema,
  stopLoss: signalPriceSchema,
  takeProfits: z.array(signalPriceSchema).min(1).max(3),
  riskReward: text.nullable(),
  confidence: ratio,
  invalidation: text.nullable(),
}).strict();

const patternSchema = z.object({
  id: z.string().regex(/^P\d{2}$/),
  captureId: z.string().regex(/^C\d{2}$/),
  name: text,
  status: z.enum(['forming', 'confirmed', 'invalidated']),
  bias: z.enum(['bullish', 'bearish', 'neutral']),
  timeRange: text,
  evidence: text,
  confirmation: text,
  invalidation: text,
  confidence: ratio,
}).strict();

const timeframeViewSchema = z.object({
  captureId: z.string().regex(/^C\d{2}$/),
  timeframe: text.nullable(),
  role: z.enum(['context', 'setup', 'trigger', 'setup_and_trigger']).nullable(),
  trend: z.enum(['bullish', 'bearish', 'sideways', 'unclear']),
  structure: z.enum(['hh-hl', 'lh-ll', 'range', 'transition', 'unclear']),
  conclusion: text,
  confidence: ratio,
  evidence: z.array(text).min(1).max(6),
}).strict();

const drawingPointSchema = z.object({
  xRatio: ratio.nullable(),
  yRatio: ratio,
  priceYRatio: ratio.nullable().optional(),
  priceLabel: nullableText,
  timeAnchor: nullableText,
}).strict();

const drawingSchema = z.object({
  id: z.string().regex(/^D\d{2}$/),
  captureId: z.string().regex(/^C\d{2}$/),
  layer: z.enum(['levels', 'signal', 'pattern']),
  refId: z.string().regex(/^[LSP]\d{2}$/),
  meaning: z.enum([
    'support', 'resistance', 'long_entry', 'short_entry', 'stop', 'target', 'pattern',
  ]),
  caption: nullableText,
  tool: z.enum([
    'horizontal_line', 'zone', 'trend_line', 'channel', 'range',
    'entry_arrow', 'stop_line', 'target_line', 'marker',
  ]),
  points: z.array(drawingPointSchema).min(1).max(8),
}).strict();

const reportShape = z.object({
  schemaVersion: z.literal('presentation-1.0'),
  context: z.object({
    instrument: text.nullable(),
    venue: text.nullable(),
    outputLanguage: z.enum(['en', 'zh-CN']),
    captures: z.array(captureSchema).min(1).max(3),
  }).strict(),
  conclusion: conclusionSchema,
  marketExplanation: marketExplanationSchema,
  levels: z.array(levelSchema).max(8),
  tradePlan: tradePlanSchema,
  tradeSignals: z.array(tradeSignalSchema).max(8),
  patterns: z.array(patternSchema).max(6),
  timeframeViews: z.array(timeframeViewSchema).min(1).max(3),
  riskNotice: text,
}).strict();

function duplicateIds(items: readonly { id: string }[]): boolean {
  return new Set(items.map(({ id }) => id)).size !== items.length;
}

function drawingGeometryIsValid(drawing: z.infer<typeof drawingSchema>): boolean {
  const allXNull = drawing.points.every(({ xRatio }) => xRatio === null);
  const allXPresent = drawing.points.every(({ xRatio }) => xRatio !== null);
  if (drawing.tool === 'horizontal_line' || drawing.tool === 'stop_line' || drawing.tool === 'target_line') {
    return drawing.points.length === 1 && allXNull;
  }
  if (drawing.tool === 'entry_arrow' || drawing.tool === 'marker') {
    return drawing.points.length === 1 && allXPresent;
  }
  if (drawing.tool === 'zone') return drawing.points.length === 2;
  if (drawing.tool === 'trend_line') return drawing.points.length >= 2 && allXPresent;
  return drawing.points.length === 4 && allXPresent;
}

function toolMatchesMeaning(drawing: z.infer<typeof drawingSchema>): boolean {
  if (drawing.meaning === 'support' || drawing.meaning === 'resistance') {
    return drawing.layer === 'levels' && (drawing.tool === 'horizontal_line' || drawing.tool === 'zone');
  }
  if (drawing.meaning === 'long_entry' || drawing.meaning === 'short_entry') {
    return drawing.layer === 'signal' && drawing.tool === 'entry_arrow';
  }
  if (drawing.meaning === 'stop') return drawing.layer === 'signal' && drawing.tool === 'stop_line';
  if (drawing.meaning === 'target') return drawing.layer === 'signal' && drawing.tool === 'target_line';
  return drawing.layer === 'pattern'
    && ['trend_line', 'channel', 'range', 'marker'].includes(drawing.tool);
}

const bundleSchema = z.object({
  report: reportShape,
  drawings: z.array(drawingSchema).max(32),
}).strict().superRefine(({ report, drawings }, context) => {
  const captures = new Set(report.context.captures.map(({ captureId }) => captureId));
  if (captures.size !== report.context.captures.length) {
    context.addIssue({ code: 'custom', path: ['report', 'context', 'captures'], message: 'duplicate_capture_id' });
  }
  for (const [path, items] of [
    ['levels', report.levels],
    ['tradeSignals', report.tradeSignals],
    ['patterns', report.patterns],
    ['indicators', report.marketExplanation.indicators],
  ] as const) {
    if (duplicateIds(items)) {
      context.addIssue({ code: 'custom', path: ['report', path], message: 'duplicate_item_id' });
    }
  }
  if (duplicateIds(drawings)) {
    context.addIssue({ code: 'custom', path: ['drawings'], message: 'duplicate_drawing_id' });
  }
  const levels = new Map(report.levels.map((item) => [item.id, item]));
  const signals = new Map(report.tradeSignals.map((item) => [item.id, item]));
  const patterns = new Map(report.patterns.map((item) => [item.id, item]));
  const captureItems = [
    ...report.levels, ...report.tradeSignals, ...report.patterns, ...report.timeframeViews,
  ];
  captureItems.forEach((item, index) => {
    if (!captures.has(item.captureId)) {
      context.addIssue({ code: 'custom', path: ['report', 'captureReferences', index], message: 'unknown_capture_id' });
    }
  });
  const signalCounts = new Map<string, { entry: number; stop: number; target: number }>();
  drawings.forEach((drawing, index) => {
    if (!captures.has(drawing.captureId)) {
      context.addIssue({ code: 'custom', path: ['drawings', index, 'captureId'], message: 'unknown_capture_id' });
    }
    const referenced = drawing.layer === 'levels'
      ? levels.get(drawing.refId)
      : drawing.layer === 'signal' ? signals.get(drawing.refId) : patterns.get(drawing.refId);
    if (!referenced || referenced.captureId !== drawing.captureId) {
      context.addIssue({ code: 'custom', path: ['drawings', index, 'refId'], message: 'invalid_drawing_reference' });
    }
    if (!toolMatchesMeaning(drawing)) {
      context.addIssue({ code: 'custom', path: ['drawings', index, 'meaning'], message: 'invalid_tool_meaning' });
    }
    if (!drawingGeometryIsValid(drawing)) {
      context.addIssue({ code: 'custom', path: ['drawings', index, 'points'], message: 'invalid_drawing_geometry' });
    }
    if (drawing.layer === 'levels' && referenced && 'type' in referenced && drawing.meaning !== referenced.type) {
      context.addIssue({ code: 'custom', path: ['drawings', index, 'meaning'], message: 'level_meaning_mismatch' });
    }
    if (drawing.layer === 'signal' && referenced && 'direction' in referenced) {
      if (drawing.meaning.endsWith('_entry') && drawing.meaning !== `${referenced.direction}_entry`) {
        context.addIssue({ code: 'custom', path: ['drawings', index, 'meaning'], message: 'signal_direction_mismatch' });
      }
      const counts = signalCounts.get(drawing.refId) ?? { entry: 0, stop: 0, target: 0 };
      if (drawing.meaning.endsWith('_entry')) counts.entry += 1;
      else if (drawing.meaning === 'stop') counts.stop += 1;
      else if (drawing.meaning === 'target') counts.target += 1;
      signalCounts.set(drawing.refId, counts);
    }
  });
  signalCounts.forEach((counts, refId) => {
    if (counts.entry > 1 || counts.stop > 1 || counts.target > 3) {
      context.addIssue({ code: 'custom', path: ['drawings'], message: `invalid_signal_drawing_cardinality:${refId}` });
    }
  });
});

export type ReportPresentationModel = z.infer<typeof reportShape>;
export type PresentationDrawing = z.infer<typeof drawingSchema>;
export type PresentationDrawingPoint = z.infer<typeof drawingPointSchema>;
export type PresentationBundle = z.infer<typeof bundleSchema>;
export type PresentationLevel = ReportPresentationModel['levels'][number];
export type PresentationTradeSignal = ReportPresentationModel['tradeSignals'][number];
export type PresentationPattern = ReportPresentationModel['patterns'][number];
export type PresentationScenario = ReportPresentationModel['tradePlan']['long'];

export function parseReportPresentationModel(value: unknown): ReportPresentationModel {
  return reportShape.parse(value);
}

export function parsePresentationBundle(value: unknown): PresentationBundle {
  return bundleSchema.parse(value);
}
