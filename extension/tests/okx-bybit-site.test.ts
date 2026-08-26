import { describe, expect, it } from 'vitest';
import { isSupportedChartUrl } from '../src/sites/collect-context';
import { parseBybitTradeUrl } from '../src/sites/bybit/collect-context';
import { parseOkxTradeUrl } from '../src/sites/okx/collect-context';

describe('OKX trading URL support', () => {
  it.each([
    ['https://www.okx.com/trade-spot/btc-usdt', 'BTC-USDT', 'spot-trade'],
    ['https://www.okx.com/zh-hans/trade-swap/btc-usdt-swap', 'BTC-USDT-SWAP', 'futures-trade'],
    ['https://www.okx.com/en/trade-futures/btc-usd-260925', 'BTC-USD-260925', 'futures-trade'],
    ['https://www.okx.com/trade-futures/btc-usd_um_xperp-5yearly#workspaceId=1786515588204', 'BTC-USD_UM_XPERP-5YEARLY', 'futures-trade'],
  ])('parses %s', (url, symbol, pageType) => {
    expect(parseOkxTradeUrl(url)).toEqual({ symbol, pageType });
    expect(isSupportedChartUrl(url)).toBe(true);
  });

  it('rejects non-trading pages', () => {
    expect(parseOkxTradeUrl('https://www.okx.com/markets/prices')).toBeNull();
  });
});

describe('Bybit trading URL support', () => {
  it.each([
    ['https://www.bybit.com/en/trade/spot/BTC/USDT', 'BTCUSDT', 'spot-trade'],
    ['https://www.bybit.com/trade/usdt/BTCUSDT', 'BTCUSDT', 'futures-trade'],
    ['https://www.bybit.com/zh-TW/trade/inverse/BTCUSD', 'BTCUSD', 'futures-trade'],
  ])('parses %s', (url, symbol, pageType) => {
    expect(parseBybitTradeUrl(url)).toEqual({ symbol, pageType });
    expect(isSupportedChartUrl(url)).toBe(true);
  });

  it('rejects non-trading pages', () => {
    expect(parseBybitTradeUrl('https://www.bybit.com/en/markets/overview')).toBeNull();
  });
});
