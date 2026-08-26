import { useCallback, useEffect, useRef, useState } from 'react';
import type { CapturedChart } from '../../capture/active-chart';
import type { ChartContext } from '../../domain/chart-context';
import { supportedSiteLinks, UNSUPPORTED_CHART_URL_ERROR } from '../../sites/supported-sites';
import { translations, type Language } from './LanguageMenu';

type ChartCaptureSourceProps = {
  language: Language;
  inspect(): Promise<ChartContext>;
  capture(signal: AbortSignal): Promise<CapturedChart>;
  onCaptured(captured: CapturedChart): void;
};

function publicMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function ChartCaptureSource({ language, inspect, capture, onCaptured }: ChartCaptureSourceProps) {
  const t = translations[language];
  const [context, setContext] = useState<ChartContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const captureController = useRef<AbortController | null>(null);
  const unsupported = error === UNSUPPORTED_CHART_URL_ERROR;

  const refresh = useCallback(async () => {
    setLoading(true);
    setContext(null);
    setError(null);
    try {
      setContext(await inspect());
    } catch (nextError) {
      setError(publicMessage(nextError, t.chartDetectionError));
    } finally {
      setLoading(false);
    }
  }, [inspect, t.chartDetectionError]);

  useEffect(() => {
    void refresh();
    return () => captureController.current?.abort(new DOMException('Cancelled', 'AbortError'));
  }, [refresh]);

  async function startCapture() {
    if (!context || capturing) return;
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

  return <section className="capture-source chart-capture-source">
    <div className="section-heading"><div><h2>{unsupported ? t.unsupportedPage : t.detectedChart}</h2><p>{unsupported ? t.unsupportedChartHelp : t.detectedChartHelp}</p></div></div>
    {loading && <p className="chart-waiting" role="status">{t.waitingForChart}</p>}
    {!loading && context && <>
      <dl className="chart-context">
        <div><dt>{t.instrument}</dt><dd>{context.symbol || t.notDetected}</dd></div>
        <div><dt>{t.exchange}</dt><dd>{context.exchange || context.site}</dd></div>
        <div><dt>{t.timeframe}</dt><dd>{context.timeframe || t.notDetected}</dd></div>
      </dl>
      <button className="primary" type="button" disabled={capturing} onClick={() => void startCapture()}>{capturing ? t.capturingChart : t.captureAnalyze}</button>
    </>}
    {!loading && error && <div className="chart-guidance" role="alert">
      {!unsupported && <><strong>{t.chartUnavailable}</strong><p>{error}</p></>}
      <div className="supported-site-links" aria-label={t.supportedSites}>{supportedSiteLinks.map((site) => <a key={site.name} href={site.url} target="_blank" rel="noreferrer">{site.name}</a>)}</div>
    </div>}
    {!loading && !unsupported && <button className="secondary refresh-detection" type="button" disabled={capturing} onClick={() => void refresh()}>{t.refreshChartDetection}</button>}
  </section>;
}
