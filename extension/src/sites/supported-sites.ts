export const UNSUPPORTED_CHART_URL_ERROR = 'This page is not a supported chart URL.';

const supportedHostSuffixes = [
  'tradingview.com', 'binance.com', 'okx.com', 'bybit.com', 'coinbase.com',
  'bitget.com', 'gate.com', 'gate.io', 'kucoin.com', 'mexc.com', 'htx.com', 'upbit.com',
] as const;

export function isSupportedChartHost(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return supportedHostSuffixes.some((host) => hostname === host || hostname.endsWith(`.${host}`))
      || hostname === 'app.hyperliquid.xyz'
      || hostname === 'stockpage.10jqka.com.cn'
      || hostname === 'vergex.trade';
  } catch {
    return false;
  }
}

export const supportedContentMatches = [
  'https://*.tradingview.com/chart/*',
  'https://*.binance.com/*/trade/*',
  'https://*.binance.com/*/futures/*',
  'https://*.binance.com/*/stocks/*',
  'https://web3.binance.com/*/token/*',
  'https://*.okx.com/*',
  'https://*.bybit.com/*',
  'https://app.hyperliquid.xyz/*',
  'https://*.coinbase.com/*',
  'https://*.bitget.com/*',
  'https://*.gate.com/*',
  'https://*.gate.io/*',
  'https://*.kucoin.com/*',
  'https://*.mexc.com/*',
  'https://*.htx.com/*',
  'https://*.upbit.com/exchange*',
  'https://stockpage.10jqka.com.cn/*',
  'https://vergex.trade/chart*',
] as const;

export const supportedChartHosts = [
  'https://*.tradingview.com/*',
  'https://*.binance.com/*',
  'https://*.okx.com/*',
  'https://*.bybit.com/*',
  'https://app.hyperliquid.xyz/*',
  'https://*.coinbase.com/*',
  'https://*.bitget.com/*',
  'https://*.gate.com/*',
  'https://*.gate.io/*',
  'https://*.kucoin.com/*',
  'https://*.mexc.com/*',
  'https://*.htx.com/*',
  'https://*.upbit.com/*',
  'https://stockpage.10jqka.com.cn/*',
  'https://vergex.trade/*',
] as const;

export const supportedSiteLinks = [
  { name: 'TradingView', url: 'https://www.tradingview.com/chart/?symbol=BITSTAMP%3ABTCUSD' },
  { name: 'Binance', url: 'https://www.binance.com/en/trade/BTC_USDT?type=spot' },
  { name: 'OKX', url: 'https://www.okx.com/trade-spot/btc-usdt' },
  { name: 'Bybit', url: 'https://www.bybit.com/en/trade/usdt/BTCUSDT' },
  { name: 'Hyperliquid', url: 'https://app.hyperliquid.xyz/trade/BTC' },
  { name: 'Coinbase', url: 'https://www.coinbase.com/advanced-trade/spot/BTC-USD' },
  { name: 'Bitget', url: 'https://www.bitget.com/spot/BTCUSDT' },
  { name: 'Gate', url: 'https://www.gate.com/trade/BTC_USDT' },
  { name: 'KuCoin', url: 'https://www.kucoin.com/trade/BTC-USDT' },
  { name: 'MEXC', url: 'https://www.mexc.com/exchange/BTC_USDT' },
  { name: 'HTX', url: 'https://www.htx.com/trade/btc_usdt' },
  { name: 'Upbit', url: 'https://www.upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC' },
  { name: '10jqka', url: 'https://stockpage.10jqka.com.cn/000001/' },
  { name: 'VergeX', url: 'https://vergex.trade/chart?symbol=BTC&exchange=3c1d0438-8a57-4a2e-ad90-68069c247367' },
] as const;
