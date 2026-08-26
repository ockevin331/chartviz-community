import { describe, expect, it } from 'vitest';
import { isSupportedChartUrl } from '../src/sites/collect-context';
import { normalizeBinanceTimeframe, parseBinanceFuturesUrl, parseBinanceSpotUrl, parseBinanceStockUrl, parseBinanceWeb3TokenUrl } from '../src/sites/binance/collect-context';

describe('Binance spot URL support', () => {
  it.each(['en', 'zh-CN', 'es', 'ar', 'id', 'en-TR'])(
    'supports the %s locale route', locale => {
      const url = `https://www.binance.com/${locale}/trade/BNB_USDT?type=spot`;
      expect(parseBinanceSpotUrl(url)).toEqual({ baseAsset: 'BNB', quoteAsset: 'USDT', symbol: 'BNBUSDT' });
      expect(isSupportedChartUrl(url)).toBe(true);
    },
  );

  it('does not treat non-spot Binance pages as supported charts', () => {
    expect(isSupportedChartUrl('https://www.binance.com/en/trade/BNB_USDT?type=cross')).toBe(false);
    expect(isSupportedChartUrl('https://www.binance.com/en/markets/overview')).toBe(false);
  });

  it('supports Binance spot routes after the site removes the default type parameter', () => {
    expect(isSupportedChartUrl('https://www.binance.com/zh-CN/trade/BNB_USDT')).toBe(true);
    expect(isSupportedChartUrl('https://www.binance.com/en/trade/BNB_USDT?type=SPOT')).toBe(true);
  });

  it.each([['15m', '15m'], ['1D', '1d'], ['1W', '1w'], ['1M', '1M'], ['4H', '4h'], ['4 hours', '4h'], ['1 Day', '1d'], ['4小时', '4h'], ['1天', '1d'], ['1周', '1w'], ['1个月', '1M'], ['30 minutes', '30m']])(
    'normalizes localized timeframe %s', (input, expected) => {
      expect(normalizeBinanceTimeframe(input)).toBe(expected);
    },
  );

  it('ignores missing timeframe text', () => {
    expect(normalizeBinanceTimeframe(undefined)).toBeUndefined();
    expect(normalizeBinanceTimeframe(null)).toBeUndefined();
  });
});

describe('Binance stock URL support', () => {
  it.each(['en', 'zh-CN', 'es', 'ar', 'id', 'en-TR'])(
    'supports the %s locale route', locale => {
      const url = `https://www.binance.com/${locale}/stocks/EQ_AAPL`;
      expect(parseBinanceStockUrl(url)).toEqual({ ticker: 'AAPL', symbol: 'AAPL' });
      expect(isSupportedChartUrl(url)).toBe(true);
    },
  );

  it('does not accept unrelated stock routes', () => {
    expect(parseBinanceStockUrl('https://www.binance.com/en/stocks/')).toBeNull();
    expect(parseBinanceStockUrl('https://example.com/en/stocks/EQ_AAPL')).toBeNull();
  });
});

describe('Binance futures URL support', () => {
  it.each(['en', 'zh-CN', 'es', 'ar', 'id', 'en-TR'])(
    'supports the %s locale route', locale => {
      const url = `https://www.binance.com/${locale}/futures/BTCUSDT`;
      expect(parseBinanceFuturesUrl(url)).toEqual({ symbol: 'BTCUSDT' });
      expect(isSupportedChartUrl(url)).toBe(true);
    },
  );

  it('does not accept unrelated or incomplete futures routes', () => {
    expect(parseBinanceFuturesUrl('https://www.binance.com/zh-CN/futures/')).toBeNull();
    expect(parseBinanceFuturesUrl('https://example.com/en/futures/BTCUSDT')).toBeNull();
  });
});

describe('Binance Web3 token URL support', () => {
  it.each(['en', 'zh-CN', 'es', 'ar', 'id'])(
    'supports the %s locale route', locale => {
      const url = `https://web3.binance.com/${locale}/token/bsc/0xed9ae3def8d6f052971bb8b6d1975ff267cf9aad`;
      expect(parseBinanceWeb3TokenUrl(url)).toEqual({
        chain: 'bsc',
        address: '0xed9ae3def8d6f052971bb8b6d1975ff267cf9aad',
      });
      expect(isSupportedChartUrl(url)).toBe(true);
    },
  );

  it('requires the Web3 hostname and a complete token route', () => {
    expect(parseBinanceWeb3TokenUrl('https://www.binance.com/en/token/bsc/0x123')).toBeNull();
    expect(parseBinanceWeb3TokenUrl('https://web3.binance.com/en/token/bsc')).toBeNull();
  });
});
