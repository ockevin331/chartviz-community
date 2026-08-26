import type { ProcessedImage } from '../capture/image-types';

export type AnnotationSurface = {
  drawSource(source: unknown, width: number, height: number): void;
  setStrokeStyle(color: string): void;
  setFillStyle(color: string): void;
  setLineWidth(width: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  stroke(): void;
  fill(): void;
  fillText(text: string, x: number, y: number): void;
  encode(): Promise<string>;
};

export type DecodedAnnotationImage = {
  source: unknown;
  dispose(): void;
};

export type AnnotationCanvasDependencies = {
  decode(dataUrl: string): Promise<DecodedAnnotationImage>;
  createSurface(width: number, height: number): AnnotationSurface;
};

function createBrowserSurface(width: number, height: number): AnnotationSurface {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Annotation canvas is unavailable');
  }
  context.font = 'bold 14px sans-serif';
  context.lineCap = 'round';
  context.lineJoin = 'round';

  return {
    drawSource(source, targetWidth, targetHeight) {
      context.drawImage(source as CanvasImageSource, 0, 0, targetWidth, targetHeight);
    },
    setStrokeStyle(color) {
      context.strokeStyle = color;
    },
    setFillStyle(color) {
      context.fillStyle = color;
    },
    setLineWidth(lineWidth) {
      context.lineWidth = lineWidth;
    },
    beginPath: () => context.beginPath(),
    moveTo: (x, y) => context.moveTo(x, y),
    lineTo: (x, y) => context.lineTo(x, y),
    closePath: () => context.closePath(),
    stroke: () => context.stroke(),
    fill: () => context.fill(),
    fillText: (text, x, y) => context.fillText(text, x, y),
    encode: async () => canvas.toDataURL('image/png'),
  };
}

export const browserAnnotationCanvasDependencies: AnnotationCanvasDependencies = {
  decode(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onerror = () => reject(new Error('Annotation source image could not be decoded'));
      image.onload = () => resolve({ source: image, dispose: () => undefined });
      image.src = dataUrl;
    });
  },
  createSurface: createBrowserSurface,
};

export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function ratioToPixel(value: number, length: number): number {
  return clampRatio(value) * length;
}

export function clampPixel(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export async function drawOnSourceImage(
  image: ProcessedImage,
  dependencies: AnnotationCanvasDependencies,
  drawOverlay: (surface: AnnotationSurface) => void,
): Promise<string> {
  const surface = dependencies.createSurface(image.width, image.height);
  const decoded = await dependencies.decode(image.dataUrl);
  try {
    surface.drawSource(decoded.source, image.width, image.height);
    drawOverlay(surface);
    return await surface.encode();
  } finally {
    decoded.dispose();
  }
}
