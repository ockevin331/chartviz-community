import { describe, expect, it, vi } from 'vitest';
import { createContentMessageHandler, type ContentPanel } from '../entrypoints/content';
import type { ChartContext } from '../src/domain/chart-context';

const context: ChartContext = {
  site: 'tradingview',
  pageType: 'advanced-chart',
  url: 'https://www.tradingview.com/chart/3c8vMvO3/?symbol=BITSTAMP%3ABTCUSD',
  symbol: 'BTCUSD',
  exchange: 'BITSTAMP',
  timeframe: '15m',
  chart: { id: 'Chart #1', bounds: { x: 10, y: 70, width: 1000, height: 600 } },
  viewport: { width: 1200, height: 800, devicePixelRatio: 2 },
};

function panelFixture(initial = false): ContentPanel & { visible: boolean } {
  return {
    visible: initial,
    isVisible() { return this.visible; },
    setVisible(visible) { this.visible = visible; return { ok: true, visible }; },
    notifyContextChanged: vi.fn(),
  };
}

describe('content-script chart bridge', () => {
  it('returns collected and stable context for the two read messages', async () => {
    const panel = panelFixture();
    const collectContext = vi.fn(async () => context);
    const waitForReady = vi.fn(async () => context);
    const onMessage = createContentMessageHandler({ panel, collectContext, waitForReady });

    await expect(onMessage({ type: 'chartviz/context/get' })).resolves.toEqual({ ok: true, context });
    await expect(onMessage({ type: 'chartviz/chart/ready' })).resolves.toEqual({ ok: true, context });
    expect(collectContext).toHaveBeenCalledTimes(1);
    expect(waitForReady).toHaveBeenCalledTimes(1);
  });

  it('toggles and explicitly hides or restores the page panel', async () => {
    const panel = panelFixture();
    const onMessage = createContentMessageHandler({
      panel,
      collectContext: async () => context,
      waitForReady: async () => context,
    });

    await expect(onMessage({ type: 'chartviz/panel/toggle' })).resolves.toEqual({ ok: true, visible: true });
    expect(panel.visible).toBe(true);
    await expect(onMessage({ type: 'chartviz/panel/visibility', visible: false })).resolves.toEqual({ ok: true, visible: false });
    expect(panel.visible).toBe(false);
    await expect(onMessage({ type: 'chartviz/panel/visibility', visible: true })).resolves.toEqual({ ok: true, visible: true });
    expect(panel.visible).toBe(true);
  });

  it('bounds collector errors and ignores unrelated messages', async () => {
    const panel = panelFixture();
    const onMessage = createContentMessageHandler({
      panel,
      collectContext: async () => { throw new Error('This page is not a supported chart URL.'); },
      waitForReady: async () => { throw new Error('The chart is still loading.'); },
    });

    await expect(onMessage({ type: 'chartviz/context/get' })).resolves.toEqual({
      ok: false, error: 'This page is not a supported chart URL.',
    });
    await expect(onMessage({ type: 'chartviz/chart/ready' })).resolves.toEqual({
      ok: false, error: 'The chart is still loading.',
    });
    expect(onMessage({ type: 'other' })).toBeUndefined();
  });
});
