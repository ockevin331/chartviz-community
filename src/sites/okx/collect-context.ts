import { chartContextSchema, type ChartContext } from '../../domain/analysis';
import { elementText, findActiveBinanceChart, selectedTimeframe } from '../binance/collect-context';

const OKX_MARKETS = new Map([
  ['trade-spot', 'spot-trade'],
  ['trade-swap', 'futures-trade'],
  ['trade-futures', 'futures-trade'],
] as const);

export function parseOkxTradeUrl(value: string) {
  const url = new URL(value);
  if (!/(^|\.)okx\.com$/i.test(url.hostname)) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  const marketIndex = segments.findIndex(segment => OKX_MARKETS.has(segment.toLowerCase() as 'trade-spot' | 'trade-swap' | 'trade-futures'));
  if (marketIndex < 0 || !segments[marketIndex + 1]) return null;
  const route = segments[marketIndex]!.toLowerCase() as 'trade-spot' | 'trade-swap' | 'trade-futures';
  const instrument = decodeURIComponent(segments[marketIndex + 1]!).toUpperCase();
  if (!/^[A-Z0-9]+(?:[-_][A-Z0-9]+)+$/.test(instrument)) return null;
  return { symbol: instrument, pageType: OKX_MARKETS.get(route)! };
}

export function collectOkxContext(): ChartContext {
  const market = parseOkxTradeUrl(location.href);
  if (!market) throw new Error('Open an OKX spot or derivatives trading page first.');
  const chart = findActiveBinanceChart();
  if (!chart) throw new Error('No visible OKX candlestick chart was found.');
  const rect = chart.getBoundingClientRect();
  return chartContextSchema.parse({
    site: 'okx', pageType: market.pageType, url: location.href,
    symbol: market.symbol, exchange: 'OKX', timeframe: selectedTimeframe(chart),
    currentOhlcText: elementText(chart).slice(0, 500) || undefined,
    chart: { id: chart.id || chart.getAttribute('data-testid') || 'OKX chart', ariaLabel: chart.getAttribute('aria-label') || undefined,
      bounds: { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.min(rect.right, innerWidth) - Math.max(0, rect.x), height: Math.min(rect.bottom, innerHeight) - Math.max(0, rect.y) } },
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
  });
}

export async function collectOkxContextWithRetry(timeoutMs = 30000): Promise<ChartContext> {
  const deadline = Date.now() + timeoutMs; let lastError: unknown;
  do { try {
    const context = collectOkxContext();
    if (!context.timeframe) throw new Error('The OKX chart timeframe is still loading.');
    return context;
  } catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 300)); } } while (Date.now() < deadline);
  throw lastError;
}
