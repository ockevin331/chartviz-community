import { describe, expect, it } from 'vitest';
import { normalizeTradingViewTimeframe } from '../src/sites/tradingview/collect-context';

describe('TradingView timeframe normalization', () => {
  it.each([
    ['15m', '15m'],
    ['15 minutes', '15m'],
    ['4 hours', '4h'],
    ['1 day', '1d'],
    ['15', '15m'],
    ['240', '4h'],
    ['1D', '1d'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeTradingViewTimeframe(input)).toBe(expected);
  });
});
