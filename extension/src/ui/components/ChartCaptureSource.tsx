import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisCapabilities } from '../../analysis/runtime/analysis-runtime';
import {
  isChartAvailabilityError,
  type CapturedChart,
} from '../../capture/active-chart';
import type { ChartContext } from '../../domain/chart-context';
import {
  findSupportedSiteByChartUrl,
  supportedSiteLinks,
  type ChartAvailabilityFailure,
} from '../../sites/supported-sites';
import { translations, type Language } from './LanguageMenu';
import { CaptureModeSelector, type CaptureMode } from './CaptureModeSelector';

type ChartCaptureSourceProps = {
  language: Language;
  capabilities: AnalysisCapabilities;
  inspect(): Promise<ChartContext>;
  capture(signal: AbortSignal): Promise<CapturedChart>;
  onCaptured(captured: CapturedChart): void;
  onOpenCloudSettings(): void;
};

function publicMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function ChartCaptureSource({
  language,
  capabilities,
  inspect,
  capture,
  onCaptured,
  onOpenCloudSettings,
}: ChartCaptureSourceProps) {
  const t = translations[language];
  const [context, setContext] = useState<ChartContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('single');
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<ChartAvailabilityFailure | null>(null);
  const captureController = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setContext(null);
    setCaptureMode('single');
    setError(null);
    setAvailability(null);
    try {
      setContext(await inspect());
    } catch (nextError) {
      if (isChartAvailabilityError(nextError)) {
        setAvailability(nextError.availability);
      } else {
        setError(publicMessage(nextError, t.chartDetectionError));
      }
    } finally {
      setLoading(false);
    }
  }, [inspect, t.chartDetectionError]);

  useEffect(() => {
    void refresh();
    return () => captureController.current?.abort(new DOMException('Cancelled', 'AbortError'));
  }, [refresh]);

  async function startCapture() {
    if (!context || capturing || captureMode !== 'single') return;
    const controller = new AbortController();
    captureController.current = controller;
    setCapturing(true);
    setError(null);
    try {
      onCaptured(await capture(controller.signal));
    } catch (nextError) {
      if (!controller.signal.aborted) setError(publicMessage(nextError, t.chartCaptureError));
    } finally {
      if (captureController.current === controller) captureController.current = null;
      setCapturing(false);
    }
  }

  const unsupportedSite = availability?.code === 'unsupported_site';
  const unsupportedUrl = availability?.code === 'unsupported_url';
  const siteSupportsMultiTimeframe = context
    ? findSupportedSiteByChartUrl(context.url)?.multiTimeframe === true
    : false;
  const heading = unsupportedSite
    ? t.unsupportedSiteTitle
    : unsupportedUrl ? t.unsupportedUrlTitle : t.detectedChart;
  const headingHelp = unsupportedSite
    ? t.unsupportedSiteHelp
    : unsupportedUrl ? t.unsupportedUrlHelp : t.detectedChartHelp;

  return <section className="capture-source chart-capture-source">
    <div className="section-heading"><div><h2>{heading}</h2><p>{headingHelp}</p></div></div>
    {loading && <p className="chart-waiting" role="status">{t.waitingForChart}</p>}
    {!loading && context && <>
      <dl className="chart-context">
        <div><dt>{t.instrument}</dt><dd>{context.symbol || t.notDetected}</dd></div>
        <div><dt>{t.exchange}</dt><dd>{context.exchange || context.site}</dd></div>
        <div><dt>{t.timeframe}</dt><dd>{context.timeframe || t.notDetected}</dd></div>
      </dl>
      <CaptureModeSelector
        key={context.url}
        language={language}
        mode={captureMode}
        capabilities={capabilities}
        siteSupportsMultiTimeframe={siteSupportsMultiTimeframe}
        onModeChange={setCaptureMode}
        onOpenCloudSettings={onOpenCloudSettings}
      />
      <button className="primary" type="button" disabled={capturing || captureMode === 'multi'} onClick={() => void startCapture()}>{capturing ? t.capturingChart : t.captureAnalyze}</button>
    </>}
    {!loading && error && <div className="chart-guidance" role="alert">
      <strong>{t.chartUnavailable}</strong><p>{error}</p>
    </div>}
    {!loading && unsupportedSite && <div className="chart-guidance" role="alert">
      <a
        className="chartviz-upload-link"
        href="https://www.chartviz.xyz/"
        target="_blank"
        rel="noreferrer"
      >
        {availability.onChartVizSite ? t.uploadOnCurrentChartViz : t.uploadOnChartViz}
      </a>
      <div className="supported-site-links" aria-label={t.supportedSites}>
        {supportedSiteLinks.map((site) => <a key={site.id} href={site.url} target="_blank" rel="noreferrer">{site.name}</a>)}
      </div>
    </div>}
    {!loading && unsupportedUrl && <div className="chart-guidance" role="alert">
      <a
        className="site-example-link"
        href={availability.exampleUrl}
        target="_blank"
        rel="noreferrer"
      >
        {t.openSiteBtcChart.replace('{site}', availability.siteName)}
      </a>
    </div>}
    {!loading && !availability && <button className="secondary refresh-detection" type="button" disabled={capturing} onClick={() => void refresh()}>{t.refreshChartDetection}</button>}
  </section>;
}
