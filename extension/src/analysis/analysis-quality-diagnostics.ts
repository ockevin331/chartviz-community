export const ANALYSIS_VALIDATION_POLICY_VERSION = 'deterministic-1.0' as const;

export const analysisWarningCodes = [
  'possible_timeframe_reference',
  'output_language_mismatch',
  'internal_id_exposed',
  'unexpected_source_claim',
] as const;

export type AnalysisWarningCode = typeof analysisWarningCodes[number];

const analysisWarningCodeSet = new Set<string>(analysisWarningCodes);

export function isAnalysisWarningCode(value: string): value is AnalysisWarningCode {
  return analysisWarningCodeSet.has(value);
}
