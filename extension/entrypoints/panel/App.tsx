import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { buildCommunityPrompt } from '../../src/analysis/community-prompt';
import { parseCommunityReport, type CommunityReport } from '../../src/analysis/community-report';
import { runThreeStageAnalysis } from '../../src/analysis/stages/analysis-pipeline';
import { buildAnnotations } from '../../src/annotations/build-annotations';
import type { AnnotatedReportImages } from '../../src/annotations/annotation-types';
import { activeChartClient, type CapturedChart } from '../../src/capture/active-chart';
import type { ProcessedImage } from '../../src/capture/image-types';
import type { ChartContext } from '../../src/domain/chart-context';
import { providerRegistry } from '../../src/providers/provider-registry';
import type { ProviderConfig, ProviderKind, VisionProvider } from '../../src/providers/provider-types';
import { loadProviderConfig } from '../../src/storage/provider-session';
import { AnalysisError } from '../../src/ui/components/AnalysisError';
import { AnalysisProgress } from '../../src/ui/components/AnalysisProgress';
import { ChartCaptureSource } from '../../src/ui/components/ChartCaptureSource';
import { ImageLightbox, type LightboxImage } from '../../src/ui/components/ImageLightbox';
import { ImagePreview } from '../../src/ui/components/ImagePreview';
import { LanguageMenu, translations, type Language } from '../../src/ui/components/LanguageMenu';
import { ProviderSetup } from '../../src/ui/components/ProviderSetup';
import { ReportView } from '../../src/ui/components/ReportView';
import { useAnalysisController, type AnalysisControllerDependencies } from '../../src/ui/state/use-analysis-controller';

export type AppDependencies = {
  loadConfig(): Promise<ProviderConfig | null>;
  inspect(): Promise<ChartContext>;
  capture(signal: AbortSignal): Promise<CapturedChart>;
  getProvider(kind: ProviderKind): VisionProvider;
  buildAnnotations(image: ProcessedImage, report: CommunityReport): Promise<AnnotatedReportImages>;
};

const defaultDependencies: AppDependencies = {
  loadConfig: loadProviderConfig,
  inspect: () => activeChartClient.inspect(),
  capture: (signal) => activeChartClient.capture(signal),
  getProvider: (kind) => providerRegistry.get(kind),
  buildAnnotations,
};

