import type { ProviderError } from './provider-errors';
import type { ProviderKind } from './provider-types';

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
}>;

export type ProviderFailureDetail = Readonly<{
  stage: ProviderDiagnosticStage;
  issues: readonly ProviderDiagnosticIssue[];
}>;

export type AnalysisDiagnostic = Readonly<{
  requestId: string;
  provider: ProviderKind;
  model: string;
  stage: ProviderDiagnosticStage;
  occurredAt: string;
  durationMs: number;
  httpStatus?: number;
  issues: readonly ProviderDiagnosticIssue[];
}>;

const details = new WeakMap<ProviderError, ProviderFailureDetail>();

function freezeDetail(detail: ProviderFailureDetail): ProviderFailureDetail {
  return Object.freeze({
    stage: detail.stage,
    issues: Object.freeze(detail.issues.slice(0, 20).map((issue) => Object.freeze({
      path: issue.path.slice(0, 160),
      code: issue.code.slice(0, 80),
    }))),
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
      : message === 'Report must describe exactly one visible timeframe'
        ? 'multiple_timeframes'
        : message.startsWith('Report text must not claim ')
          ? 'external_source_claim'
          : message.startsWith('Duplicate ')
            ? 'duplicate_id'
            : 'custom';
    return [{ path, code }];
  });
  const semanticCodes = new Set(['custom', 'multiple_timeframes', 'external_source_claim', 'duplicate_id']);
  return freezeDetail({
    stage: issues.length > 0 && issues.every(({ code }) => semanticCodes.has(code))
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
    requestId: input.requestId,
    provider: input.provider,
    model: input.model,
    stage: detail?.stage ?? input.fallbackStage ?? 'response_envelope',
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    durationMs: Math.max(0, Math.round(input.finishedAt - input.startedAt)),
    ...(input.error.httpStatus === undefined ? {} : { httpStatus: input.error.httpStatus }),
    issues: detail?.issues ?? [],
  };
  return Object.freeze({ ...diagnostic, issues: Object.freeze([...diagnostic.issues]) });
}
