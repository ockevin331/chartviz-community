import { describe, expect, it, vi } from 'vitest';
import { createBackgroundHandlers, type BackgroundDependencies } from '../entrypoints/background';
import { createActiveChartClient } from '../src/capture/active-chart';
import type { ProcessedImage } from '../src/capture/image-types';
import type { ChartContext } from '../src/domain/chart-context';

const context: ChartContext = {
  site: 'tradingview', pageType: 'advanced-chart',
  url: 'https://www.tradingview.com/chart/3c8vMvO3/?symbol=BITSTAMP%3ABTCUSD',
  symbol: 'BTCUSD', exchange: 'BITSTAMP', timeframe: '15m',
  chart: { id: 'Chart #1', bounds: { x: 10, y: 60, width: 1100, height: 650 } },
  viewport: { width: 1280, height: 800, devicePixelRatio: 2 },
};

const processed: ProcessedImage = {
  mediaType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,cHJvY2Vzc2Vk', width: 1100, height: 650,
};

function fixture() {
  const croppedBlob = new Blob(['cropped'], { type: 'image/png' });
  const sendMessage = vi.fn(async (message: { type: string }) => {
    if (message.type === 'chartviz/active-chart/inspect') return { ok: true, context };
    return { ok: true, context, previewDataUrl: 'data:image/png;base64,Y3JvcHBlZA==' };
  });
  const dataUrlToBlob = vi.fn(() => croppedBlob);
  const processImage = vi.fn(async (blob: Blob) => {
    expect(blob).toBe(croppedBlob);
    return processed;
  });
  return { client: createActiveChartClient({ sendMessage, dataUrlToBlob, processImage }), sendMessage, dataUrlToBlob, processImage };
}

