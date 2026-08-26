import type { ChartContext } from '../../domain/chart-context';

export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function bitmapCropRect(
  context: ChartContext,
  bitmapWidth: number,
  bitmapHeight: number,
): CropRect {
  const scaleX = bitmapWidth / context.viewport.width;
  const scaleY = bitmapHeight / context.viewport.height;
  const bounds = context.chart.bounds;

  const x = Math.max(0, Math.floor(bounds.x * scaleX));
  const y = Math.max(0, Math.floor(bounds.y * scaleY));
  const right = Math.min(bitmapWidth, Math.ceil((bounds.x + bounds.width) * scaleX));
  const bottom = Math.min(
    bitmapHeight,
    Math.ceil((bounds.y + bounds.height) * scaleY),
  );

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

export async function cropScreenshot(
  screenshotDataUrl: string,
  context: ChartContext,
): Promise<Blob> {
  const sourceBlob = await (await fetch(screenshotDataUrl)).blob();
  const bitmap = await createImageBitmap(sourceBlob);

  try {
    const crop = bitmapCropRect(context, bitmap.width, bitmap.height);
    if (crop.width < 640 || crop.height < 360) {
      throw new Error('The cropped chart is too small for reliable analysis.');
    }

    const canvas = new OffscreenCanvas(crop.width, crop.height);
    const drawContext = canvas.getContext('2d');
    if (!drawContext) throw new Error('Unable to create a screenshot canvas.');

    drawContext.drawImage(
      bitmap,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );

    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    bitmap.close();
  }
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return `data:${blob.type};base64,${btoa(binary)}`;
}
