import { z } from 'zod';
import type { CommunityEvidenceBundle } from './evidence-bundle';
import { parseCommunityReportV3, type CommunityReportV3 } from './community-report-v3';
import type { OutputLanguage } from './shared-stage-types';

function semanticError(path: Array<string | number>, message: string): never {
  throw new z.ZodError([{ code: 'custom', path, message }]);
}

function narratives(value: unknown, path: Array<string | number> = [], result: string[] = []): string[] {
  if (typeof value === 'string') {
    const key = path[path.length - 1];
    if (![
      'schemaVersion', 'id', 'instrument', 'timeframe', 'priceLabel', 'riskReward',
      'direction', 'trend', 'structure', 'strength', 'type', 'tier', 'status', 'bias',
    ].includes(String(key))) result.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => narratives(entry, [...path, index], result));
  } else if (value !== null && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => narratives(entry, [...path, key], result));
  }
  return result;
}

function assertLanguage(report: CommunityReportV3, outputLanguage: OutputLanguage): void {
  for (const text of narratives(report)) {
    if (outputLanguage === 'en' && /\p{Script=Han}/u.test(text)) {
      semanticError([], 'Final report language does not match English');
    }
    if (outputLanguage === 'zh-CN'
      && /[A-Za-z]{4,}/.test(text)
      && !/\p{Script=Han}/u.test(text)
      && !/^(?:RSI|MACD|OTHER)$/.test(text)) {
      semanticError([], 'Final report language does not match Simplified Chinese');
    }
  }
}

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

export function validateCommunityReportV3Semantics(
  value: unknown,
  evidence: CommunityEvidenceBundle,
  outputLanguage: OutputLanguage,
): CommunityReportV3 {
  const report = parseCommunityReportV3(value);
  const visibleNarratives = narratives(report);
  if (visibleNarratives.some((text) => /\b(?:SEG|L|I|S|P)\d{2}\b/.test(text))) {
    semanticError([], 'Internal evidence ids must not appear in visible text');
  }
  assertLanguage(report, outputLanguage);

  const visualLevels = byId(evidence.visualFacts.levels);
  const visualIndicators = byId(evidence.visualFacts.indicators);
  const visualPatterns = byId(evidence.visualFacts.patterns);
  const signalFacts = byId(evidence.signalFacts.signals);

  if (report.levels.some(({ id }) => !visualLevels.has(id))) semanticError(['levels'], 'Unknown level id');
  if (report.marketExplanation.indicators.some(({ id }) => !visualIndicators.has(id))) {
    semanticError(['marketExplanation', 'indicators'], 'Unknown indicator id');
  }
  if (report.patterns.some(({ id }) => !visualPatterns.has(id))) semanticError(['patterns'], 'Unknown pattern id');
  const reportSignalIds = report.tradeSignals.map(({ id }) => id).sort();
  const evidenceSignalIds = [...signalFacts.keys()].sort();
  if (JSON.stringify(reportSignalIds) !== JSON.stringify(evidenceSignalIds)) {
    semanticError(['tradeSignals'], 'Final report must preserve every validated signal');
  }
  const levels = report.levels.map((level) => {
    const fact = visualLevels.get(level.id)!;
    return {
      ...level,
      type: fact.type,
      priceLabel: fact.priceLabel,
      yRatio: fact.yRatio,
      confidence: fact.confidence,
    };
  });
  for (const type of ['support', 'resistance'] as const) {
    if (levels.filter((level) => level.type === type).length > 2) {
      semanticError(['levels'], 'Final report may contain at most two levels of each type');
    }
  }
  const tradeSignals = report.tradeSignals.map((signal) => {
    const fact = signalFacts.get(signal.id)!;
    return {
      ...signal,
      direction: fact.direction,
      entry: { priceLabel: fact.entry.priceLabel, xRatio: fact.entry.xRatio, yRatio: fact.entry.yRatio },
      stopLoss: { priceLabel: fact.stopLoss.priceLabel, yRatio: fact.stopLoss.yRatio },
      takeProfits: fact.takeProfits.map(({ priceLabel, yRatio }) => ({ priceLabel, yRatio })),
      riskReward: fact.riskReward,
      confidence: fact.confidence,
    };
  });
  const patterns = report.patterns.map((pattern) => {
    const fact = visualPatterns.get(pattern.id)!;
    return {
      ...pattern,
      status: fact.status,
      bias: fact.bias,
      confidence: fact.confidence,
      points: fact.points,
    };
  });
  return parseCommunityReportV3({
    ...report,
    chart: evidence.visualFacts.chart,
    levels,
    tradeSignals,
    patterns,
  });
}
