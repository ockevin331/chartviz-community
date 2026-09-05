import { z } from 'zod';
import type { SemanticDiagnosticCode } from '../semantic-diagnostics';
import type { CommunityEvidenceBundle } from './evidence-bundle';
import {
  parseCommunityReportV3,
  parseCommunityReportV3Shape,
  type CommunityReportV3,
} from './community-report-v3';
import { localizedPatternName } from './pattern-types';
import type { OutputLanguage } from './shared-stage-types';
import { localizedSignalType } from './signal-types';

function semanticError(path: Array<string | number>, code: SemanticDiagnosticCode): never {
  throw new z.ZodError([{ code: 'custom', path, message: code }]);
}

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

export function finalizeCommunityReportV3(
  value: unknown,
  evidence: CommunityEvidenceBundle,
  outputLanguage: OutputLanguage,
): CommunityReportV3 {
  const report = parseCommunityReportV3({
    ...parseCommunityReportV3Shape(value),
    chart: evidence.visualFacts.chart,
  });
  const visualLevels = byId(evidence.visualFacts.levels);
  const visualIndicators = byId(evidence.visualFacts.indicators);
  const visualPatterns = byId(evidence.visualFacts.patterns);
  const signalFacts = byId(evidence.signalFacts.signals);

  if (report.levels.some(({ id }) => !visualLevels.has(id))) {
    semanticError(['levels'], 'unknown_level_id');
  }
  if (report.marketExplanation.indicators.some(({ id }) => !visualIndicators.has(id))) {
    semanticError(['marketExplanation', 'indicators'], 'unknown_indicator_id');
  }
  if (report.patterns.some(({ id }) => !visualPatterns.has(id))) {
    semanticError(['patterns'], 'unknown_pattern_id');
  }
  const reportSignalIds = report.tradeSignals.map(({ id }) => id).sort();
  const evidenceSignalIds = [...signalFacts.keys()].sort();
  if (JSON.stringify(reportSignalIds) !== JSON.stringify(evidenceSignalIds)) {
    semanticError(['tradeSignals'], 'signal_set_mismatch');
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
  const tradeSignals = report.tradeSignals.map((signal) => {
    const fact = signalFacts.get(signal.id)!;
    return {
      ...signal,
      direction: fact.direction,
      signalType: localizedSignalType(fact.signalType, outputLanguage),
      entry: {
        priceLabel: fact.entry.priceLabel,
        xRatio: fact.entry.xRatio,
        yRatio: fact.entry.yRatio,
      },
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
      name: fact.canonicalType === null
        ? pattern.name
        : localizedPatternName(fact.canonicalType, outputLanguage),
      status: fact.status,
      bias: fact.bias,
      confidence: fact.confidence,
      geometry: fact.geometry,
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