export function App({ dependencies: overrides }: { dependencies?: Partial<AppDependencies> } = {}) {
  const dependencies = useMemo(() => ({ ...defaultDependencies, ...(overrides ?? {}) }), [overrides]);
  const controllerDependencies = useMemo<AnalysisControllerDependencies>(() => ({
    runAnalysis: runThreeStageAnalysis,
    getProvider: dependencies.getProvider,
    buildPrompt: buildCommunityPrompt,
    validateReport: parseCommunityReport,
    buildAnnotations: dependencies.buildAnnotations,
  }), [dependencies]);
  const controller = useAnalysisController(controllerDependencies);
  const [language, setLanguage] = useState<Language>('en');
  const [loading, setLoading] = useState(true);
  const [contextRevision, setContextRevision] = useState(0);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const lastContext = useRef<ChartContext | null>(null);
  const dragPosition = useRef<{ x: number; y: number } | null>(null);
  const t = translations[language];

  useEffect(() => {
    let current = true;
    void dependencies.loadConfig().then((config) => { if (current && config) controller.configure(config); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [dependencies.loadConfig, controller.configure]);

  const refreshAll = useCallback(() => {
    lastContext.current = null;
    setContextRevision((revision) => revision + 1);
    controller.refresh();
  }, [controller.refresh]);

  useEffect(() => {
    function handlePageMessage(event: MessageEvent) {
      if (event.source !== window.parent || !event.data || typeof event.data !== 'object') return;
      if (event.data.source === 'chartviz-page' && event.data.type === 'context-changed') refreshAll();
    }
    window.addEventListener('message', handlePageMessage);
    return () => window.removeEventListener('message', handlePageMessage);
  }, [refreshAll]);

  function analyzeCaptured(captured: CapturedChart) {
    lastContext.current = captured.context;
    controller.selectImage(captured.image);
    void controller.analyze({ instrument: captured.context.symbol ?? null, timeframe: captured.context.timeframe ?? null }, language);
  }

  function captureAgain() {
    lastContext.current = null;
    setContextRevision((revision) => revision + 1);
    controller.chooseAnotherImage();
  }

  function retryAnalysis() {
    const context = lastContext.current;
    void controller.analyze({ instrument: context?.symbol ?? null, timeframe: context?.timeframe ?? null }, language);
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('button')) return;
    dragPosition.current = { x: event.screenX, y: event.screenY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const previous = dragPosition.current;
    if (!previous) return;
    const dx = event.screenX - previous.x;
    const dy = event.screenY - previous.y;
    dragPosition.current = { x: event.screenX, y: event.screenY };
    window.parent.postMessage({ source: 'chartviz', type: 'panel-drag', dx, dy }, '*');
  }
  const state = controller.state;
  return <main>
    <header className="drag-handle" data-testid="drag-handle" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { dragPosition.current = null; }} onPointerCancel={() => { dragPosition.current = null; }}>
      <div className="brand"><Logo /><div><h1>ChartViz</h1><p className="slogan">{t.slogan}</p></div></div>
      <div className="header-actions" onPointerDown={(event) => event.stopPropagation()}><LanguageMenu language={language} onChange={setLanguage} /><button className="toolbar-button refresh-button" type="button" aria-label={t.refresh} onClick={refreshAll}><RefreshIcon /></button><button className="toolbar-button close-button" type="button" aria-label={t.close} onClick={() => window.parent.postMessage({ source: 'chartviz', type: 'panel-close' }, '*')}><CloseIcon /></button></div>
    </header>
    {loading && <section className="backend-loading" role="status">…</section>}
    {!loading && state.status === 'setup' && <ProviderSetup language={language} onConfigured={controller.configure} testConnection={(config, signal) => dependencies.getProvider(config.provider).testConnection(config, signal)} />}
    {!loading && state.status === 'source' && <ChartCaptureSource key={contextRevision} language={language} inspect={dependencies.inspect} capture={dependencies.capture} onCaptured={analyzeCaptured} />}
    {state.status === 'preview' && state.image && <ImagePreview language={language} image={state.image} onZoom={setLightbox} onChange={captureAgain} onAnalyze={retryAnalysis} />}
    {state.status === 'analyzing' && state.image && <><ImagePreview language={language} image={state.image} analyzing onZoom={setLightbox} onChange={captureAgain} onAnalyze={() => undefined} /><AnalysisProgress language={language} progress={state.progress} onCancel={controller.cancel} /></>}
    {state.status === 'failed' && <AnalysisError language={language} errorCode={state.errorCode} diagnostic={state.diagnostic} onBack={controller.returnToPreview} />}
    {state.status === 'cancelled' && <AnalysisError language={language} cancelled onBack={controller.returnToPreview} />}
    {state.status === 'completed' && state.image && state.report && state.annotations && <ReportView language={language} original={state.image} report={state.report} annotations={state.annotations} />}
    {lightbox && <ImageLightbox language={language} image={lightbox} onClose={() => setLightbox(null)} />}
  </main>;
}

function Logo() { return <svg className="logo" viewBox="0 0 40 40" role="img" aria-label="ChartViz logo"><rect width="40" height="40" rx="10" fill="currentColor" opacity=".16" /><path d="M10 27l7-8 5 4 8-11M10 31h20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /><circle cx="30" cy="12" r="2.5" fill="currentColor" /></svg>; }
function RefreshIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M18.2 9A7 7 0 0 0 6.1 6.5L4 9m16 6-2.1 2.5A7 7 0 0 1 5.8 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function CloseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>; }
