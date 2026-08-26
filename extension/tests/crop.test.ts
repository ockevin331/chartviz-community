import { describe, expect, it } from 'vitest';
import type { ChartContext } from '../src/domain/chart-context';
import { bitmapCropRect } from '../src/platform/capture/crop';

const context: ChartContext = {
  site: 'tradingview',
  pageType: 'advanced-chart',
  url: 'https://www.tradingview.com/chart/?symbol=BITSTAMP%3ABTCUSD',
  symbol: 'BTCUSD',
  exchange: 'BITSTAMP',
  timeframe: '1D',
  chart: {
    id: 'Chart #1',
    bounds: { x: 100, y: 50, width: 800, height: 600 },
  },
  viewport: { width: 1200, height: 800, devicePixelRatio: 2 },
};

describe('bitmapCropRect', () => {
  it('maps CSS pixels to screenshot pixels', () => {
    expect(bitmapCropRect(context, 2400, 1600)).toEqual({
      x: 200,
      y: 100,
      width: 1600,
      height: 1200,
    });
  });

  it('clamps the crop to the bitmap', () => {
    const clipped = {
      ...context,
      chart: {
        ...context.chart,
        bounds: { x: 1000, y: 700, width: 400, height: 300 },
      },
    };

    expect(bitmapCropRect(clipped, 1200, 800)).toEqual({
      x: 1000,
      y: 700,
      width: 200,
      height: 100,
    });
  });
});
