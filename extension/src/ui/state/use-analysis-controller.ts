import { useCallback, useRef, useState } from 'react';
import {
  AnalysisRuntimeFailure,
  type AnalysisCapture,
  type AnalysisRuntime,
  type AnalysisRuntimeErrorCode,
  type AnalysisRuntimeErrorParams,
  type ProgressMessage,
} from '../../analysis/runtime/analysis-runtime';
import type { OutputLanguage } from '../../analysis/stages/shared-stage-types';
import type { PresentationAnnotatedImages } from '../../annotations/annotation-types';
import type { ProcessedImage } from '../../capture/image-types';
import type { ReportPresentationModel } from '../../presentation/report-presentation-model';
import type { AnalysisDiagnostic } from '../../providers/provider-diagnostics';

export type { ProgressMessage } from '../../analysis/runtime/analysis-runtime';

export type AnalysisState = {
  status: 'setup' | 'source' | 'preview' | 'analyzing' | 'completed' | 'failed' | 'cancelled';
  image: ProcessedImage | null;
  captures: readonly AnalysisCapture[];
  presentation: ReportPresentationModel | null;
  annotations: PresentationAnnotatedImages | null;
  errorCode: AnalysisRuntimeErrorCode | 'unknown' | null;
  diagnostic: AnalysisDiagnostic | null;
  errorParams: AnalysisRuntimeErrorParams;
  pricingUrl: string | null;
  progress: ProgressMessage[];
};

const INITIAL_STATE: AnalysisState = {
  status: 'setup',
  image: null,
  captures: [],
  presentation: null,
  annotations: null,
  errorCode: null,
  diagnostic: null,
  errorParams: {},
  pricingUrl: null,
  progress: [],
};

const REQUIRED_COMPLETION_PROGRESS: ProgressMessage[] = [
  'preparing',
  'reading_chart',
  'reviewing_clues',
  'checking_signals',
  'preparing_result',
];

export function useAnalysisController() {
  const [state, setState] = useState<AnalysisState>(INITIAL_STATE);
  const runtimeRef = useRef<AnalysisRuntime | null>(null);
  const activeRuntimeRef = useRef<AnalysisRuntime | null>(null);
  const imageRef = useRef<ProcessedImage | null>(null);
  const capturesRef = useRef<readonly AnalysisCapture[]>([]);
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
    capturesRef.current = [];
    setState({ ...INITIAL_STATE, status: 'source' });
  }, [invalidateOperation]);

  const updateRuntime = useCallback((runtime: AnalysisRuntime) => {
    runtimeRef.current = runtime;
  }, []);

  const unconfigure = useCallback(() => {
    const previousRuntime = runtimeRef.current;
    const activeRuntime = invalidateOperation();
    if (previousRuntime && previousRuntime !== activeRuntime) previousRuntime.cancel();
    runtimeRef.current = null;
    imageRef.current = null;
    capturesRef.current = [];
    setState(INITIAL_STATE);
  }, [invalidateOperation]);

  const selectImage = useCallback((image: ProcessedImage) => {
    invalidateOperation();
    imageRef.current = image;
    capturesRef.current = [];
    setState({
      ...INITIAL_STATE,
      status: 'preview',
      image,
    });
  }, [invalidateOperation]);

  const selectCaptures = useCallback((captures: readonly AnalysisCapture[]) => {
    if (captures.length < 1 || captures.length > 3) {
      throw new RangeError('Analysis requires between one and three captures.');
    }
    invalidateOperation();
    const stored = [...captures];
    capturesRef.current = stored;
    imageRef.current = stored[0]!.image;
    setState({
      ...INITIAL_STATE,
      status: 'preview',
      image: stored[0]!.image,
      captures: stored,
    });
  }, [invalidateOperation]);

  const chooseAnotherImage = useCallback(() => {
    invalidateOperation();
    imageRef.current = null;
    capturesRef.current = [];
    setState({
      ...INITIAL_STATE,
      status: runtimeRef.current ? 'source' : 'setup',
    });
  }, [invalidateOperation]);

  const refresh = useCallback(() => {
    invalidateOperation();
    imageRef.current = null;
    capturesRef.current = [];
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
    let currentProgress: ProgressMessage[] = ['preparing'];

    setState((current) => ({
      ...current,
      status: 'analyzing',
      presentation: null,
      annotations: null,
      errorCode: null,
      diagnostic: null,
      errorParams: {},
      pricingUrl: null,
      progress: currentProgress,
    }));

    try {
      const captures = capturesRef.current.length
        ? capturesRef.current
        : [{ image, context: pageContext }];
      const outcome = await runtime.analyze({
        captures,
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
        captures,
        presentation: outcome.presentation,
        annotations: outcome.annotations,
        errorCode: null,
        diagnostic: null,
        errorParams: {},
        pricingUrl: null,
        progress: [...currentProgress],
      });
    } catch (error) {
      if (generationRef.current !== operationGeneration) return;
      if (error instanceof AnalysisRuntimeFailure) {
        if (error.code === 'cancelled') {
          setState((current) => ({
            ...current,
            status: 'cancelled',
            presentation: null,
            annotations: null,
            errorCode: null,
            diagnostic: null,
            errorParams: {},
            pricingUrl: null,
          }));
          return;
        }
        setState((current) => ({
          ...current,
          status: 'failed',
          presentation: null,
          annotations: null,
          errorCode: error.code,
          diagnostic: error.diagnostic,
          errorParams: error.params,
          pricingUrl: error.pricingUrl,
        }));
        return;
      }
      setState((current) => ({
        ...current,
        status: 'failed',
        presentation: null,
        annotations: null,
        errorCode: 'unknown',
        diagnostic: null,
        errorParams: {},
        pricingUrl: null,
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
      presentation: null,
      annotations: null,
      errorCode: null,
      diagnostic: null,
      errorParams: {},
      pricingUrl: null,
    }));
  }, []);

  const returnToPreview = useCallback(() => {
    invalidateOperation();
    setState((current) => ({
      ...current,
      status: current.image ? 'preview' : runtimeRef.current ? 'source' : 'setup',
      presentation: null,
      annotations: null,
      errorCode: null,
      diagnostic: null,
      errorParams: {},
      pricingUrl: null,
      progress: [],
    }));
  }, [invalidateOperation]);

  return {
    state,
    configure,
    updateRuntime,
    unconfigure,
    selectImage,
    selectCaptures,
    restoreCaptures: selectCaptures,
    chooseAnotherImage,
    refresh,
    analyze,
    cancel,
    returnToPreview,
  };
}
