import type { ChartContext } from '../domain/analysis';
import { collectBinanceSpotContextWithRetry, parseBinanceFuturesUrl, parseBinanceSpotUrl, parseBinanceStockUrl, parseBinanceWeb3TokenUrl } from './binance/collect-context';
import { collectBybitContextWithRetry, parseBybitTradeUrl } from './bybit/collect-context';
import { collectOkxContextWithRetry, parseOkxTradeUrl } from './okx/collect-context';
import { collectAdditionalExchangeContextWithRetry, parseAdditionalExchangeUrl } from './exchanges/collect-context';
import { collectTradingViewContextWithRetry } from './tradingview/collect-context';
import { collect10jqkaContextWithRetry, parse10jqkaStockUrl } from './10jqka/collect-context';
import { collectVergexContextWithRetry, parseVergexChartUrl } from './vergex/collect-context';
import { collectUpbitContextWithRetry, parseUpbitExchangeUrl } from './upbit/collect-context';

export function isSupportedChartUrl(value: string): boolean {
  return /^https:\/\/([^.]+\.)*tradingview\.com\/chart\//i.test(value) || Boolean(parseBinanceSpotUrl(value) || parseBinanceFuturesUrl(value) || parseBinanceStockUrl(value) || parseBinanceWeb3TokenUrl(value) || parseOkxTradeUrl(value) || parseBybitTradeUrl(value) || parseAdditionalExchangeUrl(value) || parseUpbitExchangeUrl(value) || parse10jqkaStockUrl(value) || parseVergexChartUrl(value));
}

export function collectActiveChartContext(): Promise<ChartContext> {
  if (parseBinanceSpotUrl(location.href) || parseBinanceFuturesUrl(location.href) || parseBinanceStockUrl(location.href) || parseBinanceWeb3TokenUrl(location.href)) return collectBinanceSpotContextWithRetry();
  if (parseOkxTradeUrl(location.href)) return collectOkxContextWithRetry();
  if (parseBybitTradeUrl(location.href)) return collectBybitContextWithRetry();
  if (parseAdditionalExchangeUrl(location.href)) return collectAdditionalExchangeContextWithRetry();
  if (parseUpbitExchangeUrl(location.href)) return collectUpbitContextWithRetry();
  if (parse10jqkaStockUrl(location.href)) return collect10jqkaContextWithRetry();
  if (parseVergexChartUrl(location.href)) return collectVergexContextWithRetry();
  return collectTradingViewContextWithRetry();
}

export async function waitForActiveChartReady(timeoutMs = 15000): Promise<ChartContext> {
  const deadline = Date.now() + timeoutMs;
  let lastSignature = '';
  let stableSamples = 0;
  let lastError: unknown;
  do {
    try {
      const context = await collectActiveChartContext();
      const bounds = context.chart.bounds;
      if (!context.symbol || !context.timeframe || bounds.width < 200 || bounds.height < 150) {
        throw new Error('The chart metadata and timeframe controls are still loading.');
      }
      const signature = [
        context.site, context.symbol, context.timeframe.toLowerCase(),
        Math.round(bounds.x), Math.round(bounds.y), Math.round(bounds.width), Math.round(bounds.height),
      ].join('|');
      stableSamples = signature === lastSignature ? stableSamples + 1 : 1;
      lastSignature = signature;
      if (stableSamples >= 3) return context;
    } catch (error) {
      lastError = error;
      stableSamples = 0;
      lastSignature = '';
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  } while (Date.now() < deadline);
  throw new Error(lastError instanceof Error
    ? `The chart is still loading: ${lastError.message}`
    : 'The chart is still loading. Wait a moment and try again.');
}
