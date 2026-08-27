import { z } from 'zod';
import type { SemanticDiagnosticCode } from '../semantic-diagnostics';
import { findSingleTimeframeConflict } from '../source-policy';
import type { CommunityEvidenceBundle } from './evidence-bundle';
import {
  parseCommunityReportV3,
  parseCommunityReportV3Shape,
  type CommunityReportV3,
} from './community-report-v3';
import type { OutputLanguage } from './shared-stage-types';

type Narrative = Readonly<{ text: string; path: Array<string | number> }>;

const supportedTechnicalLabels = /^(?:RSI|MACD|VWAP|EMA|SMA|ATR|OBV|OHLC|OTHER)(?:\s*\d+)?$/;

function semanticError(
  path: Array<string | number>,
  code: SemanticDiagnosticCode,
  valuePreview?: string,
): never {
  throw new z.ZodError([{
    code: 'custom',
    path,
    message: code,
    ...(valuePreview === undefined ? {} : { params: { valuePreview } }),
  }]);
}

function narratives(value: unknown, path: Array<string | number> = [], result: Narrative[] = []): Narrative[] {
  if (typeof value === 'string') {
    const key = path[path.length - 1];
    if (![
      'schemaVersion', 'id', 'instrument', 'timeframe', 'priceLabel', 'riskReward',
      'direction', 'trend', 'structure', 'strength', 'type', 'tier', 'status', 'bias',
      'geometryKind',
    ].includes(String(key))) result.push({ text: value, path });
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => narratives(entry, [...path, index], result));
  } else if (value !== null && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => narratives(entry, [...path, key], result));
  }
  return result;
}

function assertLanguage(report: CommunityReportV3, outputLanguage: OutputLanguage): void {
  for (const { text, path } of narratives(report)) {
    if (outputLanguage === 'en' && /\p{Script=Han}/u.test(text)) {
      semanticError(path, 'output_language_mismatch', text);
    }
    if (outputLanguage === 'zh-CN'
      && /[A-Za-z]{4,}/.test(text)
      && !/\p{Script=Han}/u.test(text)
      && !supportedTechnicalLabels.test(text)) {
      semanticError(path, 'output_language_mismatch', text);
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
  const reportShape = parseCommunityReportV3Shape(value);
  const anchoredReport = {
    ...reportShape,
    chart: evidence.visualFacts.chart,
  };
  const anchoredNarratives = narratives(anchoredReport);
  const timeframeConflict = findSingleTimeframeConflict(
    anchoredNarratives.map(({ text }) => text),
    anchoredReport.chart.timeframe,
  );
  if (timeframeConflict !== null) {
    const offending = timeframeConflict.index < 0
      ? { path: ['chart', 'timeframe'] as Array<string | number>, text: timeframeConflict.text }
      : anchoredNarratives[timeframeConflict.index]!;
    semanticError(offending.path, 'multiple_timeframes', offending.text);
  }
  const report = parseCommunityReportV3(anchoredReport);
  const visibleNarratives = narratives(report);
  const exposedId = visibleNarratives.find(({ text }) => /\b(?:SEG|L|I|S|P)\d{2}\b/.test(text));
  if (exposedId) {
    semanticError(exposedId.path, 'internal_evidence_id_exposed');
  }
  assertLanguage(report, outputLanguage);

  const visualLevels = byId(evidence.visualFacts.levels);
  const visualIndicators = byId(evidence.visualFacts.indicators);
  const visualPatterns = byId(evidence.visualFacts.patterns);
  const signalFacts = byId(evidence.signalFacts.signals);

  if (report.levels.some(({ id }) => !visualLevels.has(id))) semanticError(['levels'], 'unknown_level_id');
  if (report.marketExplanation.indicators.some(({ id }) => !visualIndicators.has(id))) {
    semanticError(['marketExplanation', 'indicators'], 'unknown_indicator_id');
  }
  if (report.patterns.some(({ id }) => !visualPatterns.has(id))) semanticError(['patterns'], 'unknown_pattern_id');
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
  for (const type of ['support', 'resistance'] as const) {
    if (levels.filter((level) => level.type === type).length > 2) {
      semanticError(['levels'], 'too_many_levels');
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
