import type { AnnotatedReportImages } from '../../annotations/annotation-types';
import type { ProcessedImage } from '../../capture/image-types';
import type { AnalysisDiagnostic } from '../../providers/provider-diagnostics';
import type { AnalysisErrorCode } from '../../providers/provider-errors';
import type { CommunityReportV3 } from '../stages/community-report-v3';
import type { OutputLanguage, StagePageContext } from '../stages/shared-stage-types';
import type { AnalysisMode } from '../analysis-mode';

export type ProgressMessage =
  | 'preparing'
  | 'reading_chart'
  | 'reviewing_clues'
  | 'checking_signals'
  | 'preparing_result';

export type AnalysisCapabilities = Readonly<{
  multiTimeframe: boolean;
  maxTimeframes: 1 | 2 | 3;
}>;

export type AnalysisCapture = Readonly<{
  image: ProcessedImage;
  context: Pick<StagePageContext, 'instrument' | 'timeframe'>
    & Partial<Pick<StagePageContext, 'site' | 'exchange'>>
    & Readonly<{
      pageType?: 'advanced-chart' | 'spot-trade' | 'futures-trade'
        | 'stock-trade' | 'web3-token' | null;
    }>;
}>;

export type AnalysisRuntimeInput = Readonly<{
  captures: readonly AnalysisCapture[];
  outputLanguage: OutputLanguage;
  onProgress?(message: ProgressMessage): void;
}>;

export type AnalysisRuntimeOutcome = Readonly<{
  report: CommunityReportV3;
  annotations: AnnotatedReportImages;
}>;

export type AnalysisRuntimeErrorCode = AnalysisErrorCode
  | 'multi_timeframe_requires_cloud';

export class AnalysisRuntimeFailure extends Error {
  readonly code: AnalysisRuntimeErrorCode | 'unknown';
  readonly diagnostic: AnalysisDiagnostic | null;

  constructor(
    code: AnalysisRuntimeErrorCode | 'unknown',
    diagnostic: AnalysisDiagnostic | null = null,
  ) {
    super(code);
    this.name = 'AnalysisRuntimeFailure';
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

export interface AnalysisRuntime {
  readonly mode: AnalysisMode;
  capabilities(): AnalysisCapabilities;
  analyze(input: AnalysisRuntimeInput): Promise<AnalysisRuntimeOutcome>;
  cancel(): void;
}
