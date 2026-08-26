import { describe, expect, it } from 'vitest';
import { isSupportedChartUrl } from '../src/sites/collect-context';
import { chooseUpbitFrameTimeframe } from '../src/sites/upbit/frame-timeframe';
import {
  normalizeUpbitLegendTimeframe,
  normalizeUpbitSavedLayoutTimeframe,
  normalizeUpbitTimeframe,
  parseUpbitExchangeUrl,
} from '../src/sites/upbit/collect-context';

describe('Upbit exchange page support', () => {
  it.each([
    ['https://upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC', { baseAsset: 'BTC', quoteAsset: 'KRW', symbol: 'BTC/KRW' }],
    ['https://www.upbit.com/exchange?code=CRIX.UPBIT.BTC-ETH', { baseAsset: 'ETH', quoteAsset: 'BTC', symbol: 'ETH/BTC' }],
    ['https://upbit.com/exchange?market=USDT-XRP&chartviz=open', { baseAsset: 'XRP', quoteAsset: 'USDT', symbol: 'XRP/USDT' }],
  ])('parses %s', (url, expected) => {
    expect(parseUpbitExchangeUrl(url)).toEqual(expected);
    expect(isSupportedChartUrl(url)).toBe(true);
  });

  it.each([
    ['https://upbit.com/', null],
    ['https://upbit.com/exchange', null],
    ['https://upbit.com/service_center', null],
    ['https://example.com/exchange?code=CRIX.UPBIT.KRW-BTC', null],
  ])('does not treat %s as an Upbit chart', (url, expected) => {
    expect(parseUpbitExchangeUrl(url)).toBe(expected);
  });

  it.each([
    ['1분', '1m'], ['5분봉', '5m'], ['15분', '15m'], ['60분', '1h'],
    ['240분봉', '4h'], ['날', '1d'], ['일봉', '1d'], ['주간', '1w'], ['월봉', '1M'],
    ['현재 선택된 봉: 15분', '15m'], ['캔들 주기 (1일)', '1d'],
    ['4H', '4h'],
  ])('normalizes %s to %s', (label, timeframe) => {
    expect(normalizeUpbitTimeframe(label)).toBe(timeframe);
  });

  it('does not guess from a label containing several timeframe options', () => {
    expect(normalizeUpbitTimeframe('1분 3분 5분 15분')).toBeUndefined();
  });

  it.each([
    ['BTC/KRW · 30 · UPBIT', '30m'],
    ['BTC/KRW\n30\nUPBIT', '30m'],
    ['ETH/KRW · 240 · UPBIT', '4h'],
    ['XRP/KRW · D · UPBIT', '1d'],
  ])('reads the TradingView legend %s as %s', (legend, timeframe) => {
    expect(normalizeUpbitLegendTimeframe(legend)).toBe(timeframe);
  });

  it.each([
    [{ interval: '30' }, '30m'],
    [{ charts: [{ interval: '240' }] }, '4h'],
    [JSON.stringify({ charts: [{ resolution: '1D' }] }), '1d'],
    [{ charts: [{ interval: '5' }, { interval: '240' }] }, undefined],
  ])('reads a saved TradingView layout', (layout, timeframe) => {
    expect(normalizeUpbitSavedLayoutTimeframe(layout)).toBe(timeframe);
  });

  it('prefers the largest visible chart frame instead of the last stale iframe message', () => {
    const now = Date.now();
    expect(chooseUpbitFrameTimeframe([
      {
        timeframe: '1m', evidence: 'legend', confidence: 90,
        receivedAt: now, frameArea: 20_000, documentVisible: true,
      },
      {
        timeframe: '4h', evidence: 'toolbar', confidence: 100,
        receivedAt: now - 200, frameArea: 500_000, documentVisible: true,
      },
    ], now)).toBe('4h');
  });

  it('ignores hidden and expired Upbit chart-frame signals', () => {
    const now = Date.now();
    expect(chooseUpbitFrameTimeframe([
      {
        timeframe: '15m', evidence: 'toolbar', confidence: 100,
        receivedAt: now, frameArea: 500_000, documentVisible: false,
      },
      {
        timeframe: '1d', evidence: 'toolbar', confidence: 100,
        receivedAt: now - 20_000, frameArea: 500_000, documentVisible: true,
      },
    ], now)).toBeUndefined();
  });
});
