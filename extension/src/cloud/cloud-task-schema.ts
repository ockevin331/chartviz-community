import { z } from 'zod';
import type { AnalysisCapture } from '../analysis/runtime/analysis-runtime';
import type { ExtensionAnalysisTask } from './contracts/extension-cloud-v1';

export const outputLanguageSchema = z.enum(['en', 'zh-CN']);

const nullableShortString = z.string().min(1).max(120).nullable();
const captureIdSchema = z.string().regex(/^C0[1-3]$/);
const captureRoleSchema = z.enum([
  'context', 'setup', 'trigger', 'setup_and_trigger',
]).nullable();
const captureMetadataSchema = z.object({
  captureId: captureIdSchema,
  timeframe: z.string().min(1).max(8),
  role: captureRoleSchema,
  instrument: nullableShortString,
  site: z.string().min(1).max(80).nullable(),
  venue: nullableShortString,
  pageType: z.enum([
    'advanced-chart', 'spot-trade', 'futures-trade', 'stock-trade', 'web3-token',
  ]).nullable(),
  width: z.number().int().min(320).max(10_000),
  height: z.number().int().min(180).max(10_000),
}).strict();

const progressEventSchema = z.object({
  code: z.enum([
    'preparing', 'reading_chart', 'reviewing_clues', 'checking_signals',
    'preparing_result',
  ]),
  createdAt: z.string().min(1),
}).strict();

const conclusionSchema = z.object({
  direction: z.enum(['long', 'short', 'sideways']),
  trend: z.enum(['bullish', 'bearish', 'sideways', 'unclear']),
  structure: z.enum(['hh-hl', 'lh-ll', 'range', 'transition', 'unclear']),
  strength: z.enum(['strong', 'moderate', 'weak', 'unclear']),
  summary: z.string().min(1),
  primaryRisk: z.string().min(1),
  confidence: z.number().min(0).max(1),
}).strict();

const evidenceExplanationSchema = z.object({
  summary: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1).max(6),
  timeAnchor: z.string().min(1),
}).strict();

const volumeExplanationSchema = z.object({
  summary: z.string().min(1),
  implication: z.string().min(1),
  timeAnchor: z.string().min(1),
}).strict();

const indicatorExplanationSchema = z.object({
  id: z.string().regex(/^I\d{2}$/),
  name: z.enum(['RSI', 'MACD', 'OTHER']),
  state: z.string().min(1),
  implication: z.string().min(1),
  timeAnchor: z.string().min(1),
}).strict();

const marketExplanationSchema = z.object({
  priceAction: evidenceExplanationSchema,
  volume: volumeExplanationSchema.nullable(),
  indicators: z.array(indicatorExplanationSchema).max(8).default([]),
}).strict();

const levelSchema = z.object({
  id: z.string().regex(/^L\d{2}$/),
  captureId: captureIdSchema,
  type: z.enum(['support', 'resistance']),
  tier: z.enum(['nearest', 'secondary', 'major']),
  status: z.enum(['holding', 'testing', 'broken', 'flip_candidate']),
  priceLabel: z.string().min(1),
  reason: z.string().min(1),
  timeAnchor: z.string().min(1),
  yRatio: z.number().min(0).max(1).nullable(),
  confidence: z.number().min(0).max(1),
}).strict();

const scenarioSchema = z.object({
  condition: z.string().min(1),
  entry: z.string().min(1),
  stop: z.string().min(1),
  targets: z.array(z.string().min(1)).min(1).max(3),
  reason: z.string().min(1),
}).strict();

const waitScenarioSchema = z.object({
  condition: z.string().min(1),
  reason: z.string().min(1),
}).strict();

const tradePlanSchema = z.object({
  summary: z.string().min(1),
  long: scenarioSchema,
  short: scenarioSchema,
  wait: waitScenarioSchema,
}).strict();

const signalPointSchema = z.object({
  priceLabel: z.string().min(1),
  xRatio: z.number().min(0).max(1).nullable(),
  yRatio: z.number().min(0).max(1),
}).strict();

