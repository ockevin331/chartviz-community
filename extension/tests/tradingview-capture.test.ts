import { describe, expect, it, vi } from 'vitest';
import type { ProcessedImage } from '../src/capture/image-types';
import {
  captureTradingView,
  type CaptureDependencies,
} from '../src/capture/tradingview-capture';

const processed: ProcessedImage = {
  mediaType: 'image/jpeg',
  dataUrl: 'data:image/jpeg;base64,cHJvY2Vzc2Vk',
  width: 1200,
  height: 800,
};

function createDependencies(pageUrl = 'https://www.tradingview.com/chart/ABC123/') {
  const events: string[] = [];
  const capturedBlob = new Blob(['captured pixels'], { type: 'image/png' });
  const dependencies: CaptureDependencies = {
    pageUrl,
    hidePanel: vi.fn(async () => { events.push('hide'); }),
    captureVisibleTab: vi.fn(async (command) => {
      events.push(`capture:${command.type}`);
      return { ok: true, dataUrl: 'data:image/png;base64,Y2FwdHVyZWQ=' } as const;
    }),
    dataUrlToBlob: vi.fn(() => capturedBlob),
    processImage: vi.fn(async (blob) => {
      expect(blob).toBe(capturedBlob);
      events.push('process');
      return processed;
    }),
    restorePanel: vi.fn(async () => { events.push('restore'); }),
  };
  return { dependencies, events };
}

describe('captureTradingView', () => {
  it.each([
    'https://tradingview.com/chart/ABC123/',
    'https://www.tradingview.com/chart/ABC123/',
    'https://cn.tradingview.com/chart/ABC123/',
  ])('captures a supported TradingView chart URL: %s', async (pageUrl) => {
    const { dependencies } = createDependencies(pageUrl);

    await expect(captureTradingView(dependencies, new AbortController().signal))
      .resolves.toEqual(processed);
  });

  it.each([
    'http://www.tradingview.com/chart/ABC123/',
    'https://www.tradingview.com/markets/',
    'https://eviltradingview.com/chart/ABC123/',
    'https://www.tradingview.com.evil.test/chart/ABC123/',
    'not a URL',
  ])('rejects unsupported page URL %s without hiding or capturing', async (pageUrl) => {
    const { dependencies } = createDependencies(pageUrl);

    await expect(captureTradingView(dependencies, new AbortController().signal))
      .rejects.toThrow('TradingView chart');
    expect(dependencies.hidePanel).not.toHaveBeenCalled();
    expect(dependencies.captureVisibleTab).not.toHaveBeenCalled();
    expect(dependencies.restorePanel).not.toHaveBeenCalled();
  });

  it('hides, captures exactly once, processes, and finally restores in order', async () => {
    const { dependencies, events } = createDependencies();

    const result = await captureTradingView(dependencies, new AbortController().signal);

    expect(result).toEqual(processed);
    expect(events).toEqual(['hide', 'capture:capture-visible-tab', 'process', 'restore']);
    expect(dependencies.captureVisibleTab).toHaveBeenCalledTimes(1);
  });

  it('restores the panel when visible-tab capture fails', async () => {
    const { dependencies, events } = createDependencies();
    dependencies.captureVisibleTab = vi.fn(async () => {
      events.push('capture');
      return { ok: false, error: 'capture unavailable' } as const;
    });

    await expect(captureTradingView(dependencies, new AbortController().signal))
      .rejects.toThrow('capture unavailable');
    expect(events).toEqual(['hide', 'capture', 'restore']);
  });

  it('restores the panel when image processing fails', async () => {
    const { dependencies, events } = createDependencies();
    dependencies.processImage = vi.fn(async () => {
      events.push('process');
      throw new Error('decode failed');
    });

    await expect(captureTradingView(dependencies, new AbortController().signal))
      .rejects.toThrow('decode failed');
    expect(events).toEqual(['hide', 'capture:capture-visible-tab', 'process', 'restore']);
  });

  it('propagates cancellation after capture and restores without processing', async () => {
    const controller = new AbortController();
    const { dependencies, events } = createDependencies();
    dependencies.captureVisibleTab = vi.fn(async () => {
      events.push('capture');
      controller.abort(new DOMException('Cancelled', 'AbortError'));
      return { ok: true, dataUrl: 'data:image/png;base64,Y2FwdHVyZWQ=' } as const;
    });

    await expect(captureTradingView(dependencies, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(events).toEqual(['hide', 'capture', 'restore']);
    expect(dependencies.processImage).not.toHaveBeenCalled();
    expect(dependencies.captureVisibleTab).toHaveBeenCalledTimes(1);
  });

  it('does not hide or capture when already cancelled', async () => {
    const controller = new AbortController();
    const { dependencies } = createDependencies();
    controller.abort(new DOMException('Cancelled', 'AbortError'));

    await expect(captureTradingView(dependencies, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(dependencies.hidePanel).not.toHaveBeenCalled();
    expect(dependencies.captureVisibleTab).not.toHaveBeenCalled();
  });
});
