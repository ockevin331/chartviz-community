// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  hyperliquidControlMatchesTimeframe,
  rectIntersectsViewport,
} from '../src/sites/set-timeframe';

describe('site timeframe switching helpers', () => {
  it('rejects off-screen controls before attempting a chart switch', () => {
    expect(rectIntersectsViewport(
      { top: 1094, right: 120, bottom: 1132, left: 80 },
      1200,
      704,
    )).toBe(false);
    expect(rectIntersectsViewport(
      { top: 0, right: 89, bottom: 38, left: 52 },
      1200,
      704,
    )).toBe(true);
  });

  it('matches Hyperliquid numeric and accessible interval labels exactly', () => {
    expect(hyperliquidControlMatchesTimeframe('15m', ['15'])).toBe(true);
    expect(hyperliquidControlMatchesTimeframe('15m', ['Change interval, 15 minutes'])).toBe(true);
    expect(hyperliquidControlMatchesTimeframe('4h', ['240'])).toBe(true);
    expect(hyperliquidControlMatchesTimeframe('4h', ['4H'])).toBe(true);
    expect(hyperliquidControlMatchesTimeframe('15m', ['5'])).toBe(false);
  });
});
