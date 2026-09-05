import type { CommunityEvidenceBundle } from './evidence-bundle';
import type { CommunityReportV3 } from './community-report-v3';
import { finalizeCommunityReportV3 } from './report-integrity-v3';
import { collectReportQualityWarnings } from './report-quality-warnings';
import type { AnalysisWarning, OutputLanguage } from './shared-stage-types';

export type CommunityReportValidationResult = Readonly<{
  report: CommunityReportV3;
  warnings: readonly AnalysisWarning[];
}>;

export function validateCommunityReportV3Semantics(
  value: unknown,
  evidence: CommunityEvidenceBundle,
  outputLanguage: OutputLanguage,
): CommunityReportValidationResult {
  const report = finalizeCommunityReportV3(value, evidence, outputLanguage);
  const warnings = collectReportQualityWarnings({
    stage: 'evidence_reasoning',
    value: report,
    declaredTimeframe: evidence.visualFacts.chart.timeframe,
    outputLanguage,
  });
  return { report, warnings };
}
