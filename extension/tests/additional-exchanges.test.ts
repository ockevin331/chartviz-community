import { describe, expect, it } from 'vitest';
import { normalizeHyperliquidSymbol, normalizeHyperliquidTimeframe, parseAdditionalExchangeUrl } from '../src/sites/exchanges/collect-context';
import { isSupportedChartUrl } from '../src/sites/collect-context';

describe('additional exchange URL support', () => {
  it.each([
    ['https://app.hyperliquid.xyz/trade/BTC', 'hyperliquid', 'BTC', 'futures-trade'],
    ['https://app.hyperliquid.xyz/trade/xyz:SPCX', 'hyperliquid', 'xyz:SPCX', 'futures-trade'],
    ['https://app.hyperliquid.xyz/trade', 'hyperliquid', undefined, 'futures-trade'],
    ['https://www.coinbase.com/advanced-trade/spot/BTC-USD', 'coinbase', 'BTC-USD', 'spot-trade'],
    ['https://www.coinbase.com/advanced-trade/perpetuals/BTC-PERP', 'coinbase', 'BTC-PERP', 'futures-trade'],
    ['https://www.bitget.com/spot/btcusdt', 'bitget', 'BTCUSDT', 'spot-trade'],
    ['https://www.bitget.com/futures/usdt/BTCUSDT', 'bitget', 'BTCUSDT', 'futures-trade'],
    ['https://www.gate.com/trade/BTC_USDT', 'gate', 'BTCUSDT', 'spot-trade'],
    ['https://www.gate.com/futures/USDT/BTC_USDT', 'gate', 'BTCUSDT', 'futures-trade'],
    ['https://www.kucoin.com/trade/BTC-USDT', 'kucoin', 'BTC-USDT', 'spot-trade'],
    ['https://www.kucoin.com/futures/trade/BTCUSDTM', 'kucoin', 'BTCUSDTM', 'futures-trade'],
    ['https://www.mexc.com/exchange/BTC_USDT', 'mexc', 'BTCUSDT', 'spot-trade'],
    ['https://www.mexc.com/futures/BTC_USDT', 'mexc', 'BTCUSDT', 'futures-trade'],
    ['https://www.htx.com/trade/btc_usdt?type=spot', 'htx', 'BTCUSDT', 'spot-trade'],
    ['https://www.htx.com/futures/linear_swap/exchange#contract_code=BTC-USDT', 'htx', 'BTCUSDT', 'futures-trade'],
  ])('parses %s', (url, site, symbol, pageType) => {
    expect(parseAdditionalExchangeUrl(url)).toEqual({ site, symbol, pageType });
    expect(isSupportedChartUrl(url)).toBe(true);
  });

  it('rejects non-trading pages', () => {
    expect(parseAdditionalExchangeUrl('https://www.coinbase.com/prices')).toBeNull();
    expect(parseAdditionalExchangeUrl('https://www.mexc.com/markets')).toBeNull();
  });

  it('does not advertise Crypto.com pages as supported', () => {
    expect(parseAdditionalExchangeUrl('https://crypto.com/exchange/trade/BTC_USDT')).toBeNull();
    expect(isSupportedChartUrl('https://crypto.com/en/price/bnb')).toBe(false);
  });

  it.each([
    ['1', '1m'], ['15', '15m'], ['60', '1h'], ['120', '2h'], ['240', '4h'],
    ['1D', '1d'], ['3D', '3d'], ['1W', '1w'], ['1M', '1M'],
    ['1h', '1h'], ['4H', '4h'], ['Change interval, 1 hour', '1h'],
    ['15 minutes', '15m'], ['周期 4小时', '4h'], ['时间周期 1日', '1d'],
  ])('normalizes Hyperliquid resolution %s', (value, expected) => {
    expect(normalizeHyperliquidTimeframe(value)).toBe(expected);
  });

  it.each(['VOLUME', 'VOL', 'RSI', 'MACD', 'EMA', 'VWAP', 'OpenInterest'])('does not treat the %s indicator as an instrument', (value) => {
    expect(normalizeHyperliquidSymbol(value)).toBeUndefined();
  });

  it.each([['BTC', 'BTC'], ['HYPERLIQUID:ETH', 'ETH'], ['xyz:SPCX', 'xyz:SPCX'], ['SOL / USD', 'SOL']])('normalizes the Hyperliquid instrument %s', (value, expected) => {
    expect(normalizeHyperliquidSymbol(value)).toBe(expected);
  });
});
