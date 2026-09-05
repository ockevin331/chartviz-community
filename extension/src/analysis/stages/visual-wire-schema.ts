import { z } from 'zod';
import { canonicalPatternTypeSchema } from './pattern-types';

const text = (description: string) => z.string().trim().min(1).describe(description);
const ratio = (description: string) => z.number().min(0).max(1).describe(description);

const point = (description: string) => z.object({
  xRatio: ratio('Horizontal coordinate across the full screenshot from 0 at the left to 1 at the right.'),
  yRatio: ratio('Vertical coordinate across the full screenshot from 0 at the top to 1 at the bottom.'),
}).strict().describe(description);

const boundary = (description: string) => z.object({
  start: point('Visible starting anchor of this boundary.'),
  end: point('Visible ending anchor of this boundary.'),
}).strict().describe(description);

const geometryShape = z.object({
  geometryKind: z.enum(['polyline', 'channel', 'range']).describe('Geometry used to annotate the visible pattern.'),
  points: z.array(point('One visible polyline vertex.')).max(8).describe('Ordered polyline vertices; empty for channel and range geometry.'),
  upperBoundary: boundary('Upper channel boundary or horizontal range resistance.').nullable().describe('Upper boundary, or null for polyline geometry.'),
  lowerBoundary: boundary('Lower channel boundary or horizontal range support.').nullable().describe('Lower boundary, or null for polyline geometry.'),
}).strict().describe('Coordinates for drawing the visible chart pattern.');

const geometry = geometryShape.superRefine((value, context) => {
  if (value.geometryKind === 'polyline') {
    if (value.points.length < 2) context.addIssue({ code: 'custom', path: ['points'], message: 'polyline_requires_points' });
    if (value.upperBoundary !== null || value.lowerBoundary !== null) {
      context.addIssue({ code: 'custom', path: ['geometryKind'], message: 'polyline_cannot_have_boundaries' });
    }
    return;
  }
  if (value.points.length !== 0) context.addIssue({ code: 'custom', path: ['points'], message: 'boundary_geometry_cannot_have_points' });
  if (value.upperBoundary === null || value.lowerBoundary === null) {
    context.addIssue({ code: 'custom', path: ['geometryKind'], message: 'boundary_geometry_requires_two_boundaries' });
  }
});

