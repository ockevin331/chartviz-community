// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContentMessageHandler, createContentPanel, parsePanelLaunchRequest, type ContentPanel } from '../entrypoints/content';
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

afterEach(() => {
  const panel = document.getElementById('chartviz-community-panel') as (HTMLElement & { __chartvizCleanup?: () => void }) | null;
  panel?.__chartvizCleanup?.();
  panel?.remove();
});

function panelFixture(initial = false): ContentPanel & { visible: boolean } {
  return {
    visible: initial,
    isVisible() { return this.visible; },
    setVisible(visible) { this.visible = visible; return { ok: true, visible }; },
    notifyContextChanged: vi.fn(),
  };
}

describe('content-script chart bridge', () => {
  it('recognizes an auto-open chart link and its requested language', () => {
    expect(parsePanelLaunchRequest('https://www.okx.com/trade-spot/btc-usdt?chartviz=open&chartvizLanguage=zh-CN')).toEqual({
      open: true,
      language: 'zh-CN',
    });
    expect(parsePanelLaunchRequest('https://www.okx.com/trade-spot/btc-usdt')).toEqual({
      open: false,
      language: null,
    });
  });

  it('replaces a stale panel left behind by an earlier extension runtime', () => {
    const stale = document.createElement('div');
    stale.id = 'chartviz-community-panel';
    const staleFrame = document.createElement('iframe');
    staleFrame.src = 'chrome-extension://old-runtime/panel.html';
    stale.append(staleFrame);
    document.documentElement.append(stale);

    const panel = createContentPanel('chrome-extension://current-runtime/panel.html');
    expect(panel.setVisible(true)).toEqual({ ok: true, visible: true });

    const mounted = document.getElementById('chartviz-community-panel');
    expect(mounted).not.toBe(stale);
    expect(mounted?.querySelector('iframe')?.getAttribute('src')).toBe('chrome-extension://current-runtime/panel.html');
  });

  it('accepts lightbox messages from the installed extension origin when the frame uses a dynamic resource URL', () => {
    const panel = createContentPanel('chrome-extension://dynamic-resource-id/panel.html');
    panel.setVisible(true);
    const host = document.getElementById('chartviz-community-panel') as HTMLElement;
    const frame = host.querySelector('iframe') as HTMLIFrameElement;
    const origin = 'chrome-extension://installed-extension-id';

    window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin,
      data: { source: 'chartviz', type: 'image-lightbox-open' },
    }));
    expect(host.style.inset).toBe('0px');
    expect(host.style.width).toBe('100vw');
    expect(host.style.maxWidth).toBe('none');

    window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin,
      data: { source: 'chartviz', type: 'image-lightbox-close' },
    }));
    expect(host.style.inset).toBe('');
    expect(host.style.right).toBe('12px');
    expect(host.style.width).toBe('400px');
  });

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

  it('switches the requested timeframe before returning the recollected context', async () => {
    const panel = panelFixture();
    const switchedContext = { ...context, timeframe: '4h' };
    const collectContext = vi.fn(async () => switchedContext);
    const setTimeframe = vi.fn(async () => undefined);
    const onMessage = createContentMessageHandler({
      panel,
      collectContext,
      waitForReady: async () => switchedContext,
      setTimeframe,
    });

    await expect(onMessage({ type: 'chartviz/chart/timeframe', timeframe: '4h' })).resolves.toEqual({
      ok: true,
      context: switchedContext,
    });
    expect(setTimeframe).toHaveBeenCalledWith('4h');
    expect(collectContext).toHaveBeenCalledTimes(1);
  });

  it('bounds timeframe switch failures without recollecting stale context', async () => {
    const collectContext = vi.fn(async () => context);
    const onMessage = createContentMessageHandler({
      panel: panelFixture(),
      collectContext,
      waitForReady: async () => context,
      setTimeframe: async () => { throw new Error('The chart did not switch to 1h.'); },
    });

    await expect(onMessage({ type: 'chartviz/chart/timeframe', timeframe: '1h' })).resolves.toEqual({
      ok: false,
      error: 'The chart did not switch to 1h.',
    });
    expect(collectContext).not.toHaveBeenCalled();
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
