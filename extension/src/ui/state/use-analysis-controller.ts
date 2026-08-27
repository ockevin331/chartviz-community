import { useCallback, useRef, useState } from 'react';
import type { CommunityPromptInput } from '../../analysis/community-prompt';
import { runThreeStageAnalysis, type AnalysisPipelineProgress, type ThreeStageAnalysisInput } from '../../analysis/stages/analysis-pipeline';
import type { CommunityReportV3 } from '../../analysis/stages/community-report-v3';
import { buildAnnotations as buildReportAnnotations } from '../../annotations/build-annotations';
import type { AnnotatedReportImages } from '../../annotations/annotation-types';
import type { ProcessedImage } from '../../capture/image-types';
import { providerRegistry } from '../../providers/provider-registry';
import { attachProviderFailureDetail, createAnalysisDiagnostic, type AnalysisDiagnostic } from '../../providers/provider-diagnostics';
import { ProviderError, type AnalysisErrorCode } from '../../providers/provider-errors';
import type { ProviderConfig, ProviderKind, StructuredVisionProvider, VisionProvider } from '../../providers/provider-types';

export type ProgressMessage = 'reading_chart' | 'organizing_evidence' | 'preparing_result';
export type AnalysisStatus = 'setup' | 'source' | 'preview' | 'analyzing' | 'completed' | 'failed' | 'cancelled';

export type AnalysisState = {
  status: AnalysisStatus;
  image: ProcessedImage | null;
  report: CommunityReportV3 | null;
  annotations: AnnotatedReportImages | null;
  progress: ProgressMessage[];
  errorCode: AnalysisErrorCode | 'unknown' | null;
  diagnostic: AnalysisDiagnostic | null;
};

export type AnalysisControllerDependencies = {
  getProvider(kind: ProviderKind): VisionProvider | StructuredVisionProvider;
  runAnalysis(input: ThreeStageAnalysisInput): Promise<CommunityReportV3>;
  buildAnnotations(image: ProcessedImage, report: CommunityReportV3): Promise<AnnotatedReportImages>;
};

const defaultDependencies: AnalysisControllerDependencies = {
  getProvider: (kind) => providerRegistry.get(kind),
  runAnalysis: runThreeStageAnalysis,
  buildAnnotations: (image, report) => buildReportAnnotations(image, report),
};

const initialState: AnalysisState = { status: 'setup', image: null, report: null, annotations: null, progress: [], errorCode: null, diagnostic: null };

function publicErrorCode(error: unknown): AnalysisErrorCode | 'unknown' {
  return error instanceof ProviderError ? error.code : 'unknown';
}

