import { describe, expect, it, vi } from 'vitest';
import { createBackgroundHandlers, type BackgroundDependencies } from '../entrypoints/background';
import type { ChartContext } from '../src/domain/chart-context';

const context: ChartContext = {
  site: 'tradingview',
  pageType: 'advanced-chart',
  url: 'https://www.tradingview.com/chart/3c8vMvO3/?symbol=BITSTAMP%3ABTCUSD',
  symbol: 'BTCUSD',
  exchange: 'BITSTAMP',
  timeframe: '15m',
  chart: { id: 'Chart #1', bounds: { x: 20, y: 80, width: 1200, height: 700 } },
  viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
};

function captureDependencies(overrides: Partial<BackgroundDependencies> = {}) {
  const events: string[] = [];
  const cropped = new Blob(['cropped'], { type: 'image/png' });
  const dependencies: BackgroundDependencies = {
    getActiveTab: vi.fn(async () => {
      events.push('active-tab');
      return { id: 42, windowId: 17, url: context.url };
    }),
    sendTabMessage: vi.fn(async (tabId, message) => {
      if (message.type === 'chartviz/chart/ready') {
        events.push(`ready:${tabId}`);
        return { ok: true, context };
      }
      if (message.type === 'chartviz/panel/visibility') {
        events.push(`${message.visible ? 'restore' : 'hide'}:${tabId}`);
        return { ok: true, visible: message.visible };
      }
      if (message.type === 'chartviz/panel/toggle') {
        events.push(`toggle:${tabId}`);
        return { ok: true, visible: true };
      }
      return undefined;
    }),
    captureVisibleTab: vi.fn(async (windowId) => {
      events.push(`capture:${windowId}`);
      return 'data:image/png;base64,c2NyZWVuc2hvdA==';
    }),
    cropScreenshot: vi.fn(async () => {
      events.push('crop');
      return cropped;
    }),
    blobToDataUrl: vi.fn(async (blob) => {
      expect(blob).toBe(cropped);
      events.push('data-url');
      return 'data:image/png;base64,Y3JvcHBlZA==';
    }),
    injectContentScript: vi.fn(async (tabId) => { events.push(`inject:${tabId}`); }),
    wait: vi.fn(async () => undefined),
    ...overrides,
  };
  return { dependencies, events };
}

describe('active-chart background boundary', () => {
  it('waits for context, hides, captures, crops, restores, and returns context in order', async () => {
    const { dependencies, events } = captureDependencies();
    const handlers = createBackgroundHandlers(dependencies);

    await expect(handlers.onMessage({ type: 'chartviz/active-chart/capture' })).resolves.toEqual({
      ok: true,
      context,
      previewDataUrl: 'data:image/png;base64,Y3JvcHBlZA==',
    });
    expect(events).toEqual([
      'active-tab', 'ready:42', 'hide:42', 'capture:17', 'crop', 'restore:42', 'data-url',
    ]);
    expect(dependencies.wait).toHaveBeenCalledWith(80);
  });

  it('inspects through the content script without taking a screenshot', async () => {
    const { dependencies, events } = captureDependencies();
    const handlers = createBackgroundHandlers(dependencies);

    await expect(handlers.onMessage({ type: 'chartviz/active-chart/inspect' })).resolves.toEqual({ ok: true, context });
    expect(events).toEqual(['active-tab', 'ready:42']);
    expect(dependencies.captureVisibleTab).not.toHaveBeenCalled();
  });

  it('returns readiness failure without hiding or capturing', async () => {
    const { dependencies } = captureDependencies({
      sendTabMessage: vi.fn(async () => ({ ok: false, error: 'The chart is still loading.' })),
    });
    const handlers = createBackgroundHandlers(dependencies);

    await expect(handlers.onMessage({ type: 'chartviz/active-chart/capture' })).resolves.toEqual({
      ok: false, error: 'The chart is still loading.',
    });
    expect(dependencies.captureVisibleTab).not.toHaveBeenCalled();
  });

  it('restores the panel when crop fails and returns a bounded error', async () => {
    const { dependencies, events } = captureDependencies();
    dependencies.cropScreenshot = vi.fn(async () => {
      events.push('crop');
      throw new Error('crop failed');
    });
    const handlers = createBackgroundHandlers(dependencies);

    await expect(handlers.onMessage({ type: 'chartviz/active-chart/capture' })).resolves.toEqual({
      ok: false, error: 'crop failed',
    });
    expect(events).toContain('restore:42');
  });

  it.each(['provider', 'apiKey', 'key', 'prompt', 'model', 'response'])(
    'ignores a capture message carrying forbidden %s data',
    (field) => {
      const { dependencies } = captureDependencies();
      const handlers = createBackgroundHandlers(dependencies);

      expect(handlers.onMessage({ type: 'chartviz/active-chart/capture', [field]: 'secret' })).toBeUndefined();
      expect(dependencies.getActiveTab).not.toHaveBeenCalled();
    },
  );

  it('returns undefined synchronously for unrelated messages', () => {
    const { dependencies } = captureDependencies();
    const handlers = createBackgroundHandlers(dependencies);

    expect(handlers.onMessage({ type: 'other-extension-message' })).toBeUndefined();
    expect(dependencies.getActiveTab).not.toHaveBeenCalled();
  });

  it('toggles the existing content-script panel without reinjection', async () => {
    const { dependencies, events } = captureDependencies();
    const handlers = createBackgroundHandlers(dependencies);

    await handlers.onActionClicked({ id: 42 });

    expect(events).toEqual(['toggle:42']);
    expect(dependencies.injectContentScript).not.toHaveBeenCalled();
  });

  it('injects the content script and retries once when the tab has no receiver', async () => {
    const { dependencies, events } = captureDependencies();
    const sendTabMessage = vi.mocked(dependencies.sendTabMessage);
    sendTabMessage.mockRejectedValueOnce(new Error('No receiver'));
    const handlers = createBackgroundHandlers(dependencies);

    await handlers.onActionClicked({ id: 42 });

    expect(events).toEqual(['inject:42', 'toggle:42']);
    expect(sendTabMessage).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the action click has no tab id', async () => {
    const { dependencies } = captureDependencies();
    const handlers = createBackgroundHandlers(dependencies);

    await handlers.onActionClicked({});

    expect(dependencies.sendTabMessage).not.toHaveBeenCalled();
    expect(dependencies.injectContentScript).not.toHaveBeenCalled();
  });
});
