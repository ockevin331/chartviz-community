export const semanticDiagnosticCodes = [
  'output_language_mismatch',
  'internal_evidence_id_exposed',
  'unknown_level_id',
  'unknown_indicator_id',
  'unknown_pattern_id',
  'signal_set_mismatch',
  'too_many_levels',
  'price_scale_not_monotonic',
  'multiple_timeframes',
  'external_source_claim',
  'duplicate_id',
  'invalid_price_panel_bounds',
  'unclassified_semantic_error',
] as const;

export type SemanticDiagnosticCode = typeof semanticDiagnosticCodes[number];

const semanticDiagnosticCodeSet = new Set<string>(semanticDiagnosticCodes);

export function isSemanticDiagnosticCode(value: string): value is SemanticDiagnosticCode {
  return semanticDiagnosticCodeSet.has(value);
}

export const COMMUNITY_ANALYSIS_PIPELINE_VERSION = 'community-3.0' as const;
