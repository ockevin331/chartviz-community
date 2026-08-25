import { z } from 'zod';
import { assertScreenshotOnlyText, assertSingleTimeframe } from './source-policy';

const nonEmptyText = z.string().trim().min(1);
const evidenceId = nonEmptyText;
const normalizedNumber = z.number().min(0).max(1);

const evidenceSchema = z.object({
  id: evidenceId,
  category: z.enum(['price', 'volume', 'indicator', 'level', 'pattern', 'signal']),
  observation: nonEmptyText,
  implication: nonEmptyText,
  timeAnchor: nonEmptyText,
  confidence: normalizedNumber,
}).strict();

const observationSchema = z.object({
  summary: nonEmptyText,
  evidenceIds: z.array(evidenceId),
}).strict();

const indicatorObservationSchema = z.object({
  name: z.enum(['RSI', 'MACD', 'OTHER']),
  summary: nonEmptyText,
  implication: nonEmptyText,
  evidenceIds: z.array(evidenceId),
}).strict();

const levelSchema = z.object({
  id: nonEmptyText,
  type: z.enum(['support', 'resistance']),
  priceLabel: nonEmptyText,
  reason: nonEmptyText,
  timeAnchor: nonEmptyText,
  yRatio: normalizedNumber,
  evidenceIds: z.array(evidenceId),
}).strict();

const scenarioSchema = z.object({
  condition: nonEmptyText,
  entry: nonEmptyText,
  stop: nonEmptyText,
  targets: z.array(nonEmptyText),
  reason: nonEmptyText,
  evidenceIds: z.array(evidenceId),
}).strict();

const waitScenarioSchema = z.object({
  condition: nonEmptyText,
  reason: nonEmptyText,
  evidenceIds: z.array(evidenceId),
}).strict();

const pointSchema = z.object({
  xRatio: normalizedNumber,
  yRatio: normalizedNumber,
}).strict();

const patternSchema = z.object({
  id: nonEmptyText,
  name: nonEmptyText,
  status: z.enum(['forming', 'confirmed', 'invalidated']),
  bias: z.enum(['bullish', 'bearish', 'neutral']),
  timeRange: nonEmptyText,
  explanation: nonEmptyText,
  confidence: normalizedNumber,
  points: z.array(pointSchema).min(2).max(8),
  evidenceIds: z.array(evidenceId),
}).strict();

const signalEntrySchema = z.object({
  priceLabel: nonEmptyText,
  xRatio: normalizedNumber,
  yRatio: normalizedNumber,
}).strict();

const signalPriceSchema = z.object({
  priceLabel: nonEmptyText,
  yRatio: normalizedNumber,
}).strict();

const tradeSignalSchema = z.object({
  id: nonEmptyText,
  direction: z.enum(['long', 'short']),
  timeAnchor: nonEmptyText,
  reason: nonEmptyText,
  entry: signalEntrySchema,
  stop: signalPriceSchema,
  targets: z.array(signalPriceSchema).min(1).max(3),
  riskReward: nonEmptyText.nullable(),
  confidence: normalizedNumber,
  evidenceIds: z.array(evidenceId),
}).strict();

const reportShapeSchema = z.object({
  schemaVersion: z.literal('community-1.0'),
  chart: z.object({
    instrument: nonEmptyText.nullable(),
    timeframe: nonEmptyText.nullable(),
    limitations: z.array(nonEmptyText),
  }).strict(),
  marketView: z.object({
    bias: z.enum(['bullish', 'bearish', 'sideways', 'unclear']),
    phase: z.enum(['trend', 'range', 'transition', 'unclear']),
    strength: z.enum(['strong', 'moderate', 'weak', 'unclear']),
    summary: nonEmptyText,
    evidenceIds: z.array(evidenceId),
  }).strict(),
  evidence: z.array(evidenceSchema).max(12),
  volume: observationSchema.nullable(),
  indicators: z.array(indicatorObservationSchema).max(4),
  levels: z.array(levelSchema).max(4),
  scenarios: z.object({
    long: scenarioSchema,
    short: scenarioSchema,
    wait: waitScenarioSchema,
  }).strict(),
  patterns: z.array(patternSchema).max(3),
  signals: z.array(tradeSignalSchema).max(3),
  riskNotice: nonEmptyText,
}).strict();

type Path = Array<string | number>;

function walkText(value: unknown, path: Path, visit: (text: string, path: Path) => void): void {
  if (typeof value === 'string') {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkText(item, [...path, index], visit));
    return;
  }
  if (value !== null && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => walkText(item, [...path, key], visit));
  }
}

