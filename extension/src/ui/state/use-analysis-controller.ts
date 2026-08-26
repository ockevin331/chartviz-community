import { useCallback, useRef, useState } from 'react';
import { communityJsonSchema } from '../../analysis/community-json-schema';
import { buildCommunityPrompt, type CommunityPromptInput, type ProviderPrompt } from '../../analysis/community-prompt';
import { parseCommunityReport, type CommunityReport } from '../../analysis/community-report';
import { buildAnnotations as buildReportAnnotations } from '../../annotations/build-annotations';
import type { AnnotatedReportImages } from '../../annotations/annotation-types';
import type { ProcessedImage } from '../../capture/image-types';
import { providerRegistry } from '../../providers/provider-registry';
import type { ProviderConfig, ProviderKind, VisionProvider } from '../../providers/provider-types';

export type ProgressMessage = 'reading_chart' | 'organizing_evidence' | 'preparing_result';
export type AnalysisStatus = 'setup' | 'source' | 'preview' | 'analyzing' | 'completed' | 'failed' | 'cancelled';

export type AnalysisState = {
  status: AnalysisStatus;
  image: ProcessedImage | null;
  report: CommunityReport | null;
  annotations: AnnotatedReportImages | null;
  progress: ProgressMessage[];
  error: unknown;
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

const initialState: AnalysisState = { status: 'setup', image: null, report: null, annotations: null, progress: [], error: null };

export function useAnalysisController(dependencies: AnalysisControllerDependencies = defaultDependencies) {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const configRef = useRef<ProviderConfig | null>(null);
  const imageRef = useRef<ProcessedImage | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<AnalysisState>(initialState);

  const configure = useCallback((config: ProviderConfig) => {
    configRef.current = config;
    setState({ ...initialState, status: 'source' });
  }, []);

  const selectImage = useCallback((image: ProcessedImage) => {
    imageRef.current = image;
    setState({ ...initialState, status: 'preview', image });
  }, []);

  const chooseAnotherImage = useCallback(() => {
    imageRef.current = null;
    setState({ ...initialState, status: 'source' });
  }, []);

  const analyze = useCallback(async (pageContext: CommunityPromptInput['pageContext'], language: CommunityPromptInput['language']) => {
    const config = configRef.current;
    const image = imageRef.current;
    if (!config || !image || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setState({ status: 'analyzing', image, report: null, annotations: null, progress: ['reading_chart'], error: null });
    try {
      const deps = dependenciesRef.current;
      const provider = deps.getProvider(config.provider);
      const rawReport = await provider.analyze(config, {
        image: { mediaType: image.mediaType, dataUrl: image.dataUrl },
        prompt: deps.buildPrompt({ language, pageContext }),
        jsonSchema: communityJsonSchema,
        signal: controller.signal,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (controller.signal.aborted) throw controller.signal.reason;
      const report = deps.validateReport(rawReport);
      setState((current) => ({ ...current, progress: ['reading_chart', 'organizing_evidence'] }));
      const annotations = await deps.buildAnnotations(image, report);
      if (controller.signal.aborted) throw controller.signal.reason;
      setState((current) => ({ ...current, progress: ['reading_chart', 'organizing_evidence', 'preparing_result'] }));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      setState({ status: 'completed', image, report, annotations, progress: ['reading_chart', 'organizing_evidence', 'preparing_result'], error: null });
    } catch (error) {
      if (controller.signal.aborted) {
        setState({ status: 'cancelled', image, report: null, annotations: null, progress: ['reading_chart'], error: null });
      } else {
        setState({ status: 'failed', image, report: null, annotations: null, progress: ['reading_chart'], error });
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    const controller = requestRef.current;
    if (!controller) return;
    controller.abort(new DOMException('Cancelled', 'AbortError'));
    setState((current) => ({ ...current, status: 'cancelled', error: null }));
  }, []);

  const returnToPreview = useCallback(() => {
    const image = imageRef.current;
    if (image) setState({ ...initialState, status: 'preview', image });
  }, []);

  return { state, configure, selectImage, chooseAnotherImage, analyze, cancel, returnToPreview };
}
