import type { ProcessedImage } from './image-types';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2048;
const INPUT_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export type DecodedImage = {
  source: unknown;
  width: number;
  height: number;
  dispose(): void;
};

export type ImageCanvas = {
  width: number;
  height: number;
  draw(source: unknown, width: number, height: number): void;
  hasTransparency(): boolean;
  encode(mediaType: ProcessedImage['mediaType'], quality?: number): Promise<Blob>;
};

export type ImageProcessingDependencies = {
  decode(input: Blob): Promise<DecodedImage>;
  createCanvas(width: number, height: number): ImageCanvas;
  blobToDataUrl(blob: Blob): Promise<string>;
};

function decodedDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid image dimensions');
  }

  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function createBrowserCanvas(width: number, height: number): ImageCanvas {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Image canvas is unavailable');
  }

  return {
    width,
    height,
    draw(source, targetWidth, targetHeight) {
      context.drawImage(source as CanvasImageSource, 0, 0, targetWidth, targetHeight);
    },
    hasTransparency() {
      const pixels = context.getImageData(0, 0, width, height).data;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] !== 255) {
          return true;
        }
      }
      return false;
    },
    encode(mediaType, quality) {
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Image encoding failed'));
          }
        }, mediaType, quality);
      });
    },
  };
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Image encoding failed'));
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Image encoding failed'));
      }
    };
    reader.readAsDataURL(blob);
  });
}

const browserDependencies: ImageProcessingDependencies = {
  async decode(input) {
    const bitmap = await createImageBitmap(input);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    };
  },
  createCanvas: createBrowserCanvas,
  blobToDataUrl: readBlobAsDataUrl,
};

export async function processImage(
  input: Blob,
  dependencies: ImageProcessingDependencies = browserDependencies,
): Promise<ProcessedImage> {
  if (!INPUT_MEDIA_TYPES.has(input.type)) {
    throw new Error('Image must be PNG, JPEG, or WebP');
  }
  if (input.size > MAX_IMAGE_BYTES) {
    throw new Error('Image must be no larger than 10 MB');
  }

  let decoded: DecodedImage;
  try {
    decoded = await dependencies.decode(input);
  } catch {
    throw new Error('Invalid image');
  }

  try {
    const dimensions = decodedDimensions(decoded.width, decoded.height);
    const canvas = dependencies.createCanvas(dimensions.width, dimensions.height);
    canvas.draw(decoded.source, dimensions.width, dimensions.height);

    const transparent = canvas.hasTransparency();
    const mediaType = transparent ? 'image/png' : 'image/jpeg';
    const encoded = await canvas.encode(mediaType, transparent ? undefined : 0.90);
    const dataUrl = await dependencies.blobToDataUrl(encoded);

    return { mediaType, dataUrl, ...dimensions };
  } finally {
    decoded.dispose();
  }
}