function collectUserFacingText(report: z.infer<typeof reportShapeSchema>): string[] {
  return [
    ...(report.chart.instrument === null ? [] : [report.chart.instrument]),
    ...(report.chart.timeframe === null ? [] : [report.chart.timeframe]),
    ...report.chart.limitations,
    report.marketView.summary,
    ...report.evidence.flatMap(({ observation, implication, timeAnchor }) => [observation, implication, timeAnchor]),
    ...(report.volume === null ? [] : [report.volume.summary]),
    ...report.indicators.flatMap(({ summary, implication }) => [summary, implication]),
    ...report.levels.flatMap(({ priceLabel, reason, timeAnchor }) => [priceLabel, reason, timeAnchor]),
    ...[report.scenarios.long, report.scenarios.short].flatMap(({ condition, entry, stop, targets, reason }) => [
      condition,
      entry,
      stop,
      ...targets,
      reason,
    ]),
    report.scenarios.wait.condition,
    report.scenarios.wait.reason,
    ...report.patterns.flatMap(({ name, timeRange, explanation }) => [name, timeRange, explanation]),
    ...report.signals.flatMap(({ timeAnchor, reason, entry, stop, targets, riskReward }) => [
      timeAnchor,
      reason,
      entry.priceLabel,
      stop.priceLabel,
      ...targets.map(({ priceLabel }) => priceLabel),
      ...(riskReward === null ? [] : [riskReward]),
    ]),
    report.riskNotice,
  ];
}

export const communityReportSchema = reportShapeSchema.superRefine((report, context) => {
  const evidenceIndexes = new Map<string, number>();
  report.evidence.forEach(({ id }, index) => {
    const previousIndex = evidenceIndexes.get(id);
    if (previousIndex !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['evidence', index, 'id'],
        message: `Evidence ID duplicates evidence[${previousIndex}].id`,
      });
    } else {
      evidenceIndexes.set(id, index);
    }
  });

  const references: Array<{ ids: string[]; path: Path }> = [
    { ids: report.marketView.evidenceIds, path: ['marketView', 'evidenceIds'] },
    ...(report.volume ? [{ ids: report.volume.evidenceIds, path: ['volume', 'evidenceIds'] as Path }] : []),
    ...report.indicators.map(({ evidenceIds }, index) => ({ ids: evidenceIds, path: ['indicators', index, 'evidenceIds'] })),
    ...report.levels.map(({ evidenceIds }, index) => ({ ids: evidenceIds, path: ['levels', index, 'evidenceIds'] })),
    { ids: report.scenarios.long.evidenceIds, path: ['scenarios', 'long', 'evidenceIds'] },
    { ids: report.scenarios.short.evidenceIds, path: ['scenarios', 'short', 'evidenceIds'] },
    { ids: report.scenarios.wait.evidenceIds, path: ['scenarios', 'wait', 'evidenceIds'] },
    ...report.patterns.map(({ evidenceIds }, index) => ({ ids: evidenceIds, path: ['patterns', index, 'evidenceIds'] })),
    ...report.signals.map(({ evidenceIds }, index) => ({ ids: evidenceIds, path: ['signals', index, 'evidenceIds'] })),
  ];

  for (const { ids, path } of references) {
    ids.forEach((id, index) => {
      if (!evidenceIndexes.has(id)) {
        context.addIssue({
          code: 'custom',
          path: [...path, index],
          message: `Evidence reference does not resolve: ${id}`,
        });
      }
    });
  }

  try {
    if (report.chart.timeframe !== null && /^\[[\s\S]*\]$/.test(report.chart.timeframe)) {
      throw new Error('Report must describe exactly one visible timeframe');
    }
    assertSingleTimeframe(collectUserFacingText(report));
  } catch (error) {
    context.addIssue({
      code: 'custom',
      path: ['chart', 'timeframe'],
      message: error instanceof Error ? error.message : 'Report must describe exactly one visible timeframe',
    });
  }

  walkText(report, [], (text, path) => {
    try {
      assertScreenshotOnlyText(text);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        path,
        message: error instanceof Error ? error.message : 'Report text must be screenshot-only',
      });
    }
  });
});

export type CommunityReport = z.infer<typeof communityReportSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Observation = z.infer<typeof observationSchema>;
export type IndicatorObservation = z.infer<typeof indicatorObservationSchema>;
export type Level = z.infer<typeof levelSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type WaitScenario = z.infer<typeof waitScenarioSchema>;
export type Pattern = z.infer<typeof patternSchema>;
export type TradeSignal = z.infer<typeof tradeSignalSchema>;

export function parseCommunityReport(value: unknown): CommunityReport {
  return communityReportSchema.parse(value);
}