const wireShape = z.object({
  schemaVersion: z.literal('community-visual-wire-1.0').describe('Exact visual wire contract version.'),
  chart: z.object({
    instrument: text('Instrument read directly from the screenshot, or null when trusted page metadata already supplies it.').nullable().describe('Screenshot instrument fallback, or null.'),
    timeframe: text('Timeframe read directly from the screenshot, or null when trusted page metadata already supplies it.').nullable().describe('Screenshot timeframe fallback, or null.'),
  }).strict().nullable().describe('Screenshot chart identity fallback; null when trusted page metadata supplies both fields.'),
  imageQuality: z.object({
    usable: z.boolean().describe('Whether the screenshot contains enough readable chart evidence for analysis.'),
    limitations: z.array(text('One concrete visible image limitation.')).max(4).describe('Visible limitations only; empty when none are material.'),
  }).strict().describe('Model-observed screenshot usability without a redundant prose summary.'),
  pricePanelBounds: z.object({
    leftRatio: ratio('Left edge of the candle-price panel.'),
    topRatio: ratio('Top edge of the candle-price panel.'),
    rightRatio: ratio('Right edge of the candle-price panel.'),
    bottomRatio: ratio('Bottom edge of the candle-price panel.'),
  }).strict().nullable().describe('Candle-price panel bounds across the full screenshot, or null when not reliably visible.'),
  priceScaleAnchors: z.array(z.object({
    price: z.number().describe('Numeric price read from the visible price axis.'),
    yRatio: ratio('Vertical coordinate of the visible price label across the full screenshot.'),
  }).strict().describe('One numeric price-axis calibration anchor.')).max(12).describe('Visible numeric price-axis anchors without redundant formatted labels.'),
  priceAction: z.object({
    trend: z.enum(['bullish', 'bearish', 'sideways', 'unclear']).describe('Visible directional trend classification.'),
    structure: z.enum(['hh-hl', 'lh-ll', 'range', 'transition', 'unclear']).describe('Visible swing-structure classification.'),
    strength: z.enum(['strong', 'moderate', 'weak', 'unclear']).describe('Strength of the visible price movement.'),
    summary: text('Concise factual summary of visible price action.'),
    timeAnchor: text('Visible time or conservative chart-region anchor for the price-action conclusion.'),
    evidence: z.array(text('One directly visible price-action observation.')).min(1).max(6).describe('Direct screenshot evidence supporting the price-action conclusion.'),
  }).strict().describe('Required market structure and price-action evidence.'),
  volume: z.object({
    summary: text('Concise factual summary of visible traded volume.'),
    implication: text('What the visible volume behavior supports or fails to confirm.'),
    timeAnchor: text('Visible time or conservative chart-region anchor for the volume observation.'),
  }).strict().nullable().describe('Visible traded-volume evidence, or null when no volume panel is readable.'),
  indicators: z.array(z.object({
    id: z.string().regex(/^I\d{2}$/).describe('Stable indicator evidence ID such as I01.'),
    name: z.enum(['RSI', 'MACD', 'OTHER']).describe('Supported indicator category visible in the screenshot.'),
    state: text('Current visible state of the indicator.'),
    implication: text('What the visible indicator state supports or contradicts.'),
    timeAnchor: text('Visible time or conservative chart-region anchor for the indicator state.'),
    confidence: ratio('Confidence from 0 to 1 that this indicator observation is readable and correct.'),
  }).strict().describe('One readable indicator observation.')).max(4).describe('Readable indicator evidence; empty when no indicator is clearly visible.'),
  levels: z.array(z.object({
    id: z.string().regex(/^L\d{2}$/).describe('Stable level evidence ID such as L01.'),
    type: z.enum(['support', 'resistance']).describe('Whether the visible level is support or resistance.'),
    priceLabel: text('Price label exactly as readable, or a conservative visible range label.'),
    price: z.number().nullable().describe('Exact numeric price when readable, otherwise null.'),
    yRatio: ratio('Vertical coordinate of the level across the full screenshot.'),
    reason: text('Direct visible reactions that make this level relevant.'),
    timeAnchor: text('Visible time or conservative chart-region anchor for the reactions.'),
    confidence: ratio('Confidence from 0 to 1 that this level is visibly supported.'),
  }).strict().describe('One visible support or resistance level.')).max(6).describe('Visible support and resistance evidence; empty only when none is credible.'),
  patterns: z.array(z.object({
    id: z.string().regex(/^P\d{2}$/).describe('Stable pattern evidence ID such as P01.'),
    canonicalType: canonicalPatternTypeSchema.nullable().describe('Supported canonical pattern type, or null when none fits exactly.'),
    name: text('Concise fallback name for the visible pattern.'),
    status: z.enum(['forming', 'confirmed', 'invalidated']).describe('Current visible pattern status.'),
    bias: z.enum(['bullish', 'bearish', 'neutral']).describe('Directional bias implied by the visible pattern structure.'),
    timeRange: text('Visible time span or conservative chart-region span occupied by the pattern.'),
    evidence: text('Directly visible geometry and reactions supporting the pattern.'),
    confirmation: text('Visible price behavior that would confirm the pattern.'),
    invalidation: text('Visible price behavior that would invalidate the pattern.'),
    confidence: ratio('Confidence from 0 to 1 that the pattern is visibly supported.'),
    geometry,
  }).strict().describe('One credible visible chart pattern.')).max(3).describe('Credible visible patterns; empty when no pattern is supported.'),
  segments: z.array(z.object({
    id: z.string().regex(/^SEG\d{2}$/).describe('Stable internal segment ID such as SEG01.'),
    type: z.enum(['impulse_up', 'pullback_down', 'consolidation', 'breakout_up', 'impulse_down', 'rebound_up', 'breakdown', 'transition']).describe('Price-action segment classification.'),
    startAnchor: text('Visible time or conservative chart-region anchor at the segment start.'),
    endAnchor: text('Visible time or conservative chart-region anchor at the segment end.'),
    startPriceLabel: text('Readable or conservative price label at the segment start.'),
    endPriceLabel: text('Readable or conservative price label at the segment end.'),
    startPoint: point('Coordinate of the segment start across the full screenshot.'),
    endPoint: point('Coordinate of the segment end across the full screenshot.'),
    strength: z.enum(['strong', 'moderate', 'weak', 'unclear']).describe('Strength of this visible segment.'),
    priceAction: text('Visible candle and swing behavior within the segment.'),
    volumeBehavior: text('Visible volume behavior within the segment.').nullable().describe('Visible volume behavior, or null when volume is unreadable.'),
    indicatorSignals: z.array(text('One readable indicator observation aligned with this segment.')).max(4).describe('Readable indicator evidence for the segment.'),
    evidence: z.array(text('One directly visible observation supporting the segment classification.')).min(1).max(6).describe('Direct screenshot evidence for the segment.'),
  }).strict().describe('One internal price-action segment.')).min(2).max(8).describe('Required internal segmentation of the visible price action.'),
}).strict();

function uniqueIds(items: readonly { id: string }[], path: string, context: z.RefinementCtx): void {
  const seen = new Set<string>();
  items.forEach(({ id }, index) => {
    if (seen.has(id)) context.addIssue({ code: 'custom', path: [path, index, 'id'], message: 'duplicate_id' });
    seen.add(id);
  });
}

export const communityVisualWireSchema = wireShape.superRefine((facts, context) => {
  uniqueIds(facts.indicators, 'indicators', context);
  uniqueIds(facts.levels, 'levels', context);
  uniqueIds(facts.patterns, 'patterns', context);
  uniqueIds(facts.segments, 'segments', context);
  if (facts.pricePanelBounds
    && (facts.pricePanelBounds.leftRatio >= facts.pricePanelBounds.rightRatio
      || facts.pricePanelBounds.topRatio >= facts.pricePanelBounds.bottomRatio)) {
    context.addIssue({ code: 'custom', path: ['pricePanelBounds'], message: 'invalid_price_panel_bounds' });
  }
});

export type CommunityVisualWireFacts = z.infer<typeof communityVisualWireSchema>;
export const communityVisualWireJsonSchema = z.toJSONSchema(wireShape, { target: 'draft-7' });

export function parseCommunityVisualWireFacts(value: unknown): CommunityVisualWireFacts {
  return communityVisualWireSchema.parse(value);
}
