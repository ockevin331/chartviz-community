import { z } from 'zod';
import { assertScreenshotOnlyText, assertSingleTimeframe } from '../source-policy';

const text = z.string().trim().min(1);
const ratio = z.number().min(0).max(1);
const point = z.object({ xRatio: ratio, yRatio: ratio }).strict();

const scenario = z.object({
  condition: text,
  entry: text,
  stop: text,
  targets: z.array(text).min(1).max(3),
  reason: text,
}).strict();

const signalPrice = z.object({ priceLabel: text, yRatio: ratio }).strict();

const reportV3Shape = z.object({
  schemaVersion: z.literal('community-3.0'),
  chart: z.object({ instrument: text.nullable(), timeframe: text.nullable() }).strict(),
  conclusion: z.object({
    direction: z.enum(['long', 'short', 'sideways']),
    trend: z.enum(['bullish', 'bearish', 'sideways', 'unclear']),
    structure: z.enum(['hh-hl', 'lh-ll', 'range', 'transition', 'unclear']),
    strength: z.enum(['strong', 'moderate', 'weak', 'unclear']),
    summary: text,
    primaryRisk: text,
    confidence: ratio,
  }).strict(),
  marketExplanation: z.object({
    priceAction: z.object({ summary: text, evidence: z.array(text).min(1).max(6), timeAnchor: text }).strict(),
    volume: z.object({ summary: text, implication: text, timeAnchor: text }).strict().nullable(),
    indicators: z.array(z.object({
      id: z.string().regex(/^I\d{2}$/),
      name: z.enum(['RSI', 'MACD', 'OTHER']),
      state: text,
      implication: text,
      timeAnchor: text,
    }).strict()).max(4),
  }).strict(),
  levels: z.array(z.object({
    id: z.string().regex(/^L\d{2}$/),
    type: z.enum(['support', 'resistance']),
    tier: z.enum(['nearest', 'secondary', 'major']),
    status: z.enum(['holding', 'testing', 'broken', 'flip_candidate']),
    priceLabel: text,
    reason: text,
    timeAnchor: text,
    yRatio: ratio,
    confidence: ratio,
  }).strict()).max(4),
  tradePlan: z.object({
    summary: text,
    long: scenario,
    short: scenario,
    wait: z.object({ condition: text, reason: text }).strict(),
  }).strict(),
  tradeSignals: z.array(z.object({
    id: z.string().regex(/^S\d{2}$/),
    direction: z.enum(['long', 'short']),
    signalType: text,
    signalTime: text,
    thesisAtSignal: text,
    evidenceAtSignal: z.array(text).min(1).max(6),
    entry: z.object({ priceLabel: text, xRatio: ratio, yRatio: ratio }).strict(),
    stopLoss: signalPrice,
    takeProfits: z.array(signalPrice).min(1).max(3),
    riskReward: text.nullable(),
    confidence: ratio,
  }).strict()).max(4),
  patterns: z.array(z.object({
    id: z.string().regex(/^P\d{2}$/),
    name: text,
    status: z.enum(['forming', 'confirmed', 'invalidated']),
    bias: z.enum(['bullish', 'bearish', 'neutral']),
    timeRange: text,
    evidence: text,
    confirmation: text,
    invalidation: text,
    confidence: ratio,
    points: z.array(point).min(2).max(8),
  }).strict()).max(3),
  riskNotice: text,
}).strict();

function collectStrings(value: unknown, result: string[] = []): string[] {
  if (typeof value === 'string') result.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, result));
  else if (value !== null && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, result));
  return result;
}

function uniqueIds(items: readonly { id: string }[], path: string, context: z.RefinementCtx): void {
  const seen = new Set<string>();
  items.forEach(({ id }, index) => {
    if (seen.has(id)) context.addIssue({ code: 'custom', path: [path, index, 'id'], message: 'duplicate_id' });
    seen.add(id);
  });
}

export const communityReportV3Schema = reportV3Shape.superRefine((report, context) => {
  uniqueIds(report.marketExplanation.indicators, 'indicators', context);
  uniqueIds(report.levels, 'levels', context);
  uniqueIds(report.tradeSignals, 'tradeSignals', context);
  uniqueIds(report.patterns, 'patterns', context);
  const strings = collectStrings(report);
  strings.forEach((value) => {
    try { assertScreenshotOnlyText(value); }
    catch {
      context.addIssue({ code: 'custom', path: [], message: 'external_source_claim' });
    }
  });
  try { assertSingleTimeframe(strings, report.chart.timeframe); }
  catch {
    context.addIssue({ code: 'custom', path: ['chart', 'timeframe'], message: 'multiple_timeframes' });
  }
});

export type CommunityReportV3 = z.infer<typeof communityReportV3Schema>;
export type CommunityScenarioV3 = z.infer<typeof scenario>;
export const communityReportV3JsonSchema = z.toJSONSchema(reportV3Shape, { target: 'draft-7' });

export function parseCommunityReportV3(value: unknown): CommunityReportV3 {
  return communityReportV3Schema.parse(value);
}