const tradeSignalSchema = z.object({
  id: z.string().regex(/^S\d{2}$/),
  captureId: captureIdSchema,
  direction: z.enum(['long', 'short']),
  signalType: z.string().min(1),
  signalTime: z.string().min(1),
  thesisAtSignal: z.string().min(1),
  evidenceAtSignal: z.array(z.string().min(1)).min(1).max(6),
  entry: signalPointSchema,
  stopLoss: signalPointSchema,
  takeProfits: z.array(signalPointSchema).min(1).max(3),
  riskReward: z.string().min(1).nullable(),
  invalidation: z.string().min(1),
  confidence: z.number().min(0).max(1),
}).strict();

const patternSchema = z.object({
  id: z.string().regex(/^P\d{2}$/),
  captureId: captureIdSchema,
  name: z.string().min(1),
  status: z.enum(['forming', 'confirmed', 'invalidated']),
  bias: z.enum(['bullish', 'bearish', 'neutral']),
  timeRange: z.string().min(1),
  evidence: z.string().min(1),
  confirmation: z.string().min(1),
  invalidation: z.string().min(1),
  confidence: z.number().min(0).max(1),
}).strict();

const timeframeViewSchema = z.object({
  captureId: captureIdSchema,
  timeframe: z.string().min(1).max(8),
  role: captureRoleSchema,
  trend: z.enum(['bullish', 'bearish', 'sideways', 'unclear']),
  structure: z.enum(['hh-hl', 'lh-ll', 'range', 'transition', 'unclear']),
  conclusion: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1).max(6),
  confidence: z.number().min(0).max(1),
}).strict();

const drawingPointSchema = z.object({
  xRatio: z.number().min(0).max(1).nullable(),
  yRatio: z.number().min(0).max(1),
  priceLabel: z.string().min(1).nullable(),
  timeAnchor: z.string().min(1).nullable(),
}).strict();

const drawingSchema = z.object({
  id: z.string().regex(/^D\d{2}$/),
  captureId: captureIdSchema,
  layer: z.enum(['levels', 'pattern', 'signal']),
  refId: z.string().regex(/^(L|P|S)\d{2}$/),
  tool: z.enum([
    'horizontal_line', 'zone', 'trend_line', 'channel', 'range', 'entry_arrow',
    'stop_line', 'target_line', 'marker',
  ]),
  points: z.array(drawingPointSchema).min(1).max(4),
}).strict();

const reportSchema = z.object({
  schemaVersion: z.literal('extension-report-1.0'),
  context: z.object({
    instrument: nullableShortString,
    venue: nullableShortString,
    outputLanguage: outputLanguageSchema,
    captures: z.array(captureMetadataSchema).min(1).max(3),
  }).strict(),
  conclusion: conclusionSchema,
  marketExplanation: marketExplanationSchema,
  levels: z.array(levelSchema).max(8).default([]),
  tradePlan: tradePlanSchema,
  tradeSignals: z.array(tradeSignalSchema).max(6).default([]),
  patterns: z.array(patternSchema).max(3).default([]),
  timeframeViews: z.array(timeframeViewSchema).min(1).max(3),
  drawings: z.array(drawingSchema).max(32).default([]),
  riskNotice: z.string().min(1),
}).strict().superRefine((report, context) => {
  const captureIds = new Set(report.context.captures.map((capture) => capture.captureId));
  if (captureIds.size !== report.context.captures.length) {
    context.addIssue({
      code: 'custom',
      path: ['context', 'captures'],
      message: 'duplicate_capture_id',
    });
  }
  const captureRoles = report.context.captures
    .map((capture) => capture.role)
    .filter((role): role is NonNullable<typeof role> => role !== null);
  if (new Set(captureRoles).size !== captureRoles.length) {
    context.addIssue({
      code: 'custom',
      path: ['context', 'captures'],
      message: 'duplicate_capture_role',
    });
  }
  const sourcedCollections = [
    ['levels', report.levels],
    ['tradeSignals', report.tradeSignals],
    ['patterns', report.patterns],
    ['timeframeViews', report.timeframeViews],
    ['drawings', report.drawings],
  ] as const;
  for (const [collectionName, items] of sourcedCollections) {
    items.forEach((item, index) => {
      if (!captureIds.has(item.captureId)) {
        context.addIssue({
          code: 'custom',
          path: [collectionName, index, 'captureId'],
          message: 'unknown_capture_id',
        });
      }
    });
  }
  const timeframeViewCaptureIds = new Set(
    report.timeframeViews.map((view) => view.captureId),
  );
  if (
    timeframeViewCaptureIds.size !== captureIds.size
    || [...captureIds].some((captureId) => !timeframeViewCaptureIds.has(captureId))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['timeframeViews'],
      message: 'timeframe_view_capture_mismatch',
    });
  }
  const references = new Map<string, { layer: string; captureId: string }>();
  for (const level of report.levels) {
    references.set(level.id, { layer: 'levels', captureId: level.captureId });
  }
  for (const signal of report.tradeSignals) {
    references.set(signal.id, { layer: 'signal', captureId: signal.captureId });
  }
  for (const pattern of report.patterns) {
    references.set(pattern.id, { layer: 'pattern', captureId: pattern.captureId });
  }
  for (const drawing of report.drawings) {
    const target = references.get(drawing.refId);
    if (!target || target.layer !== drawing.layer || target.captureId !== drawing.captureId) {
      context.addIssue({
        code: 'custom',
        path: ['drawings', drawing.id],
        message: 'drawing_reference_mismatch',
      });
    }
  }
});

