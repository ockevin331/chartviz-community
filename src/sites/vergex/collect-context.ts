import { chartContextSchema, type ChartContext } from '../../domain/analysis';
import {
  elementText,
  findActiveBinanceChart,
} from '../binance/collect-context';
import { normalizeHyperliquidTimeframe } from '../exchanges/collect-context';

const CHART_PATH = /^\/chart\/?$/i;
const TIMEFRAME_ATTRIBUTE = 'data-chartviz-vergex-timeframe';

export function parseVergexChartUrl(value: string) {
  const url = new URL(value);
  if (url.hostname.toLowerCase() !== 'vergex.trade' || !CHART_PATH.test(url.pathname)) return null;
  const symbol = url.searchParams.get('symbol')?.trim();
  if (!symbol || !/^[a-z0-9._-]{1,32}(?::[a-z0-9._-]{1,32})?$/i.test(symbol)) return null;
  return { symbol, exchangeId: url.searchParams.get('exchange')?.trim() || undefined };
}

export function vergexMarketVenue(symbol: string): string {
  // Hyperliquid HIP-3 uses a deployer namespace. `xyz:` identifies a
  // trade.xyz market; preserve it in the symbol while presenting its venue.
  return symbol.toLowerCase().startsWith('xyz:') ? 'TRADE.XYZ' : 'VERGEX';
}

function visibleRect(element: Element): DOMRect | null {
  const rect = element.getBoundingClientRect();
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(innerWidth, rect.right);
  const bottom = Math.min(innerHeight, rect.bottom);
  return right > left && bottom > top
    ? new DOMRect(left, top, right - left, bottom - top) : null;
}

function findSpecializedPanel(): HTMLElement | null {
  const labels = /^(?:Cost & Liquidation Map|成本清算图)$/i;
  const heading = [...document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,[role="heading"],span,div')]
    .find((element) => labels.test(elementText(element)) && Boolean(visibleRect(element)));
  if (!heading) return null;
  let candidate: HTMLElement = heading;
  for (let parent = heading.parentElement, depth = 0; parent && depth < 7; parent = parent.parentElement, depth += 1) {
    const rect = visibleRect(parent);
    if (!rect) continue;
    if (rect.width >= 420 && rect.height >= 180) candidate = parent;
    if (parent.querySelector('canvas,svg') && rect.width >= 420 && rect.height >= 220) return parent;
  }
  return candidate === heading ? null : candidate;
}

function unionVisibleBounds(first: Element, second?: Element | null) {
  const a = visibleRect(first);
  if (!a) throw new Error('The VergeX chart is outside the visible browser area.');
  const b = second ? visibleRect(second) : null;
  if (!b) return { x: a.x, y: a.y, width: a.width, height: a.height };
  const x = Math.min(a.left, b.left);
  const y = Math.min(a.top, b.top);
  const right = Math.max(a.right, b.right);
  const bottom = Math.max(a.bottom, b.bottom);
  return { x, y, width: right - x, height: bottom - y };
}

export function selectedVergexTimeframe(): string | undefined {
  const bridged = normalizeHyperliquidTimeframe(
    document.documentElement.getAttribute(TIMEFRAME_ATTRIBUTE),
  );
  if (bridged) return bridged;

  // VergeX embeds its chart in a same-origin blob iframe. Its compact header
  // exposes exactly one visible interval button (for example "4 hours").
  // Reading that button avoids unrelated selected controls elsewhere in the
  // trading screen, which previously caused 4h to be reported as 1m/15m.
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe')) {
    try {
      const frameDocument = frame.contentDocument;
      if (!frameDocument) continue;
      for (const button of frameDocument.querySelectorAll<HTMLElement>('button[aria-label]')) {
        const rect = button.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.top < 0 || rect.top > 100 || rect.width > 160) continue;
        const timeframe = normalizeHyperliquidTimeframe(button.getAttribute('aria-label'));
        if (timeframe) return timeframe;
      }
    } catch { /* inaccessible frame */ }
  }
  return undefined;
}

export function collectVergexContext(): ChartContext {
  const market = parseVergexChartUrl(location.href);
  if (!market) throw new Error('Open a VergeX chart page for a specific instrument first.');
  const chart = findActiveBinanceChart();
  if (!chart) throw new Error('No visible VergeX candlestick chart was found.');
  const specializedPanel = findSpecializedPanel();
  return chartContextSchema.parse({
    site: 'vergex', pageType: 'futures-trade', url: location.href,
    symbol: market.symbol, exchange: vergexMarketVenue(market.symbol),
    timeframe: selectedVergexTimeframe(),
    currentOhlcText: elementText(chart).slice(0, 500) || undefined,
    specializedEvidence: specializedPanel
      ? ['cost-distribution', 'liquidation-distribution'] : undefined,
    chart: {
      id: chart.id || chart.getAttribute('data-testid') || 'vergex chart',
      ariaLabel: chart.getAttribute('aria-label') || undefined,
      bounds: unionVisibleBounds(chart, specializedPanel),
    },
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
  });
}

export async function collectVergexContextWithRetry(timeoutMs = 30000): Promise<ChartContext> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  do {
    try {
      const context = collectVergexContext();
      // VergeX mounts the chart canvas before the interval control and store
      // are hydrated. Returning that partial context makes the first capture
      // race the page; wait until the active interval is observable instead.
      if (!context.timeframe) throw new Error('The VergeX chart timeframe is still loading.');
      return context;
    }
    catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 300)); }
  } while (Date.now() < deadline);
  throw lastError;
}
