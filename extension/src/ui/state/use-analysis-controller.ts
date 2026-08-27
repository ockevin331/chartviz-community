import { useCallback, useRef, useState } from 'react';
import {
  AnalysisRuntimeFailure,
  type AnalysisCapture,
  type AnalysisRuntime,
  type AnalysisRuntimeErrorCode,
  type ProgressMessage,
} from '../../analysis/runtime/analysis-runtime';
import type { CommunityReportV3 } from '../../analysis/stages/community-report-v3';
import type { OutputLanguage } from '../../analysis/stages/shared-stage-types';
import type { AnnotatedReportImages } from '../../annotations/annotation-types';
import type { ProcessedImage } from '../../capture/image-types';
import type { AnalysisDiagnostic } from '../../providers/provider-diagnostics';

export type { ProgressMessage } from '../../analysis/runtime/analysis-runtime';

export type AnalysisState = {
  status: 'setup' | 'source' | 'preview' | 'analyzing' | 'completed' | 'failed' | 'cancelled';
  image: ProcessedImage | null;
  report: CommunityReportV3 | null;
  annotations: AnnotatedReportImages | null;
  errorCode: AnalysisRuntimeErrorCode | 'unknown' | null;
  diagnostic: AnalysisDiagnostic | null;
  progress: ProgressMessage[];
};

const INITIAL_STATE: AnalysisState = {
  status: 'setup',
  image: null,
  report: null,
  annotations: null,
  errorCode: null,
  diagnostic: null,
  progress: [],
};

const REQUIRED_COMPLETION_PROGRESS: ProgressMessage[] = [
  'organizing_evidence',
  'preparing_result',
];

export function useAnalysisController() {
  const [state, setState] = useState<AnalysisState>(INITIAL_STATE);
  const runtimeRef = useRef<AnalysisRuntime | null>(null);
  const activeRuntimeRef = useRef<AnalysisRuntime | null>(null);
  const imageRef = useRef<ProcessedImage | null>(null);
  const generationRef = useRef(0);

  const invalidateOperation = useCallback(() => {
    generationRef.current += 1;
    const activeRuntime = activeRuntimeRef.current;
    activeRuntimeRef.current = null;
    activeRuntime?.cancel();
    return activeRuntime;
  }, []);

  const configure = useCallback((runtime: AnalysisRuntime) => {
    const previousRuntime = runtimeRef.current;
    const activeRuntime = invalidateOperation();
    if (previousRuntime && previousRuntime !== activeRuntime) {
      previousRuntime.cancel();
    }
    runtimeRef.current = runtime;
    imageRef.current = null;
    setState({ ...INITIAL_STATE, status: 'source' });
  }, [invalidateOperation]);

  const updateRuntime = useCallback((runtime: AnalysisRuntime) => {
    runtimeRef.current = runtime;
  }, []);

  const selectImage = useCallback((image: ProcessedImage) => {
    invalidateOperation();
    imageRef.current = image;
    setState({
      ...INITIAL_STATE,
      status: 'preview',
      image,
    });
  }, [invalidateOperation]);

  const chooseAnotherImage = useCallback(() => {
    invalidateOperation();
    imageRef.current = null;
    setState({
      ...INITIAL_STATE,
      status: runtimeRef.current ? 'source' : 'setup',
    });
  }, [invalidateOperation]);

  const refresh = useCallback(() => {
    invalidateOperation();
    imageRef.current = null;
    setState({
      ...INITIAL_STATE,
      status: runtimeRef.current ? 'source' : 'setup',
    });
  }, [invalidateOperation]);

  const analyze = useCallback(async (
    pageContext: AnalysisCapture['context'],
    outputLanguage: OutputLanguage,
  ) => {
    const runtime = runtimeRef.current;
    const image = imageRef.current;
    if (!runtime || !image || activeRuntimeRef.current) return;

    const operationGeneration = generationRef.current + 1;
    generationRef.current = operationGeneration;
    activeRuntimeRef.current = runtime;
    let currentProgress: ProgressMessage[] = ['reading_chart'];

    setState((current) => ({
      ...current,
      status: 'analyzing',
      report: null,
      annotations: null,
      errorCode: null,
      diagnostic: null,
      progress: currentProgress,
    }));

    try {
      const outcome = await runtime.analyze({
        captures: [{ image, context: pageContext }],
        outputLanguage,
        onProgress(message) {
          if (generationRef.current !== operationGeneration) return;
          if (currentProgress.includes(message)) return;
          currentProgress = [...currentProgress, message];
          setState((current) => ({ ...current, progress: currentProgress }));
        },
      });

      if (generationRef.current !== operationGeneration) return;
      for (const message of REQUIRED_COMPLETION_PROGRESS) {
        if (!currentProgress.includes(message)) currentProgress.push(message);
      }
      setState({
        status: 'completed',
        image,
        report: outcome.report,
        annotations: outcome.annotations,
        errorCode: null,
        diagnostic: null,
        progress: [...currentProgress],
      });
    } catch (error) {
      if (generationRef.current !== operationGeneration) return;
      if (error instanceof AnalysisRuntimeFailure) {
        if (error.code === 'cancelled') {
          setState((current) => ({
            ...current,
            status: 'cancelled',
            report: null,
            annotations: null,
            errorCode: null,
            diagnostic: null,
          }));
          return;
        }
        setState((current) => ({
          ...current,
          status: 'failed',
          report: null,
          annotations: null,
          errorCode: error.code,
          diagnostic: error.diagnostic,
        }));
        return;
      }
      setState((current) => ({
        ...current,
        status: 'failed',
        report: null,
        annotations: null,
        errorCode: 'unknown',
        diagnostic: null,
      }));
    } finally {
      if (activeRuntimeRef.current === runtime) {
        activeRuntimeRef.current = null;
      }
    }
  }, []);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    const activeRuntime = activeRuntimeRef.current;
    activeRuntimeRef.current = null;
    activeRuntime?.cancel();
    setState((current) => ({
      ...current,
      status: 'cancelled',
      report: null,
      annotations: null,
      errorCode: null,
      diagnostic: null,
    }));
  }, []);

  const returnToPreview = useCallback(() => {
    invalidateOperation();
    setState((current) => ({
      ...current,
      status: current.image ? 'preview' : runtimeRef.current ? 'source' : 'setup',
      report: null,
      annotations: null,
      errorCode: null,
      diagnostic: null,
      progress: [],
    }));
  }, [invalidateOperation]);

  return {
    state,
    configure,
    updateRuntime,
    selectImage,
    chooseAnotherImage,
    refresh,
    analyze,
    cancel,
    returnToPreview,
  };
}
