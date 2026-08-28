import type { PresentationAnnotatedImages } from '../../annotations/annotation-types';
import type { ProcessedImage } from '../../capture/image-types';
import type { AnalysisDiagnostic } from '../../providers/provider-diagnostics';
import type { AnalysisErrorCode } from '../../providers/provider-errors';
import type { ReportPresentationModel } from '../../presentation/report-presentation-model';
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
  captures: readonly AnalysisCapture[];
  presentation: ReportPresentationModel;
  annotations: PresentationAnnotatedImages;
}>;

export type RestoredActiveAnalysis = Readonly<{
  captures: readonly AnalysisCapture[];
  outputLanguage: OutputLanguage;
}>;

export type AnalysisRuntimeErrorCode = AnalysisErrorCode
  | 'multi_timeframe_requires_cloud'
  | 'authentication_required'
  | 'invalid_token'
  | 'token_revoked'
  | 'token_expired'
  | 'insufficient_scope'
  | 'free_trial_exhausted'
  | 'subscription_required'
  | 'subscription_expired'
  | 'quota_exhausted'
  | 'multi_timeframe_requires_advance'
  | 'invalid_chart_image'
  | 'unsupported_timeframe'
  | 'task_not_found'
  | 'task_failed'
  | 'incompatible_api_version'
  | 'incompatible_report_schema'
  | 'service_unavailable';

export type AnalysisRuntimeErrorParams = Readonly<Record<
  string,
  string | number | boolean | null
>>;

export class AnalysisRuntimeFailure extends Error {
  readonly code: AnalysisRuntimeErrorCode | 'unknown';
  readonly diagnostic: AnalysisDiagnostic | null;
  readonly params: AnalysisRuntimeErrorParams;
  readonly pricingUrl: string | null;

  constructor(
    code: AnalysisRuntimeErrorCode | 'unknown',
    diagnostic: AnalysisDiagnostic | null = null,
    options: Readonly<{
      params?: AnalysisRuntimeErrorParams;
      pricingUrl?: string | null;
    }> = {},
  ) {
    super(code);
    this.name = 'AnalysisRuntimeFailure';
    this.code = code;
    this.diagnostic = diagnostic;
    this.params = Object.freeze({ ...(options.params ?? {}) });
    this.pricingUrl = options.pricingUrl ?? null;
  }
}

export interface AnalysisRuntime {
  readonly mode: AnalysisMode;
  capabilities(): AnalysisCapabilities;
  analyze(input: AnalysisRuntimeInput): Promise<AnalysisRuntimeOutcome>;
  cancel(): void;
  detach?(): void;
  restoreActiveAnalysis?(): Promise<RestoredActiveAnalysis | null>;
}
