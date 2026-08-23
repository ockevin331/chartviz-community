import { describe, expect, it } from 'vitest';
import { parseVergexChartUrl, vergexMarketVenue } from '../src/sites/vergex/collect-context';
import { vergexIntervalForTimeframe } from '../src/sites/set-timeframe';

describe('VergeX chart support', () => {
  it('parses a namespaced instrument and exchange id', () => {
    expect(parseVergexChartUrl('https://vergex.trade/chart?symbol=xyz%3ACXMT&exchange=3c1d0438-8a57-4a2e-ad90-68069c247367')).toEqual({
      symbol: 'xyz:CXMT', exchangeId: '3c1d0438-8a57-4a2e-ad90-68069c247367',
    });
  });

  it('rejects non-chart and missing-symbol pages', () => {
    expect(parseVergexChartUrl('https://vergex.trade/')).toBeNull();
    expect(parseVergexChartUrl('https://vergex.trade/chart')).toBeNull();
  });

  it('maps the Hyperliquid xyz namespace to the trade.xyz venue', () => {
    expect(vergexMarketVenue('xyz:CXMT')).toBe('TRADE.XYZ');
    expect(vergexMarketVenue('BTC')).toBe('VERGEX');
  });

  it('uses the TradingView resolution strings required by the VergeX interval store', () => {
    expect(vergexIntervalForTimeframe('15m')).toBe('15');
    expect(vergexIntervalForTimeframe('4h')).toBe('240');
    expect(vergexIntervalForTimeframe('1d')).toBe('1D');
  });

  it('parses the default native VergeX BTC chart without a Hyperliquid namespace', () => {
    expect(parseVergexChartUrl('https://vergex.trade/chart?symbol=BTC&exchange=3c1d0438-8a57-4a2e-ad90-68069c247367')).toEqual({
      symbol: 'BTC', exchangeId: '3c1d0438-8a57-4a2e-ad90-68069c247367',
    });
  });
});