function createRequestId(): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  return typeof randomUuid === 'function'
    ? randomUuid.call(globalThis.crypto)
    : `cv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isStructuredProvider(
  provider: VisionProvider | StructuredVisionProvider,
): provider is StructuredVisionProvider {
  return typeof provider.generateStructured === 'function';
}

export function useAnalysisController(dependencies: Partial<AnalysisControllerDependencies> = {}) {
  const dependenciesRef = useRef<AnalysisControllerDependencies>({ ...defaultDependencies, ...dependencies });
  dependenciesRef.current = { ...defaultDependencies, ...dependencies };
  const configRef = useRef<ProviderConfig | null>(null);
  const imageRef = useRef<ProcessedImage | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const [state, setState] = useState<AnalysisState>(initialState);

  const invalidateOperation = useCallback(() => {
    generationRef.current += 1;
    const request = requestRef.current;
    requestRef.current = null;
    request?.abort(new DOMException('Cancelled', 'AbortError'));
  }, []);

  const configure = useCallback((config: ProviderConfig) => {
    invalidateOperation();
    configRef.current = config;
    imageRef.current = null;
    setState({ ...initialState, status: 'source' });
  }, [invalidateOperation]);

  const updateConfig = useCallback((config: ProviderConfig) => {
    configRef.current = config;
  }, []);

  const selectImage = useCallback((image: ProcessedImage) => {
    invalidateOperation();
    imageRef.current = image;
    setState({ ...initialState, status: 'preview', image });
  }, [invalidateOperation]);

  const chooseAnotherImage = useCallback(() => {
    invalidateOperation();
    imageRef.current = null;
    setState({ ...initialState, status: 'source' });
  }, [invalidateOperation]);

  const refresh = useCallback(() => {
    invalidateOperation();
    imageRef.current = null;
    setState({ ...initialState, status: configRef.current ? 'source' : 'setup' });
  }, [invalidateOperation]);

  const analyze = useCallback(async (pageContext: CommunityPromptInput['pageContext'], language: CommunityPromptInput['language']) => {
    const config = configRef.current;
    const image = imageRef.current;
    if (!config || !image || requestRef.current) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const controller = new AbortController();
    const startedAt = Date.now();
    const requestId = createRequestId();
    let currentProgress: ProgressMessage[] = ['reading_chart'];
    requestRef.current = controller;
    const isCurrent = () => generationRef.current === generation;
    setState({ status: 'analyzing', image, report: null, annotations: null, progress: ['reading_chart'], errorCode: null, diagnostic: null });
    try {
      const deps = dependenciesRef.current;
      const provider = deps.getProvider(config.provider);
      if (!isStructuredProvider(provider)) {
        throw new ProviderError('invalid_config', { params: { provider: config.provider } });
      }
      const report = await deps.runAnalysis({
        config,
        provider,
        image: { mediaType: image.mediaType, dataUrl: image.dataUrl },
        context: { ...pageContext, site: null, exchange: null },
        outputLanguage: language,
        signal: controller.signal,
        onProgress: (message: AnalysisPipelineProgress) => {
          if (!isCurrent() || currentProgress.includes(message)) return;
          currentProgress = [...currentProgress, message];
          setState((current) => ({ ...current, progress: currentProgress }));
        },
      });
      if (!isCurrent()) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!isCurrent()) return;
      if (!currentProgress.includes('organizing_evidence')) {
        currentProgress = [...currentProgress, 'organizing_evidence'];
        setState((current) => ({ ...current, progress: currentProgress }));
      }
      let annotations: AnnotatedReportImages;
      try {
        annotations = await deps.buildAnnotations(image, report);
      } catch {
        const annotationError = attachProviderFailureDetail(
          new ProviderError('invalid_image', { params: { provider: config.provider } }),
          { stage: 'annotation_rendering', issues: [] },
        );
        if (isCurrent()) setState({
          status: 'failed', image, report: null, annotations: null, progress: currentProgress, errorCode: 'invalid_image',
          diagnostic: createAnalysisDiagnostic({ error: annotationError, provider: config.provider, model: config.model, requestId, startedAt, finishedAt: Date.now() }),
        });
        return;
      }
      if (!isCurrent()) return;
      if (!currentProgress.includes('preparing_result')) {
        currentProgress = [...currentProgress, 'preparing_result'];
        setState((current) => ({ ...current, progress: currentProgress }));
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!isCurrent()) return;
      setState({ status: 'completed', image, report, annotations, progress: currentProgress, errorCode: null, diagnostic: null });
    } catch (error) {
      if (!isCurrent()) return;
      const errorCode = publicErrorCode(error);
      if (errorCode === 'cancelled') setState({ status: 'cancelled', image, report: null, annotations: null, progress: currentProgress, errorCode: null, diagnostic: null });
      else setState({
        status: 'failed', image, report: null, annotations: null, progress: currentProgress, errorCode,
        diagnostic: error instanceof ProviderError
          ? createAnalysisDiagnostic({ error, provider: config.provider, model: config.model, requestId, startedAt, finishedAt: Date.now() })
          : null,
      });
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    const controller = requestRef.current;
    if (!controller) return;
    generationRef.current += 1;
    requestRef.current = null;
    controller.abort(new DOMException('Cancelled', 'AbortError'));
    setState((current) => ({ ...current, status: 'cancelled', errorCode: null }));
  }, []);

  const returnToPreview = useCallback(() => {
    const image = imageRef.current;
    invalidateOperation();
    if (image) setState({ ...initialState, status: 'preview', image });
  }, [invalidateOperation]);

  return { state, configure, updateConfig, selectImage, chooseAnotherImage, refresh, analyze, cancel, returnToPreview };
}
