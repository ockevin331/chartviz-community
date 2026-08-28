import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { AnalysisMode } from '../../src/analysis/analysis-mode';
import { DirectAnalysisRuntime } from '../../src/analysis/runtime/direct-analysis-runtime';
import {
  AnalysisRuntimeFailure,
  type AnalysisCapabilities,
  type AnalysisRuntime,
} from '../../src/analysis/runtime/analysis-runtime';
import { activeChartClient, type CapturedChart } from '../../src/capture/active-chart';
import { productionCloudGateway, resolveCloudRuntime, type CloudAnalysisGateway } from '../../src/cloud/cloud-gateway';
import { CloudConnectionError, createCloudClient, type CloudClient } from '../../src/cloud/cloud-client';
import {
  createCloudConnectionManager,
  type CloudConnectionManager,
  type CloudConnectionState,
} from '../../src/cloud/cloud-connection';
import type { ChartContext } from '../../src/domain/chart-context';
import type { SupportedCaptureTimeframe } from '../../src/domain/chart-messages';
import { providerRegistry } from '../../src/providers/provider-registry';
import type { ProviderConfig } from '../../src/providers/provider-types';
import { loadAnalysisMode, saveAnalysisMode } from '../../src/storage/analysis-mode-storage';
import { loadProviderConfig, saveProviderConfig } from '../../src/storage/provider-session';
import { loadCloudConnection, type StoredCloudConnection } from '../../src/storage/cloud-connection-storage';
import { cleanupLegacyCloudAnalysisStorage } from '../../src/storage/legacy-cloud-analysis-cleanup';
import { AnalysisError } from '../../src/ui/components/AnalysisError';
import { AnalysisModeSettings } from '../../src/ui/components/AnalysisModeSettings';
import { AnalysisProgress } from '../../src/ui/components/AnalysisProgress';
import { ChartCaptureSource } from '../../src/ui/components/ChartCaptureSource';
import { ImageLightbox, type LightboxImage } from '../../src/ui/components/ImageLightbox';
import { ImagePreview } from '../../src/ui/components/ImagePreview';
import { LanguageMenu, translations, type Language } from '../../src/ui/components/LanguageMenu';
import { ReportView } from '../../src/ui/components/ReportView';
import { useAnalysisController } from '../../src/ui/state/use-analysis-controller';

export type AppDependencies = {
  loadConfig(): Promise<ProviderConfig | null>;
  saveConfig(config: ProviderConfig): Promise<void>;
  loadMode(config: ProviderConfig | null): Promise<AnalysisMode>;
  saveMode(mode: AnalysisMode): Promise<void>;
  cloudGateway: CloudAnalysisGateway;
  cloudConnectionManager: CloudConnectionManager;
  cloudClient: Pick<CloudClient, 'captureSettings'>;
  loadCloudConnection(): Promise<StoredCloudConnection | null>;
  cleanupLegacyCloudAnalysisStorage(): Promise<void>;
  inspect(): Promise<ChartContext>;
  capture(signal: AbortSignal): Promise<CapturedChart>;
  captureMany(
    timeframes: readonly SupportedCaptureTimeframe[],
    signal: AbortSignal,
  ): Promise<readonly CapturedChart[]>;
  createDirectRuntime(config: ProviderConfig): AnalysisRuntime;
  testDirectConnection(config: ProviderConfig, signal: AbortSignal): Promise<void>;
};

const defaultDependencies: AppDependencies = {
  loadConfig: loadProviderConfig,
  saveConfig: saveProviderConfig,
  loadMode: loadAnalysisMode,
  saveMode: saveAnalysisMode,
  cloudGateway: productionCloudGateway,
  cloudConnectionManager: createCloudConnectionManager(),
  cloudClient: createCloudClient(),
  loadCloudConnection,
  cleanupLegacyCloudAnalysisStorage,
  inspect: () => activeChartClient.inspect(),
  capture: (signal) => activeChartClient.capture(signal),
  captureMany: (timeframes, signal) => activeChartClient.captureMany(timeframes, signal),
  createDirectRuntime: (config) => new DirectAnalysisRuntime(config),
  testDirectConnection: (config, signal) =>
    providerRegistry.get(config.provider).testConnection(config, signal),
};

