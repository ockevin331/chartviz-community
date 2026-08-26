import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { browser } from 'wxt/browser';
import { buildCommunityPrompt } from '../../src/analysis/community-prompt';
import { parseCommunityReport, type CommunityReport } from '../../src/analysis/community-report';
import { buildAnnotations } from '../../src/annotations/build-annotations';
import type { AnnotatedReportImages } from '../../src/annotations/annotation-types';
import type { ProcessedImage } from '../../src/capture/image-types';
import { readManualUpload } from '../../src/capture/manual-upload';
import { createPanelVisibility } from '../../src/capture/panel-visibility';
import { processImage } from '../../src/capture/process-image';
import { captureTradingView } from '../../src/capture/tradingview-capture';
import { providerRegistry } from '../../src/providers/provider-registry';
import type { ProviderConfig, ProviderKind, VisionProvider } from '../../src/providers/provider-types';
import { loadProviderConfig } from '../../src/storage/provider-session';
import { AnalysisError } from '../../src/ui/components/AnalysisError';
import { AnalysisProgress } from '../../src/ui/components/AnalysisProgress';
import { ImageLightbox, type LightboxImage } from '../../src/ui/components/ImageLightbox';
import { ImagePreview } from '../../src/ui/components/ImagePreview';
import { ImageSourcePicker } from '../../src/ui/components/ImageSourcePicker';
import { LanguageMenu, translations, type Language } from '../../src/ui/components/LanguageMenu';
import { ProviderSetup } from '../../src/ui/components/ProviderSetup';
import { ReportView } from '../../src/ui/components/ReportView';
import { useAnalysisController, type AnalysisControllerDependencies } from '../../src/ui/state/use-analysis-controller';

export type AppDependencies = {
  loadConfig(): Promise<ProviderConfig | null>;
  readUpload(file: File): Promise<ProcessedImage>;
  capture(signal: AbortSignal): Promise<ProcessedImage>;
  getProvider(kind: ProviderKind): VisionProvider;
  buildAnnotations(image: ProcessedImage, report: CommunityReport): Promise<AnnotatedReportImages>;
};

const defaultDependencies: AppDependencies = {
  loadConfig: loadProviderConfig,
  readUpload: (file) => readManualUpload(file),
  capture: (signal) => {
    const visibility = createPanelVisibility(window);
    return captureTradingView({
      pageUrl: document.referrer,
      hidePanel: (captureSignal) => visibility.hidePanel(captureSignal),
      restorePanel: () => visibility.restorePanel(),
      captureVisibleTab: (command) => browser.runtime.sendMessage(command),
      processImage,
    }, signal);
  },
  getProvider: (kind) => providerRegistry.get(kind),
  buildAnnotations,
};

export function App({ dependencies: overrides }: { dependencies?: Partial<AppDependencies> } = {}) {
  const dependencies = useMemo(() => ({ ...defaultDependencies, ...(overrides ?? {}) }), [overrides]);
  const controllerDependencies = useMemo<AnalysisControllerDependencies>(() => ({
    getProvider: dependencies.getProvider,
    buildPrompt: buildCommunityPrompt,
    validateReport: parseCommunityReport,
    buildAnnotations: dependencies.buildAnnotations,
  }), [dependencies]);
  const controller = useAnalysisController(controllerDependencies);
  const [language, setLanguage] = useState<Language>('en');
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const dragPosition = useRef<{ x: number; y: number } | null>(null);
  const t = translations[language];

  useEffect(() => {
    let current = true;
    void dependencies.loadConfig().then((config) => { if (current && config) controller.configure(config); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [dependencies.loadConfig, controller.configure]);

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
      <div className="brand"><Logo /><div><h1>ChartViz Community</h1><p className="slogan">{t.slogan}</p></div></div>
      <div className="header-actions" onPointerDown={(event) => event.stopPropagation()}><LanguageMenu language={language} onChange={setLanguage} /><button className="toolbar-button close-button" type="button" aria-label={t.close} onClick={() => window.parent.postMessage({ source: 'chartviz', type: 'panel-close' }, '*')}><CloseIcon /></button></div>
    </header>
    {loading && <section className="backend-loading" role="status">…</section>}
    {!loading && state.status === 'setup' && <ProviderSetup language={language} onLanguageChange={setLanguage} onConfigured={controller.configure} testConnection={(config, signal) => dependencies.getProvider(config.provider).testConnection(config, signal)} />}
    {!loading && state.status === 'source' && <ImageSourcePicker language={language} capture={dependencies.capture} readUpload={dependencies.readUpload} onSelected={controller.selectImage} />}
    {state.status === 'preview' && state.image && <ImagePreview language={language} image={state.image} onZoom={setLightbox} onChange={controller.chooseAnotherImage} onAnalyze={() => void controller.analyze({ instrument: null, timeframe: null }, language)} />}
    {state.status === 'analyzing' && state.image && <><ImagePreview language={language} image={state.image} analyzing onZoom={setLightbox} onChange={controller.chooseAnotherImage} onAnalyze={() => undefined} /><AnalysisProgress language={language} progress={state.progress} onCancel={controller.cancel} /></>}
    {state.status === 'failed' && <AnalysisError language={language} error={state.error} onBack={controller.returnToPreview} />}
    {state.status === 'cancelled' && <AnalysisError language={language} cancelled onBack={controller.returnToPreview} />}
    {state.status === 'completed' && state.image && state.report && state.annotations && <ReportView language={language} original={state.image} report={state.report} annotations={state.annotations} />}
    {lightbox && <ImageLightbox language={language} image={lightbox} onClose={() => setLightbox(null)} />}
  </main>;
}

function Logo() { return <svg className="logo" viewBox="0 0 40 40" role="img" aria-label="ChartViz logo"><rect width="40" height="40" rx="10" fill="currentColor" opacity=".16" /><path d="M10 27l7-8 5 4 8-11M10 31h20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /><circle cx="30" cy="12" r="2.5" fill="currentColor" /></svg>; }
function CloseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>; }
