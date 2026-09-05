import type { ProviderKind } from '../providers/provider-types';
import { COMMUNITY_ANALYSIS_PIPELINE_VERSION } from './semantic-diagnostics';

export const ANALYSIS_VALIDATION_POLICY_VERSION = 'deterministic-1.0' as const;

export const analysisWarningCodes = [
  'possible_timeframe_reference',
  'output_language_mismatch',
  'internal_id_exposed',
  'unexpected_source_claim',
] as const;

export type AnalysisWarningCode = typeof analysisWarningCodes[number];

export type AnalysisWarningStage =
  | 'visual_extraction'
  | 'signal_extraction'
  | 'evidence_reasoning';

export type AnalysisWarning = Readonly<{
  stage: AnalysisWarningStage;
  code: AnalysisWarningCode;
  path: readonly (string | number)[];
  valuePreview: string;
}>;

export type AnalysisQualityDiagnostic = Readonly<{
  source: 'extension_local';
  pipelineVersion: typeof COMMUNITY_ANALYSIS_PIPELINE_VERSION;
  validationPolicyVersion: typeof ANALYSIS_VALIDATION_POLICY_VERSION;
  requestId: string;
  provider: ProviderKind;
  model: string;
  occurredAt: string;
  durationMs: number;
  warnings: readonly AnalysisWarning[];
}>;

const analysisWarningCodeSet = new Set<string>(analysisWarningCodes);

export function isAnalysisWarningCode(value: string): value is AnalysisWarningCode {
  return analysisWarningCodeSet.has(value);
}

export function createAnalysisQualityDiagnostic(input: Readonly<{
  requestId: string;
  provider: ProviderKind;
  model: string;
  startedAt: number;
  finishedAt: number;
  warnings: readonly AnalysisWarning[];
}>): AnalysisQualityDiagnostic {
  return Object.freeze({
    source: 'extension_local',
    pipelineVersion: COMMUNITY_ANALYSIS_PIPELINE_VERSION,
    validationPolicyVersion: ANALYSIS_VALIDATION_POLICY_VERSION,
    requestId: input.requestId,
    provider: input.provider,
    model: input.model,
    occurredAt: new Date(input.finishedAt).toISOString(),
    durationMs: Math.max(0, Math.round(input.finishedAt - input.startedAt)),
    warnings: Object.freeze([...input.warnings]),
  });
}
