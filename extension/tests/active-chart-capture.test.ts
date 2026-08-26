import { describe, expect, it, vi } from 'vitest';
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
});
