import {
  buildPresentationAnnotations,
  type PresentationSourceCapture,
} from '../../annotations/build-presentation-annotations';
import type { PresentationAnnotatedImages } from '../../annotations/annotation-types';
import {
  attachProviderFailureDetail,
  createAnalysisDiagnostic,
  type AnalysisDiagnostic,
} from '../../providers/provider-diagnostics';
import { ProviderError } from '../../providers/provider-errors';
import { providerRegistry } from '../../providers/provider-registry';
import type {
  ProviderConfig,
  ProviderKind,
  StructuredVisionProvider,
} from '../../providers/provider-types';
import { saveLastAnalysisFailure } from '../../storage/analysis-failure-storage';
import { adaptDirectPresentation } from '../../presentation/direct-presentation-adapter';
import type { PresentationBundle, PresentationDrawing } from '../../presentation/report-presentation-model';
import {
  runThreeStageAnalysis,
  type ThreeStageAnalysisInput,
} from '../stages/analysis-pipeline';
import {
  AnalysisRuntimeFailure,
  type AnalysisRuntime,
  type AnalysisRuntimeInput,
  type AnalysisRuntimeOutcome,
} from './analysis-runtime';

export type DirectAnalysisRuntimeDependencies = Readonly<{
  getProvider(kind: ProviderKind): StructuredVisionProvider;
  runAnalysis(input: ThreeStageAnalysisInput): ReturnType<typeof runThreeStageAnalysis>;
  adaptPresentation(
    report: Awaited<ReturnType<typeof runThreeStageAnalysis>>,
    capture: AnalysisRuntimeInput['captures'][number],
    outputLanguage: AnalysisRuntimeInput['outputLanguage'],
  ): PresentationBundle;
  buildAnnotations(
    captures: readonly PresentationSourceCapture[],
    drawings: readonly PresentationDrawing[],
  ): Promise<PresentationAnnotatedImages>;
  createRequestId(): string;
  now(): number;
  saveFailureDiagnostic(diagnostic: AnalysisDiagnostic): Promise<void>;
}>;

function createRequestId(): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  return typeof randomUuid === 'function'
    ? randomUuid.call(globalThis.crypto)
    : `cv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const defaultDependencies: DirectAnalysisRuntimeDependencies = {
  getProvider: (kind) => providerRegistry.get(kind),
  runAnalysis: runThreeStageAnalysis,
  adaptPresentation: adaptDirectPresentation,
  buildAnnotations: buildPresentationAnnotations,
  createRequestId,
  now: () => Date.now(),
  saveFailureDiagnostic: saveLastAnalysisFailure,
};

const directCapabilities = Object.freeze({
  multiTimeframe: false,
  maxTimeframes: 1,
} as const);

export class DirectAnalysisRuntime implements AnalysisRuntime {
  readonly mode = 'direct' as const;
  private readonly config: ProviderConfig;
  private readonly dependencies: DirectAnalysisRuntimeDependencies;
  private activeController: AbortController | null = null;

  constructor(
    config: ProviderConfig,
    dependencies: Partial<DirectAnalysisRuntimeDependencies> = {},
  ) {
    this.config = config;
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  capabilities(): typeof directCapabilities {
    return directCapabilities;
  }

  async analyze(input: AnalysisRuntimeInput): Promise<AnalysisRuntimeOutcome> {
    if (input.captures.length !== 1) {
      throw new AnalysisRuntimeFailure('multi_timeframe_requires_cloud');
    }

    const capture = input.captures[0]!;
    const controller = new AbortController();
    const startedAt = this.dependencies.now();
    const requestId = this.dependencies.createRequestId();
    this.activeController = controller;

    try {
      const provider = this.dependencies.getProvider(this.config.provider);
      const report = await this.dependencies.runAnalysis({
        config: this.config,
        provider,
        image: {
          mediaType: capture.image.mediaType,
          dataUrl: capture.image.dataUrl,
        },
        context: {
          ...capture.context,
          site: null,
          exchange: null,
        },
        outputLanguage: input.outputLanguage,
        signal: controller.signal,
        onProgress: input.onProgress,
      });

      let presentation: PresentationBundle;
      try {
        presentation = this.dependencies.adaptPresentation(report, capture, input.outputLanguage);
      } catch (error) {
        throw attachProviderFailureDetail(
          new ProviderError('invalid_response', {
            params: { provider: this.config.provider },
          }),
          {
            stage: 'report_shape',
            issues: [],
            exception: error instanceof Error
              ? { name: error.name, message: error.message }
              : undefined,
          },
        );
      }
      let annotations: PresentationAnnotatedImages;
      try {
        annotations = await this.dependencies.buildAnnotations(
          [{ captureId: 'C01', image: capture.image }],
          presentation.drawings,
        );
      } catch {
        throw attachProviderFailureDetail(
          new ProviderError('invalid_image', {
            params: { provider: this.config.provider },
          }),
          { stage: 'annotation_rendering', issues: [] },
        );
      }
      return { presentation: presentation.report, annotations };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AnalysisRuntimeFailure('cancelled');
      }
      if (error instanceof ProviderError) {
        if (error.code === 'cancelled') {
          throw new AnalysisRuntimeFailure('cancelled');
        }
        const diagnostic = createAnalysisDiagnostic({
            error,
            provider: this.config.provider,
            model: this.config.model,
            requestId,
            startedAt,
            finishedAt: this.dependencies.now(),
          });
        try {
          await this.dependencies.saveFailureDiagnostic(diagnostic);
        } catch {
          // The in-memory diagnostic must remain available even when local storage is unavailable.
        }
        throw new AnalysisRuntimeFailure(error.code, diagnostic);
      }
      throw new AnalysisRuntimeFailure('unknown');
    } finally {
      if (this.activeController === controller) this.activeController = null;
    }
  }

  cancel(): void {
    this.activeController?.abort(new DOMException('Cancelled', 'AbortError'));
  }
}
