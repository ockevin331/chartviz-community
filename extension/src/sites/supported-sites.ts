import type { ChartContext } from '../domain/chart-context';
import {
  parseBinanceFuturesUrl,
  parseBinanceSpotUrl,
  parseBinanceStockUrl,
  parseBinanceWeb3TokenUrl,
} from './binance/collect-context';
import { parseBybitTradeUrl } from './bybit/collect-context';
import { parseAdditionalExchangeUrl } from './exchanges/collect-context';
import { parseOkxTradeUrl } from './okx/collect-context';
import { parse10jqkaStockUrl } from './10jqka/collect-context';
import { parseUpbitExchangeUrl } from './upbit/collect-context';
import { parseVergexChartUrl } from './vergex/collect-context';

export const UNSUPPORTED_CHART_URL_ERROR = 'This page is not a supported chart URL.';

export type SupportedSiteId = Exclude<ChartContext['site'], 'crypto-com'>;

export type SupportedSiteDefinition = Readonly<{
  id: SupportedSiteId;
  name: string;
  hostSuffixes: readonly string[];
  exactHosts?: readonly string[];
  contentMatches: readonly string[];
  hostPermissions: readonly string[];
  exampleBtcUrl: string;
  multiTimeframe: boolean;
  matchesChartUrl(value: string): boolean;
}>;

export type ChartAvailabilityFailure =
  | Readonly<{ code: 'unsupported_site'; onChartVizSite: boolean }>
  | Readonly<{
      code: 'unsupported_url';
      site: SupportedSiteId;
      siteName: string;
      exampleUrl: string;
    }>;

function isTradingViewChartUrl(value: string): boolean {
  const url = new URL(value);
  return /(^|\.)tradingview\.com$/i.test(url.hostname) && /^\/chart\//i.test(url.pathname);
}

function isBinanceChartUrl(value: string): boolean {
  return Boolean(
    parseBinanceSpotUrl(value)
      || parseBinanceFuturesUrl(value)
      || parseBinanceStockUrl(value)
      || parseBinanceWeb3TokenUrl(value),
  );
}

function isAdditionalExchangeUrl(site: SupportedSiteId, value: string): boolean {
  return parseAdditionalExchangeUrl(value)?.site === site;
}

