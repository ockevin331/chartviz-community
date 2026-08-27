import type { ProviderError } from './provider-errors';
import type { ProviderKind } from './provider-types';
import {
  COMMUNITY_ANALYSIS_PIPELINE_VERSION,
  isSemanticDiagnosticCode,
} from '../analysis/semantic-diagnostics';

export type ProviderDiagnosticStage =
  | 'transport'
  | 'response_envelope'
  | 'json_parse'
  | 'report_shape'
  | 'report_semantics'
  | 'visual_extraction_transport'
  | 'visual_extraction_shape'
  | 'visual_extraction_semantics'
  | 'signal_extraction_transport'
  | 'signal_extraction_shape'
  | 'signal_extraction_semantics'
  | 'evidence_reasoning_transport'
  | 'annotation_rendering';

export type ProviderDiagnosticIssue = Readonly<{
  path: string;
  code: string;
  valuePreview?: string;
}>;

export type AnalysisStageSnapshot = Readonly<{
  stage: 'visual_extraction' | 'signal_extraction' | 'evidence_reasoning';
  promptVersion: string;
  schemaName: string;
  hasImage: boolean;
  systemPrompt: string;
  userPrompt: string;
  output?: unknown;
}>;

export type AnalysisFailureSnapshot = Readonly<{
  context: Readonly<{
    instrument: string | null;
    timeframe: string | null;
    site: string | null;
    exchange: string | null;
  }>;
  outputLanguage: 'en' | 'zh-CN';
  stages: readonly AnalysisStageSnapshot[];
}>;

export type ProviderFailureDetail = Readonly<{
  stage: ProviderDiagnosticStage;
  issues: readonly ProviderDiagnosticIssue[];
  snapshot?: AnalysisFailureSnapshot;
}>;

export type AnalysisDiagnostic = Readonly<{
  source: 'extension_local';
  pipelineVersion: typeof COMMUNITY_ANALYSIS_PIPELINE_VERSION;
  requestId: string;
  provider: ProviderKind;
  model: string;
  stage: ProviderDiagnosticStage;
  occurredAt: string;
  durationMs: number;
  httpStatus?: number;
  issues: readonly ProviderDiagnosticIssue[];
  snapshot?: AnalysisFailureSnapshot;
}>;

const details = new WeakMap<ProviderError, ProviderFailureDetail>();

function safeValuePreview(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || /(?:data:image\/|bearer\s+|\bsk-[A-Za-z0-9_-]{8,}|api[_ -]?key)/i.test(normalized)) {
    return undefined;
  }
  return normalized.slice(0, 120);
}

function sanitizeSnapshotValue(value: unknown, depth = 0): unknown {
  if (depth > 20) return '[depth omitted]';
  if (typeof value === 'string') {
    if (/^data:image\//i.test(value)) return '[image omitted]';
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
      .slice(0, 120_000);
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.slice(0, 100).map((entry) => sanitizeSnapshotValue(entry, depth + 1)));
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/api.?key|authorization/i.test(key))
      .slice(0, 200)
      .map(([key, entry]) => [key, sanitizeSnapshotValue(entry, depth + 1)] as const);
    return Object.freeze(Object.fromEntries(entries));
  }
  return value;
}

function freezeSnapshot(snapshot: AnalysisFailureSnapshot): AnalysisFailureSnapshot {
  return sanitizeSnapshotValue(snapshot) as AnalysisFailureSnapshot;
}

function freezeDetail(detail: ProviderFailureDetail): ProviderFailureDetail {
  return Object.freeze({
    stage: detail.stage,
    issues: Object.freeze(detail.issues.slice(0, 20).map((issue) => {
      const valuePreview = safeValuePreview(issue.valuePreview);
      return Object.freeze({
        path: issue.path.slice(0, 160),
        code: issue.code.slice(0, 80),
        ...(valuePreview === undefined ? {} : { valuePreview }),
      });
    })),
    ...(detail.snapshot === undefined ? {} : { snapshot: freezeSnapshot(detail.snapshot) }),
  });
}

export function attachProviderFailureDetail(error: ProviderError, detail: ProviderFailureDetail): ProviderError {
  details.set(error, freezeDetail(detail));
  return error;
}

export function getProviderFailureDetail(error: unknown): ProviderFailureDetail | null {
  return error instanceof Error ? details.get(error as ProviderError) ?? null : null;
}

export function validationFailureDetail(error: unknown): ProviderFailureDetail {
  const candidate = error !== null && typeof error === 'object' && !Array.isArray(error)
    ? error as Record<string, unknown>
    : null;
  const rawIssues = candidate && Array.isArray(candidate.issues) ? candidate.issues : [];
  const issues = rawIssues.flatMap((issue): ProviderDiagnosticIssue[] => {
    if (issue === null || typeof issue !== 'object' || Array.isArray(issue)) return [];
    const record = issue as Record<string, unknown>;
    if (typeof record.code !== 'string' || !Array.isArray(record.path)) return [];
    const path = record.path
      .filter((segment): segment is string | number => typeof segment === 'string' || typeof segment === 'number')
      .map(String)
      .join('.');
    const message = typeof record.message === 'string' ? record.message : '';
    const code = record.code !== 'custom'
      ? record.code
      : isSemanticDiagnosticCode(message)
        ? message
        : 'unclassified_semantic_error';
    const params = record.params !== null && typeof record.params === 'object' && !Array.isArray(record.params)
      ? record.params as Record<string, unknown>
      : null;
    const valuePreview = safeValuePreview(params?.valuePreview);
    return [{ path, code, ...(valuePreview === undefined ? {} : { valuePreview }) }];
  });
  return freezeDetail({
    stage: issues.length > 0 && issues.every(({ code }) => isSemanticDiagnosticCode(code))
      ? 'report_semantics'
      : 'report_shape',
    issues,
  });
}

export function createAnalysisDiagnostic(input: {
  error: ProviderError;
  provider: ProviderKind;
  model: string;
  requestId: string;
  startedAt: number;
  finishedAt: number;
  occurredAt?: string;
  fallbackStage?: ProviderDiagnosticStage;
}): AnalysisDiagnostic {
  const detail = getProviderFailureDetail(input.error);
  const diagnostic: AnalysisDiagnostic = {
    source: 'extension_local',
    pipelineVersion: COMMUNITY_ANALYSIS_PIPELINE_VERSION,
    requestId: input.requestId,
    provider: input.provider,
    model: input.model,
    stage: detail?.stage ?? input.fallbackStage ?? 'response_envelope',
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    durationMs: Math.max(0, Math.round(input.finishedAt - input.startedAt)),
    ...(input.error.httpStatus === undefined ? {} : { httpStatus: input.error.httpStatus }),
    issues: detail?.issues ?? [],
    ...(detail?.snapshot === undefined ? {} : { snapshot: detail.snapshot }),
  };
  return Object.freeze({ ...diagnostic, issues: Object.freeze([...diagnostic.issues]) });
}
