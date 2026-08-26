import { chartContextSchema, type ChartContext } from '../../domain/chart-context';
import { elementText, findActiveBinanceChart, selectedTimeframe } from '../binance/collect-context';

export function parseBybitTradeUrl(value: string) {
  const url = new URL(value);
  if (!/(^|\.)bybit\.com$/i.test(url.hostname)) return null;
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const tradeIndex = segments.findIndex(segment => segment.toLowerCase() === 'trade');
  if (tradeIndex < 0) return null;
  const market = segments[tradeIndex + 1]?.toLowerCase();
  if (market === 'spot' && segments[tradeIndex + 2] && segments[tradeIndex + 3]) {
    const base = segments[tradeIndex + 2]!.toUpperCase();
    const quote = segments[tradeIndex + 3]!.toUpperCase();
    if (/^[A-Z0-9]+$/.test(base) && /^[A-Z0-9]+$/.test(quote)) return { symbol: `${base}${quote}`, pageType: 'spot-trade' as const };
  }
  if (['usdt', 'usdc', 'inverse'].includes(market ?? '') && segments[tradeIndex + 2]) {
    const symbol = segments[tradeIndex + 2]!.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (symbol) return { symbol, pageType: 'futures-trade' as const };
  }
  return null;
}

export function collectBybitContext(): ChartContext {
  const market = parseBybitTradeUrl(location.href);
  if (!market) throw new Error('Open a Bybit spot or derivatives trading page first.');
  const chart = findActiveBinanceChart();
  if (!chart) throw new Error('No visible Bybit candlestick chart was found.');
  const rect = chart.getBoundingClientRect();
  return chartContextSchema.parse({
    site: 'bybit', pageType: market.pageType, url: location.href,
    symbol: market.symbol, exchange: 'BYBIT', timeframe: selectedTimeframe(chart),
    currentOhlcText: elementText(chart).slice(0, 500) || undefined,
    chart: { id: chart.id || chart.getAttribute('data-testid') || 'Bybit chart', ariaLabel: chart.getAttribute('aria-label') || undefined,
      bounds: { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.min(rect.right, innerWidth) - Math.max(0, rect.x), height: Math.min(rect.bottom, innerHeight) - Math.max(0, rect.y) } },
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
  });
}

export async function collectBybitContextWithRetry(timeoutMs = 30000): Promise<ChartContext> {
  const deadline = Date.now() + timeoutMs; let lastError: unknown;
  do { try {
    const context = collectBybitContext();
    if (!context.timeframe) throw new Error('The Bybit chart timeframe is still loading.');
    return context;
  } catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 300)); } } while (Date.now() < deadline);
  throw lastError;
}