export const supportedSites: readonly SupportedSiteDefinition[] = [
  {
    id: 'tradingview',
    name: 'TradingView',
    hostSuffixes: ['tradingview.com'],
    contentMatches: ['https://*.tradingview.com/chart/*'],
    hostPermissions: ['https://*.tradingview.com/*'],
    exampleBtcUrl: 'https://www.tradingview.com/chart/?symbol=BITSTAMP%3ABTCUSD',
    multiTimeframe: true,
    matchesChartUrl: isTradingViewChartUrl,
  },
  {
    id: 'binance',
    name: 'Binance',
    hostSuffixes: ['binance.com'],
    contentMatches: [
      'https://*.binance.com/*/trade/*',
      'https://*.binance.com/*/futures/*',
      'https://*.binance.com/*/stocks/*',
      'https://web3.binance.com/*/token/*',
    ],
    hostPermissions: ['https://*.binance.com/*'],
    exampleBtcUrl: 'https://www.binance.com/en/trade/BTC_USDT?type=spot',
    multiTimeframe: true,
    matchesChartUrl: isBinanceChartUrl,
  },
  {
    id: 'okx',
    name: 'OKX',
    hostSuffixes: ['okx.com'],
    contentMatches: ['https://*.okx.com/*'],
    hostPermissions: ['https://*.okx.com/*'],
    exampleBtcUrl: 'https://www.okx.com/trade-spot/btc-usdt',
    multiTimeframe: true,
    matchesChartUrl: (value) => Boolean(parseOkxTradeUrl(value)),
  },
  {
    id: 'bybit',
    name: 'Bybit',
    hostSuffixes: ['bybit.com'],
    contentMatches: ['https://*.bybit.com/*'],
    hostPermissions: ['https://*.bybit.com/*'],
    exampleBtcUrl: 'https://www.bybit.com/en/trade/usdt/BTCUSDT',
    multiTimeframe: true,
    matchesChartUrl: (value) => Boolean(parseBybitTradeUrl(value)),
  },
  {
    id: 'hyperliquid',
    name: 'Hyperliquid',
    hostSuffixes: [],
    exactHosts: ['app.hyperliquid.xyz'],
    contentMatches: ['https://app.hyperliquid.xyz/*'],
    hostPermissions: ['https://app.hyperliquid.xyz/*'],
    exampleBtcUrl: 'https://app.hyperliquid.xyz/trade/BTC',
    multiTimeframe: true,
    matchesChartUrl: (value) => isAdditionalExchangeUrl('hyperliquid', value),
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    hostSuffixes: ['coinbase.com'],
    contentMatches: ['https://*.coinbase.com/*'],
    hostPermissions: ['https://*.coinbase.com/*'],
    exampleBtcUrl: 'https://www.coinbase.com/advanced-trade/spot/BTC-USD',
    multiTimeframe: true,
    matchesChartUrl: (value) => isAdditionalExchangeUrl('coinbase', value),
  },
  {
    id: 'bitget',
    name: 'Bitget',
    hostSuffixes: ['bitget.com'],
    contentMatches: ['https://*.bitget.com/*'],
    hostPermissions: ['https://*.bitget.com/*'],
    exampleBtcUrl: 'https://www.bitget.com/spot/BTCUSDT',
    multiTimeframe: true,
    matchesChartUrl: (value) => isAdditionalExchangeUrl('bitget', value),
  },
  {
    id: 'gate',
    name: 'Gate',
    hostSuffixes: ['gate.com', 'gate.io'],
    contentMatches: ['https://*.gate.com/*', 'https://*.gate.io/*'],
    hostPermissions: ['https://*.gate.com/*', 'https://*.gate.io/*'],
    exampleBtcUrl: 'https://www.gate.com/trade/BTC_USDT',
    multiTimeframe: true,
    matchesChartUrl: (value) => isAdditionalExchangeUrl('gate', value),
  },
  {
    id: 'kucoin',
    name: 'KuCoin',
    hostSuffixes: ['kucoin.com'],
    contentMatches: ['https://*.kucoin.com/*'],
    hostPermissions: ['https://*.kucoin.com/*'],
    exampleBtcUrl: 'https://www.kucoin.com/trade/BTC-USDT',
    multiTimeframe: true,
    matchesChartUrl: (value) => isAdditionalExchangeUrl('kucoin', value),
  },
  {
    id: 'mexc',
    name: 'MEXC',
    hostSuffixes: ['mexc.com'],
    contentMatches: ['https://*.mexc.com/*'],
    hostPermissions: ['https://*.mexc.com/*'],
    exampleBtcUrl: 'https://www.mexc.com/exchange/BTC_USDT',
    multiTimeframe: true,
    matchesChartUrl: (value) => isAdditionalExchangeUrl('mexc', value),
  },
  {
    id: 'htx',
    name: 'HTX',
    hostSuffixes: ['htx.com'],
    contentMatches: ['https://*.htx.com/*'],
    hostPermissions: ['https://*.htx.com/*'],
    exampleBtcUrl: 'https://www.htx.com/trade/btc_usdt',
    multiTimeframe: true,
    matchesChartUrl: (value) => isAdditionalExchangeUrl('htx', value),
  },
  {
    id: 'upbit',
    name: 'Upbit',
    hostSuffixes: ['upbit.com'],
    contentMatches: ['https://*.upbit.com/exchange*'],
    hostPermissions: ['https://*.upbit.com/*'],
    exampleBtcUrl: 'https://www.upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC',
    multiTimeframe: true,
    matchesChartUrl: (value) => Boolean(parseUpbitExchangeUrl(value)),
  },
  {
    id: '10jqka',
    name: '同花顺',
    hostSuffixes: [],
    exactHosts: ['stockpage.10jqka.com.cn'],
    contentMatches: ['https://stockpage.10jqka.com.cn/*'],
    hostPermissions: ['https://stockpage.10jqka.com.cn/*'],
    exampleBtcUrl: 'https://stockpage.10jqka.com.cn/000001/',
    multiTimeframe: false,
    matchesChartUrl: (value) => Boolean(parse10jqkaStockUrl(value)),
  },
  {
    id: 'vergex',
    name: 'VergeX',
    hostSuffixes: [],
    exactHosts: ['vergex.trade'],
    contentMatches: ['https://vergex.trade/chart*'],
    hostPermissions: ['https://vergex.trade/*'],
    exampleBtcUrl: 'https://vergex.trade/chart?symbol=BTC&exchange=3c1d0438-8a57-4a2e-ad90-68069c247367',
    multiTimeframe: true,
    matchesChartUrl: (value) => Boolean(parseVergexChartUrl(value)),
  },
] as const;

function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function siteMatchesHost(site: SupportedSiteDefinition, hostname: string): boolean {
  return Boolean(site.exactHosts?.includes(hostname))
    || site.hostSuffixes.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

export function findSupportedSiteByHost(value: string): SupportedSiteDefinition | null {
  const hostname = hostnameOf(value);
  return hostname
    ? supportedSites.find((site) => siteMatchesHost(site, hostname)) ?? null
    : null;
}

export function findSupportedSiteByChartUrl(value: string): SupportedSiteDefinition | null {
  for (const site of supportedSites) {
    try {
      if (site.matchesChartUrl(value)) return site;
    } catch {
      // Invalid or incomplete URLs are not chart pages.
    }
  }
  return null;
}

export function classifyChartAvailability(value: string): ChartAvailabilityFailure | null {
  if (findSupportedSiteByChartUrl(value)) return null;
  const site = findSupportedSiteByHost(value);
  if (site) {
    return {
      code: 'unsupported_url',
      site: site.id,
      siteName: site.name,
      exampleUrl: site.exampleBtcUrl,
    };
  }
  const hostname = hostnameOf(value);
  return {
    code: 'unsupported_site',
    onChartVizSite: hostname === 'chartviz.xyz' || Boolean(hostname?.endsWith('.chartviz.xyz')),
  };
}

export function isSupportedChartHost(value: string): boolean {
  return findSupportedSiteByHost(value) !== null;
}

export function buildAutoOpenChartUrl(value: string, language: 'en' | 'zh-CN'): string {
  const url = new URL(value);
  url.searchParams.set('chartviz', 'open');
  url.searchParams.set('chartvizLanguage', language);
  return url.toString();
}

export const supportedContentMatches = supportedSites.flatMap((site) => [...site.contentMatches]);
export const supportedChartHosts = supportedSites.flatMap((site) => [...site.hostPermissions]);
export const supportedSiteLinks = supportedSites.map(({ id, name, exampleBtcUrl }) => ({
  id,
  name,
  url: exampleBtcUrl,
}));