const errorSchema = z.object({
  code: z.enum([
    'authentication_required', 'invalid_token', 'token_revoked', 'token_expired',
    'insufficient_scope', 'free_trial_exhausted', 'subscription_required',
    'subscription_expired', 'quota_exhausted', 'multi_timeframe_requires_advance',
    'invalid_image', 'invalid_chart_image', 'unsupported_timeframe', 'task_not_found',
    'task_failed', 'task_cancelled', 'incompatible_api_version',
    'incompatible_report_schema', 'service_unavailable',
  ]),
  params: z.record(z.string(), z.union([
    z.string(), z.number(), z.boolean(), z.null(),
  ])).default({}),
  pricingUrl: z.string().url().nullable(),
}).strict();

const taskSchema = z.object({
  requestId: z.string().min(1).max(80),
  status: z.enum([
    'pending', 'processing', 'cancel_requested', 'cancelled', 'completed', 'failed',
  ]),
  progressEvents: z.array(progressEventSchema).default([]),
  report: reportSchema.nullable(),
  error: errorSchema.nullable(),
}).strict().superRefine((task, context) => {
  if ((task.status === 'completed') !== (task.report !== null)) {
    context.addIssue({ code: 'custom', path: ['report'], message: 'invalid_terminal_report' });
  }
  if ((task.status === 'failed') !== (task.error !== null)) {
    context.addIssue({ code: 'custom', path: ['error'], message: 'invalid_terminal_error' });
  }
});

const dataUrlSchema = z.string().regex(
  /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/,
);

export const analysisCaptureSchema: z.ZodType<AnalysisCapture> = z.object({
  image: z.object({
    mediaType: z.enum(['image/png', 'image/jpeg']),
    dataUrl: dataUrlSchema,
    width: z.number().int().min(320).max(10_000),
    height: z.number().int().min(180).max(10_000),
  }).strict(),
  context: z.object({
    instrument: z.string().min(1).max(120).nullable(),
    timeframe: z.string().min(1).max(8).nullable(),
    site: z.string().min(1).max(80).nullable().optional(),
    exchange: z.string().min(1).max(120).nullable().optional(),
    pageType: z.enum([
      'advanced-chart', 'spot-trade', 'futures-trade', 'stock-trade', 'web3-token',
    ]).nullable().optional(),
  }).strict(),
}).strict();

export function parseExtensionAnalysisTask(value: unknown): ExtensionAnalysisTask {
  return taskSchema.parse(value) as ExtensionAnalysisTask;
}