export function App({ dependencies: overrides }: { dependencies?: Partial<AppDependencies> } = {}) {
  const dependencies = useMemo(() => ({ ...defaultDependencies, ...(overrides ?? {}) }), [overrides]);
  const controller = useAnalysisController();
  const [language, setLanguage] = useState<Language>('en');
  const [loading, setLoading] = useState(true);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(null);
  const [activeMode, setActiveMode] = useState<AnalysisMode>('cloud');
  const [setupMode, setSetupMode] = useState<AnalysisMode>('cloud');
  const [settingsMode, setSettingsMode] = useState<AnalysisMode>('cloud');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cloudConnection, setCloudConnection] = useState<CloudConnectionState>({
    status: 'disconnected', account: null, errorCode: null,
  });
  const [cloudBusy, setCloudBusy] = useState(false);
  const [analysisCapabilities, setAnalysisCapabilities] = useState<AnalysisCapabilities | null>(null);
  const [restoreError, setRestoreError] = useState<AnalysisRuntimeFailure | null>(null);
  const [contextRevision, setContextRevision] = useState(0);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const lastContext = useRef<ChartContext | null>(null);
  const restorationRuntime = useRef<AnalysisRuntime | null>(null);
  const restorationAttempt = useRef(0);
  const activeModeRef = useRef<AnalysisMode>('cloud');
  const desiredStoredMode = useRef<{ attempt: number; mode: AnalysisMode }>({
    attempt: 0,
    mode: 'cloud',
  });
  const dragPosition = useRef<{ x: number; y: number } | null>(null);
  const t = translations[language];

  const activateRuntime = useCallback((runtime: AnalysisRuntime) => {
    setAnalysisCapabilities(runtime.capabilities());
    controller.configure(runtime);
  }, [controller.configure]);

  const invalidateRestoration = useCallback(() => {
    restorationAttempt.current += 1;
    const runtime = restorationRuntime.current;
    restorationRuntime.current = null;
    runtime?.cancel();
    return restorationAttempt.current;
  }, []);

  const beginRuntimeTransition = useCallback(() => {
    const transition = invalidateRestoration();
    desiredStoredMode.current = { attempt: transition, mode: activeModeRef.current };
    setRestoreError(null);
    setLoading(false);
    setCloudBusy(false);
    return transition;
  }, [invalidateRestoration]);

  const reconcileStoredMode = useCallback((completed: {
    attempt: number;
    mode: AnalysisMode;
  }): void => {
    async function reconcile(write: { attempt: number; mode: AnalysisMode }): Promise<void> {
      const desired = desiredStoredMode.current;
      if (desired.attempt === write.attempt && desired.mode === write.mode) return;
      try {
        await dependencies.saveMode(desired.mode);
      } catch {
        return;
      }
      await reconcile(desired);
    }
    void reconcile(completed);
  }, [dependencies.saveMode]);

  const persistModeForTransition = useCallback(async (
    mode: AnalysisMode,
    attempt: number,
  ): Promise<boolean> => {
    const write = { attempt, mode };
    desiredStoredMode.current = write;
    try {
      await dependencies.saveMode(mode);
    } catch (error) {
      if (restorationAttempt.current !== attempt) return false;
      throw error;
    }
    reconcileStoredMode(write);
    return restorationAttempt.current === attempt;
  }, [dependencies.saveMode, reconcileStoredMode]);

  const activateDirectTransition = useCallback(async (
    config: ProviderConfig,
    closeSettings: boolean,
  ): Promise<boolean> => {
    const transition = beginRuntimeTransition();
    try {
      await dependencies.saveConfig(config);
    } catch (error) {
      if (restorationAttempt.current !== transition) return false;
      throw error;
    }
    if (restorationAttempt.current !== transition) return false;
    if (!await persistModeForTransition('direct', transition)) return false;
    if (restorationAttempt.current !== transition) return false;

    const wasDirect = activeModeRef.current === 'direct';
    const runtime = dependencies.createDirectRuntime(config);
    if (restorationAttempt.current !== transition) return false;
    activeModeRef.current = 'direct';
    setProviderConfig(config);
    setActiveMode('direct');
    if (closeSettings) setSettingsMode('direct');
    else setSetupMode('direct');
    setAnalysisCapabilities(runtime.capabilities());
    if (wasDirect) controller.updateRuntime(runtime);
    else controller.configure(runtime);
    if (closeSettings) setSettingsOpen(false);
    return true;
  }, [
    beginRuntimeTransition,
    controller.configure,
    controller.updateRuntime,
    dependencies.createDirectRuntime,
    dependencies.saveConfig,
    persistModeForTransition,
  ]);

  const activateInitialDirect = useCallback(
    (config: ProviderConfig) => activateDirectTransition(config, false),
    [activateDirectTransition],
  );
  const activateSettingsDirect = useCallback(
    (config: ProviderConfig) => activateDirectTransition(config, true),
    [activateDirectTransition],
  );

  const restoreCloudRuntime = useCallback(async (
    runtime: AnalysisRuntime,
    attempt: number,
  ): Promise<void> => {
    try {
      const restored = await runtime.restoreActiveAnalysis?.();
      if (restorationAttempt.current !== attempt) return;
      if (restorationRuntime.current === runtime) restorationRuntime.current = null;
      setRestoreError(null);
      const first = restored?.captures[0];
      if (!restored || !first) return;
      setLanguage(restored.outputLanguage);
      controller.restoreCaptures(restored.captures);
      void controller.analyze(first.context, restored.outputLanguage);
    } catch (error) {
      if (restorationAttempt.current !== attempt) return;
      if (error instanceof AnalysisRuntimeFailure && error.code === 'service_unavailable') {
        setRestoreError(new AnalysisRuntimeFailure('service_unavailable'));
      } else {
        if (restorationRuntime.current === runtime) restorationRuntime.current = null;
        setRestoreError(null);
      }
    }
  }, [controller.restoreCaptures, controller.analyze]);

  useEffect(() => {
    let current = true;
    const startupAttempt = ++restorationAttempt.current;
    const isCurrent = () => current && restorationAttempt.current === startupAttempt;
    void (async () => {
      try {
        void dependencies.cleanupLegacyCloudAnalysisStorage().catch(() => undefined);
      } catch {
        // Legacy cleanup is best-effort and must not block source configuration.
      }
      const [config, connection] = await Promise.all([
        dependencies.loadConfig(),
        dependencies.cloudConnectionManager.load(),
      ]);
      if (!isCurrent()) return;
      const mode = await dependencies.loadMode(config);
      if (!isCurrent()) return;
      setProviderConfig(config);
      setCloudConnection(connection);
      activeModeRef.current = mode;
      desiredStoredMode.current = { attempt: startupAttempt, mode };
      setActiveMode(mode);
      setSetupMode(mode);
      setSettingsMode(mode);
      if (mode === 'direct' && config) {
        activateRuntime(dependencies.createDirectRuntime(config));
      } else if (mode === 'cloud' && connection.status === 'connected') {
        const runtime = resolveCloudRuntime(dependencies.cloudGateway);
        if (runtime) {
          activateRuntime(runtime);
          restorationRuntime.current = runtime;
          await restoreCloudRuntime(runtime, startupAttempt);
        }
      }
    })().catch(() => {
      // Startup restore failures stay local and leave the configured source state available.
    }).finally(() => {
      if (isCurrent()) setLoading(false);
    });
    return () => {
      current = false;
      invalidateRestoration();
    };
  }, [
    dependencies.loadConfig,
    dependencies.loadMode,
    dependencies.createDirectRuntime,
    dependencies.cloudGateway,
    dependencies.cloudConnectionManager,
    dependencies.cleanupLegacyCloudAnalysisStorage,
    activateRuntime,
    invalidateRestoration,
    restoreCloudRuntime,
  ]);

  const retryRestoration = useCallback(() => {
    const runtime = restorationRuntime.current;
    if (!runtime) return;
    const attempt = ++restorationAttempt.current;
    setRestoreError(null);
    setLoading(true);
    void restoreCloudRuntime(runtime, attempt).finally(() => {
      if (restorationAttempt.current === attempt) setLoading(false);
    });
  }, [restoreCloudRuntime]);

  const refreshAll = useCallback(() => {
    beginRuntimeTransition();
    lastContext.current = null;
    setContextRevision((revision) => revision + 1);
    controller.refresh();
  }, [beginRuntimeTransition, controller.refresh]);

  useEffect(() => {
    function handlePageMessage(event: MessageEvent) {
      if (event.source !== window.parent || !event.data || typeof event.data !== 'object') return;
      if (event.data.source === 'chartviz-page' && event.data.type === 'context-changed') refreshAll();
    }
    window.addEventListener('message', handlePageMessage);
    return () => window.removeEventListener('message', handlePageMessage);
  }, [refreshAll]);

  const loadMultiTimeframes = useCallback(async (): Promise<readonly SupportedCaptureTimeframe[]> => {
    const connection = await dependencies.loadCloudConnection();
    if (!connection) throw new CloudConnectionError('authentication_required');
    const settings = await dependencies.cloudClient.captureSettings(connection.token);
    return settings.timeframes.map(({ timeframe }) => timeframe as SupportedCaptureTimeframe);
  }, [dependencies.cloudClient, dependencies.loadCloudConnection]);

  function analyzeCaptured(captures: readonly CapturedChart[]) {
    const first = captures[0];
    if (!first) return;
    lastContext.current = first.context;
    controller.selectCaptures(captures.map((captured) => ({
      image: captured.image,
      context: {
        instrument: captured.context.symbol ?? null,
        timeframe: captured.context.timeframe ?? null,
        site: captured.context.site,
        exchange: captured.context.exchange ?? null,
        pageType: captured.context.pageType,
      },
    })));
    void controller.analyze({
      instrument: first.context.symbol ?? null,
      timeframe: first.context.timeframe ?? null,
      site: first.context.site,
      exchange: first.context.exchange ?? null,
      pageType: first.context.pageType,
    }, language);
  }

  function captureAgain() {
    lastContext.current = null;
    setContextRevision((revision) => revision + 1);
    controller.chooseAnotherImage();
  }

  function retryAnalysis() {
    const context = lastContext.current;
    const capturedContext = state.captures[0]?.context;
    void controller.analyze(capturedContext ?? {
      instrument: context?.symbol ?? null,
      timeframe: context?.timeframe ?? null,
      site: context?.site,
      exchange: context?.exchange ?? null,
      pageType: context?.pageType,
    }, language);
  }

  async function connectCloud(token: string): Promise<boolean> {
    const transition = beginRuntimeTransition();
    setCloudBusy(true);
    try {
      const connection = await dependencies.cloudConnectionManager.connect(token);
      if (restorationAttempt.current !== transition) return false;
      setCloudConnection(connection);
      if (connection.status === 'connected') {
        if (!await persistModeForTransition('cloud', transition)) return false;
        if (restorationAttempt.current !== transition) return false;
        const runtime = resolveCloudRuntime(dependencies.cloudGateway);
        if (!runtime) return false;
        if (restorationAttempt.current !== transition) return false;
        activeModeRef.current = 'cloud';
        setActiveMode('cloud');
        setSetupMode('cloud');
        setSettingsMode('cloud');
        activateRuntime(runtime);
        setSettingsOpen(false);
        return true;
      }
      return false;
    } catch (error) {
      if (restorationAttempt.current !== transition) return false;
      throw error;
    } finally {
      if (restorationAttempt.current === transition) setCloudBusy(false);
    }
  }

  async function disconnectCloud() {
    const transition = beginRuntimeTransition();
    setCloudBusy(true);
    try {
      const connection = await dependencies.cloudConnectionManager.disconnect();
      if (restorationAttempt.current !== transition) return;
      setCloudConnection(connection);
      if (activeMode === 'cloud') controller.unconfigure();
    } finally {
      if (restorationAttempt.current === transition) setCloudBusy(false);
    }
  }

  function openSettings() {
    setSettingsMode(activeMode);
    setSettingsOpen(true);
  }

  function openCloudSettings() {
    setSettingsMode('cloud');
    setSettingsOpen(true);
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
      <div className="header-actions" onPointerDown={(event) => event.stopPropagation()}><LanguageMenu language={language} onChange={setLanguage} />{(providerConfig || cloudConnection.account) && <button className="toolbar-button settings-button" type="button" aria-label={t.settings} onClick={openSettings}><SettingsIcon /></button>}<button className="toolbar-button refresh-button" type="button" aria-label={t.refresh} onClick={refreshAll}><RefreshIcon /></button><button className="toolbar-button close-button" type="button" aria-label={t.close} onClick={() => window.parent.postMessage({ source: 'chartviz', type: 'panel-close' }, '*')}><CloseIcon /></button></div>
    </header>
    {settingsOpen ? <section className="settings-view" role="dialog" aria-label={t.analysisSettings}>
      <button className="secondary settings-back" type="button" aria-label={t.backToChart} onClick={() => setSettingsOpen(false)}>← {t.backToChart}</button>
      <AnalysisModeSettings language={language} variant="settings" activeMode={activeMode} selectedMode={settingsMode} onSelectedModeChange={setSettingsMode} initialDirectConfig={providerConfig} activateDirect={activateSettingsDirect} testConnection={dependencies.testDirectConnection} cloudConnection={cloudConnection} cloudBusy={cloudBusy} onCloudConnect={connectCloud} onCloudDisconnect={disconnectCloud} />
    </section> : <>
      {loading && <section className="backend-loading" role="status">…</section>}
      {!loading && restoreError && <AnalysisError language={language} errorCode={restoreError.code} onBack={retryRestoration} />}
      {!loading && !restoreError && state.status === 'setup' && <AnalysisModeSettings language={language} variant="setup" activeMode={activeMode} selectedMode={setupMode} onSelectedModeChange={setSetupMode} initialDirectConfig={providerConfig} activateDirect={activateInitialDirect} testConnection={dependencies.testDirectConnection} cloudConnection={cloudConnection} cloudBusy={cloudBusy} onCloudConnect={connectCloud} onCloudDisconnect={disconnectCloud} />}
      {!loading && !restoreError && state.status === 'source' && analysisCapabilities && <ChartCaptureSource key={contextRevision} language={language} capabilities={analysisCapabilities} inspect={dependencies.inspect} capture={dependencies.capture} captureMany={dependencies.captureMany} loadMultiTimeframes={loadMultiTimeframes} onCaptured={analyzeCaptured} onOpenCloudSettings={openCloudSettings} />}
      {state.status === 'preview' && state.image && <ImagePreview language={language} image={state.image} onZoom={setLightbox} onChange={captureAgain} onAnalyze={retryAnalysis} />}
      {state.status === 'analyzing' && state.image && <><ImagePreview language={language} image={state.image} analyzing onZoom={setLightbox} onChange={captureAgain} onAnalyze={() => undefined} /><AnalysisProgress language={language} progress={state.progress} onCancel={controller.cancel} /></>}
      {state.status === 'failed' && <AnalysisError language={language} errorCode={state.errorCode} diagnostic={state.diagnostic} params={state.errorParams} pricingUrl={state.pricingUrl} onBack={retryAnalysis} />}
      {state.status === 'cancelled' && <AnalysisError language={language} cancelled onBack={controller.returnToPreview} />}
      {state.status === 'completed' && state.image && state.presentation && state.annotations && <ReportView language={language} captures={state.captures} presentation={state.presentation} annotations={state.annotations} />}
    </>}
    {lightbox && <ImageLightbox language={language} image={lightbox} onClose={() => setLightbox(null)} />}
  </main>;
}

function Logo() { return <svg className="logo" viewBox="0 0 40 40" role="img" aria-label="ChartViz logo"><rect width="40" height="40" rx="10" fill="currentColor" opacity=".16" /><path d="M10 27l7-8 5 4 8-11M10 31h20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /><circle cx="30" cy="12" r="2.5" fill="currentColor" /></svg>; }
function RefreshIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8a8 8 0 1 0 1 6M19 4v4h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function SettingsIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M19.2 13.2a7.5 7.5 0 0 0 0-2.4l2-1.5-2-3.4-2.4 1a8.5 8.5 0 0 0-2.1-1.2L14.4 3h-4.8l-.3 2.7a8.5 8.5 0 0 0-2.1 1.2l-2.4-1-2 3.4 2 1.5a7.5 7.5 0 0 0 0 2.4l-2 1.5 2 3.4 2.4-1a8.5 8.5 0 0 0 2.1 1.2l.3 2.7h4.8l.3-2.7a8.5 8.5 0 0 0 2.1-1.2l2.4 1 2-3.4-2-1.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>; }
function CloseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>; }
