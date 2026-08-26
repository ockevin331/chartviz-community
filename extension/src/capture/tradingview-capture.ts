import type { ProcessedImage } from './image-types';

export type CaptureCommand = { type: 'capture-visible-tab' };
export type CaptureReply =
  | { ok: true; dataUrl: string }
  | { ok: false; error: string };

export type CaptureDependencies = {
  pageUrl: string;
  hidePanel(signal: AbortSignal): Promise<void>;
  restorePanel(): Promise<void>;
  captureVisibleTab(command: CaptureCommand): Promise<CaptureReply>;
  processImage(input: Blob): Promise<ProcessedImage>;
  dataUrlToBlob?: (dataUrl: string) => Blob;
};

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) {
    return;
  }
  if (signal.reason instanceof Error) {
    throw signal.reason;
  }
  throw new DOMException('Cancelled', 'AbortError');
}

export function isTradingViewChartUrl(value: string) {
  try {
    const url = new URL(value);
    const tradingViewHost = url.hostname === 'tradingview.com'
      || url.hostname.endsWith('.tradingview.com');
    return url.protocol === 'https:' && tradingViewHost && url.pathname.startsWith('/chart/');
  } catch {
    return false;
  }
}

function capturedDataUrlToBlob(dataUrl: string) {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match) {
    throw new Error('Visible-tab capture returned an invalid image');
  }

  const mediaType = match[1];
  const encodedData = match[2];
  if (!mediaType || encodedData === undefined) {
    throw new Error('Visible-tab capture returned an invalid image');
  }
  const decoded = atob(encodedData);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return new Blob([bytes], { type: mediaType });
}

export async function captureTradingView(
  dependencies: CaptureDependencies,
  signal: AbortSignal,
): Promise<ProcessedImage> {
  if (!isTradingViewChartUrl(dependencies.pageUrl)) {
    throw new Error('Open a TradingView chart before capturing');
  }
  throwIfAborted(signal);

  try {
    await dependencies.hidePanel(signal);
    throwIfAborted(signal);

    const reply = await dependencies.captureVisibleTab({ type: 'capture-visible-tab' });
    throwIfAborted(signal);
    if (!reply.ok) {
      throw new Error(reply.error);
    }

    const image = (dependencies.dataUrlToBlob ?? capturedDataUrlToBlob)(reply.dataUrl);
    throwIfAborted(signal);
    const processed = await dependencies.processImage(image);
    throwIfAborted(signal);
    return processed;
  } finally {
    await dependencies.restorePanel();
  }
}
