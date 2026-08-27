import { z } from 'zod';
import { assertScreenshotOnlyText, assertSingleTimeframe } from '../source-policy';

const text = z.string().trim().min(1);
const ratio = z.number().min(0).max(1);
const point = z.object({ xRatio: ratio, yRatio: ratio }).strict();

const visualFactsShape = z.object({
  schemaVersion: z.literal('community-visual-1.0'),
  chart: z.object({ instrument: text.nullable(), timeframe: text.nullable() }).strict(),
  imageQuality: z.object({
    usable: z.boolean(), summary: text, limitations: z.array(text).max(4),
  }).strict(),
  pricePanelBounds: z.object({
    leftRatio: ratio, topRatio: ratio, rightRatio: ratio, bottomRatio: ratio,
  }).strict().nullable(),
  priceScaleAnchors: z.array(z.object({
    price: z.number(), label: text, yRatio: ratio,
  }).strict()).max(12),
  priceAction: z.object({
    trend: z.enum(['bullish', 'bearish', 'sideways', 'unclear']),
    structure: z.enum(['hh-hl', 'lh-ll', 'range', 'transition', 'unclear']),
    strength: z.enum(['strong', 'moderate', 'weak', 'unclear']),
    summary: text,
    timeAnchor: text,
    evidence: z.array(text).min(1).max(6),
  }).strict(),
  volume: z.object({ summary: text, implication: text, timeAnchor: text }).strict().nullable(),
  indicators: z.array(z.object({
    id: z.string().regex(/^I\d{2}$/),
    name: z.enum(['RSI', 'MACD', 'OTHER']),
    state: text,
    implication: text,
    timeAnchor: text,
    confidence: ratio,
  }).strict()).max(4),
  levels: z.array(z.object({
    id: z.string().regex(/^L\d{2}$/),
    type: z.enum(['support', 'resistance']),
    priceLabel: text,
    price: z.number().nullable(),
    yRatio: ratio,
    reason: text,
    timeAnchor: text,
    confidence: ratio,
  }).strict()).max(6),
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
  segments: z.array(z.object({
    id: z.string().regex(/^SEG\d{2}$/),
    type: z.enum([
      'impulse_up', 'pullback_down', 'consolidation', 'breakout_up',
      'impulse_down', 'rebound_up', 'breakdown', 'transition',
    ]),
    startAnchor: text,
    endAnchor: text,
    startPriceLabel: text,
    endPriceLabel: text,
    startPoint: point,
    endPoint: point,
    strength: z.enum(['strong', 'moderate', 'weak', 'unclear']),
    priceAction: text,
    volumeBehavior: text.nullable(),
    indicatorSignals: z.array(text).max(4),
    evidence: z.array(text).min(1).max(6),
  }).strict()).min(2).max(8),
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

export const communityVisualFactsSchema = visualFactsShape.superRefine((facts, context) => {
  uniqueIds(facts.indicators, 'indicators', context);
  uniqueIds(facts.levels, 'levels', context);
  uniqueIds(facts.patterns, 'patterns', context);
  uniqueIds(facts.segments, 'segments', context);
  if (facts.pricePanelBounds
    && (facts.pricePanelBounds.leftRatio >= facts.pricePanelBounds.rightRatio
      || facts.pricePanelBounds.topRatio >= facts.pricePanelBounds.bottomRatio)) {
    context.addIssue({ code: 'custom', path: ['pricePanelBounds'], message: 'invalid_price_panel_bounds' });
  }
  const strings = collectStrings(facts);
  strings.forEach((value) => {
    try { assertScreenshotOnlyText(value); }
    catch {
      context.addIssue({ code: 'custom', path: [], message: 'external_source_claim' });
    }
  });
  try { assertSingleTimeframe(strings, facts.chart.timeframe); }
  catch {
    context.addIssue({ code: 'custom', path: ['chart', 'timeframe'], message: 'multiple_timeframes' });
  }
});

export type CommunityVisualFacts = z.infer<typeof communityVisualFactsSchema>;
export const communityVisualFactsJsonSchema = z.toJSONSchema(visualFactsShape, { target: 'draft-7' });

export function parseCommunityVisualFacts(value: unknown): CommunityVisualFacts {
  return communityVisualFactsSchema.parse(value);
}
