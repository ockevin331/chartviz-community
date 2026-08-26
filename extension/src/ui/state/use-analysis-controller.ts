import { useCallback, useRef, useState } from 'react';
import { communityJsonSchema } from '../../analysis/community-json-schema';
import { buildCommunityPrompt, type CommunityPromptInput, type ProviderPrompt } from '../../analysis/community-prompt';
import { parseCommunityReport, type CommunityReport } from '../../analysis/community-report';
import { buildAnnotations as buildReportAnnotations } from '../../annotations/build-annotations';
import type { AnnotatedReportImages } from '../../annotations/annotation-types';
import type { ProcessedImage } from '../../capture/image-types';
import { providerRegistry } from '../../providers/provider-registry';
import { ProviderError, type AnalysisErrorCode } from '../../providers/provider-errors';
import type { ProviderConfig, ProviderKind, VisionProvider } from '../../providers/provider-types';

export type ProgressMessage = 'reading_chart' | 'organizing_evidence' | 'preparing_result';
export type AnalysisStatus = 'setup' | 'source' | 'preview' | 'analyzing' | 'completed' | 'failed' | 'cancelled';

export type AnalysisState = {
  status: AnalysisStatus;
  image: ProcessedImage | null;
  report: CommunityReport | null;
  annotations: AnnotatedReportImages | null;
  progress: ProgressMessage[];
  errorCode: AnalysisErrorCode | 'unknown' | null;
};

export type AnalysisControllerDependencies = {
  getProvider(kind: ProviderKind): VisionProvider;
  buildPrompt(input: CommunityPromptInput): ProviderPrompt;
  validateReport(value: unknown): CommunityReport;
  buildAnnotations(image: ProcessedImage, report: CommunityReport): Promise<AnnotatedReportImages>;
};

const defaultDependencies: AnalysisControllerDependencies = {
  getProvider: (kind) => providerRegistry.get(kind),
  buildPrompt: buildCommunityPrompt,
  validateReport: parseCommunityReport,
  buildAnnotations: (image, report) => buildReportAnnotations(image, report),
};

const initialState: AnalysisState = { status: 'setup', image: null, report: null, annotations: null, progress: [], errorCode: null };

function publicErrorCode(error: unknown): AnalysisErrorCode | 'unknown' {
  return error instanceof ProviderError ? error.code : 'unknown';
}

export function useAnalysisController(dependencies: AnalysisControllerDependencies = defaultDependencies) {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
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

  const analyze = useCallback(async (pageContext: CommunityPromptInput['pageContext'], language: CommunityPromptInput['language']) => {
    const config = configRef.current;
    const image = imageRef.current;
    if (!config || !image || requestRef.current) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const controller = new AbortController();
    requestRef.current = controller;
    const isCurrent = () => generationRef.current === generation;
    setState({ status: 'analyzing', image, report: null, annotations: null, progress: ['reading_chart'], errorCode: null });
    try {
      const deps = dependenciesRef.current;
      const provider = deps.getProvider(config.provider);
      const rawReport = await provider.analyze(config, {
        image: { mediaType: image.mediaType, dataUrl: image.dataUrl },
        prompt: deps.buildPrompt({ language, pageContext }),
        jsonSchema: communityJsonSchema,
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!isCurrent()) return;
      let report: CommunityReport;
      try {
        report = deps.validateReport(rawReport);
      } catch {
        if (isCurrent()) setState({ status: 'failed', image, report: null, annotations: null, progress: ['reading_chart'], errorCode: 'invalid_response' });
        return;
      }
      if (!isCurrent()) return;
      setState((current) => ({ ...current, progress: ['reading_chart', 'organizing_evidence'] }));
      let annotations: AnnotatedReportImages;
      try {
        annotations = await deps.buildAnnotations(image, report);
      } catch {
        if (isCurrent()) setState({ status: 'failed', image, report: null, annotations: null, progress: ['reading_chart', 'organizing_evidence'], errorCode: 'invalid_image' });
        return;
      }
      if (!isCurrent()) return;
      setState((current) => ({ ...current, progress: ['reading_chart', 'organizing_evidence', 'preparing_result'] }));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!isCurrent()) return;
      setState({ status: 'completed', image, report, annotations, progress: ['reading_chart', 'organizing_evidence', 'preparing_result'], errorCode: null });
    } catch (error) {
      if (!isCurrent()) return;
      const errorCode = publicErrorCode(error);
      if (errorCode === 'cancelled') setState({ status: 'cancelled', image, report: null, annotations: null, progress: ['reading_chart'], errorCode: null });
      else setState({ status: 'failed', image, report: null, annotations: null, progress: ['reading_chart'], errorCode });
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

  return { state, configure, selectImage, chooseAnotherImage, analyze, cancel, returnToPreview };
}