describe('active chart client', () => {
  it('inspects and captures with context through exact background messages', async () => {
    const { client, sendMessage, dataUrlToBlob, processImage } = fixture();

    await expect(client.inspect()).resolves.toEqual(context);
    await expect(client.capture(new AbortController().signal)).resolves.toEqual({ image: processed, context });

    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: 'chartviz/active-chart/inspect' });
    expect(sendMessage).toHaveBeenNthCalledWith(2, { type: 'chartviz/active-chart/capture' });
    expect(dataUrlToBlob).toHaveBeenCalledWith('data:image/png;base64,Y3JvcHBlZA==');
    expect(processImage).toHaveBeenCalledTimes(1);
  });

  it('surfaces bounded background failures', async () => {
    const client = createActiveChartClient({
      sendMessage: async () => ({ ok: false, error: 'This page is not a supported chart URL.' }),
      dataUrlToBlob: () => new Blob(),
      processImage: async () => processed,
    });

    await expect(client.inspect()).rejects.toThrow('This page is not a supported chart URL.');
    await expect(client.capture(new AbortController().signal)).rejects.toThrow('This page is not a supported chart URL.');
  });

  it('preserves structured chart availability failures for the panel', async () => {
    const client = createActiveChartClient({
      sendMessage: async () => ({
        ok: false,
        error: 'This page is not a supported chart URL.',
        availability: {
          code: 'unsupported_url',
          site: 'binance',
          siteName: 'Binance',
          exampleUrl: 'https://www.binance.com/en/trade/BTC_USDT?type=spot',
        },
      }),
      dataUrlToBlob: () => new Blob(),
      processImage: async () => processed,
    });

    await expect(client.inspect()).rejects.toMatchObject({
      name: 'ChartAvailabilityError',
      availability: { code: 'unsupported_url', site: 'binance' },
    });
  });

  it('does not message or process when capture is already cancelled', async () => {
    const { client, sendMessage, processImage } = fixture();
    const controller = new AbortController();
    controller.abort(new DOMException('Cancelled', 'AbortError'));

    await expect(client.capture(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(processImage).not.toHaveBeenCalled();
  });

  it('stops before processing when cancelled after the background response', async () => {
    const controller = new AbortController();
    const processImage = vi.fn(async () => processed);
    const client = createActiveChartClient({
      sendMessage: async () => {
        controller.abort(new DOMException('Cancelled', 'AbortError'));
        return { ok: true, context, previewDataUrl: 'data:image/png;base64,Y3JvcHBlZA==' };
      },
      dataUrlToBlob: () => new Blob(['cropped'], { type: 'image/png' }),
      processImage,
    });

    await expect(client.capture(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(processImage).not.toHaveBeenCalled();
  });

  it('converts all labeled multi-timeframe captures in response order', async () => {
    const frames = ['4h', '1h', '15m'] as const;
    const processImage = vi.fn(async (blob: Blob) => ({
      ...processed,
      dataUrl: `data:image/jpeg;base64,${btoa(await blob.text())}`,
    }));
    const client = createActiveChartClient({
      sendMessage: async () => ({
        ok: true,
        context: { ...context, timeframe: '4h' },
        previewDataUrl: 'data:image/png;base64,NGg=',
        captures: frames.map((timeframe) => ({
          timeframe,
          context: { ...context, timeframe },
          previewDataUrl: `data:image/png;base64,${btoa(timeframe)}`,
        })),
      }),
      dataUrlToBlob: (dataUrl) => new Blob([atob(dataUrl.split(',')[1]!)], { type: 'image/png' }),
      processImage,
    });

    const captures = await client.captureMany(frames, new AbortController().signal);

    expect(captures.map((capture) => capture.context.timeframe)).toEqual(frames);
    expect(captures.map((capture) => atob(capture.image.dataUrl.split(',')[1]!))).toEqual(frames);
    expect(processImage).toHaveBeenCalledTimes(3);
  });

  it('rejects incomplete multi-capture responses before processing images', async () => {
    const processImage = vi.fn(async () => processed);
    const client = createActiveChartClient({
      sendMessage: async () => ({
        ok: true,
        context,
        previewDataUrl: 'data:image/png;base64,MTVt',
        captures: [{ timeframe: '4h', context: { ...context, timeframe: '4h' }, previewDataUrl: 'data:image/png;base64,NGg=' }],
      }),
      dataUrlToBlob: () => new Blob(),
      processImage,
    });

    await expect(client.captureMany(['4h', '1h', '15m'], new AbortController().signal))
      .rejects.toThrow('complete ordered capture set');
    expect(processImage).not.toHaveBeenCalled();
  });
});

function backgroundFixture(initialTimeframe = '5m') {
  let timeframe = initialTimeframe;
  let captureNumber = 0;
  const sendTabMessage = vi.fn<BackgroundDependencies['sendTabMessage']>(async (_tabId, message) => {
    const record = message as { type: string; timeframe?: string; visible?: boolean };
    if (record.type === 'chartviz/chart/timeframe') {
      timeframe = record.timeframe!;
      return { ok: true, context: { ...context, timeframe } };
    }
    if (record.type === 'chartviz/chart/ready') {
      return { ok: true, context: { ...context, timeframe } };
    }
    if (record.type === 'chartviz/panel/visibility') {
      return { ok: true, visible: record.visible };
    }
    return undefined;
  });
  const dependencies: BackgroundDependencies = {
    getActiveTab: async () => ({ id: 17, windowId: 23, url: context.url }),
    sendTabMessage,
    captureVisibleTab: vi.fn(async () => `data:image/png;base64,c2NyZWVuLS${captureNumber += 1}`),
    cropScreenshot: vi.fn(async () => new Blob([timeframe], { type: 'image/png' })),
    blobToDataUrl: vi.fn(async () => `data:image/png;base64,${btoa(timeframe)}`),
    injectContentScript: vi.fn(async () => undefined),
    wait: vi.fn(async () => undefined),
  };
  return { dependencies, sendTabMessage, handlers: createBackgroundHandlers(dependencies) };
}

describe('multi-timeframe background capture', () => {
  it('captures three timeframes in requested order and restores the original timeframe', async () => {
    const { dependencies, handlers, sendTabMessage } = backgroundFixture('5m');

    const response = await handlers.onMessage({
      type: 'chartviz/active-chart/capture',
      timeframes: ['4h', '1h', '15m'],
    });

    expect(response).toMatchObject({
      ok: true,
      context: { timeframe: '4h' },
      captures: [
        { timeframe: '4h', context: { timeframe: '4h' } },
        { timeframe: '1h', context: { timeframe: '1h' } },
        { timeframe: '15m', context: { timeframe: '15m' } },
      ],
    });
    expect(dependencies.captureVisibleTab).toHaveBeenCalledTimes(3);
    expect(sendTabMessage.mock.calls
      .filter(([, message]) => message.type === 'chartviz/chart/timeframe')
      .map(([, message]) => 'timeframe' in message ? message.timeframe : null)).toEqual(['4h', '1h', '15m', '5m']);
    expect(sendTabMessage.mock.calls
      .filter(([, message]) => message.type === 'chartviz/panel/visibility')
      .map(([, message]) => 'visible' in message ? message.visible : null)).toEqual([false, true, false, true, false, true]);
  });

  it('returns no partial captures and restores the original timeframe after a failed switch', async () => {
    const { dependencies, handlers, sendTabMessage } = backgroundFixture('15m');
    sendTabMessage.mockImplementation(async (_tabId, message) => {
      if (message.type === 'chartviz/chart/timeframe' && message.timeframe === '1h') {
        return { ok: false, error: 'The chart did not switch to 1h.' };
      }
      if (message.type === 'chartviz/chart/timeframe') return { ok: true, context: { ...context, timeframe: message.timeframe } };
      if (message.type === 'chartviz/chart/ready') {
        const lastSwitchTimeframe = [...sendTabMessage.mock.calls].reverse()
          .map(([, call]) => call.type === 'chartviz/chart/timeframe' ? call.timeframe : null)
          .find((value) => value !== null && value !== '1h');
        return { ok: true, context: { ...context, timeframe: lastSwitchTimeframe ?? '15m' } };
      }
      if (message.type === 'chartviz/panel/visibility') return { ok: true, visible: message.visible };
      return undefined;
    });

    const response = await handlers.onMessage({
      type: 'chartviz/active-chart/capture',
      timeframes: ['4h', '1h', '15m'],
    });

    expect(response).toEqual({ ok: false, error: 'The chart did not switch to 1h.' });
    expect(response).not.toHaveProperty('captures');
    expect(dependencies.captureVisibleTab).toHaveBeenCalledTimes(1);
    expect(sendTabMessage.mock.calls
      .filter(([, message]) => message.type === 'chartviz/chart/timeframe')
      .at(-1)?.[1]).toMatchObject({ timeframe: '15m' });
  });

  it.each([
    ['duplicate', ['4h', '4h']],
    ['too many', ['5m', '15m', '1h', '4h']],
    ['unknown', ['4h', '2h']],
  ])('rejects %s timeframe input before changing or capturing the page', async (_name, timeframes) => {
    const { dependencies, handlers, sendTabMessage } = backgroundFixture('5m');

    const response = await handlers.onMessage({
      type: 'chartviz/active-chart/capture',
      timeframes,
    });

    expect(response).toMatchObject({ ok: false });
    expect(sendTabMessage).not.toHaveBeenCalled();
    expect(dependencies.captureVisibleTab).not.toHaveBeenCalled();
  });
});
