import { z } from 'zod';
import type { SemanticDiagnosticCode } from '../semantic-diagnostics';
import { parseCommunityVisualFacts, type CommunityVisualFacts } from './visual-facts';

type PriceAnchor = CommunityVisualFacts['priceScaleAnchors'][number];

function semanticError(path: Array<string | number>, code: SemanticDiagnosticCode): never {
  throw new z.ZodError([{ code: 'custom', path, message: code }]);
}

function monotonicAnchors(anchors: readonly PriceAnchor[]): PriceAnchor[] {
  const sorted = [...anchors].sort((left, right) => left.price - right.price);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (current.price <= previous.price || current.yRatio >= previous.yRatio) {
      semanticError(['priceScaleAnchors', index], 'price_scale_not_monotonic');
    }
  }
  return sorted;
}

export function calibratedPriceY(price: number, anchors: readonly PriceAnchor[]): number | null {
  if (anchors.length < 2) return null;
  const sorted = monotonicAnchors(anchors);
  if (price < sorted[0]!.price || price > sorted[sorted.length - 1]!.price) return null;
  for (let index = 1; index < sorted.length; index += 1) {
    const lower = sorted[index - 1]!;
    const upper = sorted[index]!;
    if (price > upper.price) continue;
    const progress = (price - lower.price) / (upper.price - lower.price);
    return lower.yRatio + progress * (upper.yRatio - lower.yRatio);
  }
  return null;
}

function insidePricePanel(yRatio: number, facts: CommunityVisualFacts): boolean {
  const bounds = facts.pricePanelBounds;
  return bounds === null || (yRatio >= bounds.topRatio && yRatio <= bounds.bottomRatio);
}

export function normalizeCommunityVisualFacts(value: unknown): CommunityVisualFacts {
  const parsed = parseCommunityVisualFacts(value);
  monotonicAnchors(parsed.priceScaleAnchors);

  const levels = parsed.levels
    .map((level) => ({
      ...level,
      yRatio: level.price === null
        ? level.yRatio
        : calibratedPriceY(level.price, parsed.priceScaleAnchors) ?? level.yRatio,
    }))
    .filter((level) => insidePricePanel(level.yRatio, parsed))
    .sort((left, right) => right.confidence - left.confidence)
    .filter((level, index, candidates) => candidates.findIndex((candidate) => (
      candidate.type === level.type && Math.abs(candidate.yRatio - level.yRatio) < 0.015
    )) === index);

  const patterns = parsed.patterns.filter((pattern) => (
    pattern.points.every((point) => insidePricePanel(point.yRatio, parsed))
  ));

  return parseCommunityVisualFacts({ ...parsed, levels, patterns });
}
