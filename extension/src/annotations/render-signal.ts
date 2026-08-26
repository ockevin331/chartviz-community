import type { TradeSignal } from '../analysis/community-report';
import type { ProcessedImage } from '../capture/image-types';
import type { AnnotatedImage } from './annotation-types';
import {
  browserAnnotationCanvasDependencies,
  clampPixel,
  drawOnSourceImage,
  ratioToPixel,
  type AnnotationCanvasDependencies,
  type AnnotationSurface,
} from './canvas-surface';

const ENTRY_COLOR = '#2563eb';
const STOP_COLOR = '#dc2626';
const TARGET_COLOR = '#16a34a';
const ARROW_LENGTH = 30;
const ARROW_HEAD_HEIGHT = 8;
const ARROW_HEAD_HALF_WIDTH = 6;

function drawPriceLine(
  surface: AnnotationSurface,
  image: ProcessedImage,
  yRatio: number,
  color: string,
  label: string,
): void {
  const y = ratioToPixel(yRatio, image.height);
  const labelY = clampPixel(y - 6, 16, Math.max(16, image.height - 8));
  surface.setStrokeStyle(color);
  surface.setFillStyle(color);
  surface.setLineWidth(1.5);
  surface.beginPath();
  surface.moveTo(0, y);
  surface.lineTo(image.width, y);
  surface.stroke();
  surface.fillText(label, 12, labelY);
}

function drawDirectionArrow(
  surface: AnnotationSurface,
  image: ProcessedImage,
  signal: TradeSignal,
): void {
  const x = ratioToPixel(signal.entry.xRatio, image.width);
  const tipY = ratioToPixel(signal.entry.yRatio, image.height);
  const direction = signal.direction === 'long' ? 1 : -1;
  const bodyY = clampPixel(tipY + direction * ARROW_LENGTH, 0, image.height);
  const headY = clampPixel(tipY + direction * ARROW_HEAD_HEIGHT, 0, image.height);
  const leftX = clampPixel(x - ARROW_HEAD_HALF_WIDTH, 0, image.width);
  const rightX = clampPixel(x + ARROW_HEAD_HALF_WIDTH, 0, image.width);
  const labelX = clampPixel(x + 12, 0, Math.max(0, image.width - 72));
  const labelY = clampPixel(
    signal.direction === 'long' ? bodyY : bodyY - 6,
    16,
    Math.max(16, image.height - 8),
  );

  surface.setStrokeStyle(TARGET_COLOR);
  surface.setFillStyle(TARGET_COLOR);
  surface.setLineWidth(3);
  surface.beginPath();
  surface.moveTo(x, bodyY);
  surface.lineTo(x, tipY);
  surface.stroke();
  surface.beginPath();
  surface.moveTo(leftX, headY);
  surface.lineTo(x, tipY);
  surface.lineTo(rightX, headY);
  surface.stroke();
  surface.fillText(signal.direction.toUpperCase(), labelX, labelY);
}

export async function renderSignal(
  image: ProcessedImage,
  signal: TradeSignal,
  dependencies: AnnotationCanvasDependencies = browserAnnotationCanvasDependencies,
): Promise<AnnotatedImage> {
  const dataUrl = await drawOnSourceImage(image, dependencies, (surface) => {
    drawPriceLine(surface, image, signal.entry.yRatio, ENTRY_COLOR, `Entry ${signal.entry.priceLabel}`);
    drawPriceLine(surface, image, signal.stop.yRatio, STOP_COLOR, `Stop ${signal.stop.priceLabel}`);
    signal.targets.forEach((target, index) => {
      drawPriceLine(surface, image, target.yRatio, TARGET_COLOR, `Target ${index + 1} ${target.priceLabel}`);
    });
    drawDirectionArrow(surface, image, signal);
    surface.fillText(`Risk/reward ${signal.riskReward ?? 'Not provided'}`, 12, Math.max(16, image.height - 12));
  });

  return {
    id: signal.id,
    kind: 'signal',
    title: `${signal.direction.toUpperCase()} signal`,
    dataUrl,
    width: image.width,
    height: image.height,
  };
}
