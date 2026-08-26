import type { TradeSignal } from '../analysis/community-report';
import type { ProcessedImage } from '../capture/image-types';
import type { AnnotatedImage } from './annotation-types';
import {
  browserAnnotationCanvasDependencies,
  clampPixel,
  drawOnSourceImage,
  ratioToDrawablePixel,
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
const PRICE_LINE_MARGIN = 0.75;
const ARROW_STROKE_MARGIN = 1.5;
const LABEL_MIN_Y = 16;
const LABEL_BOTTOM_PADDING = 8;
const LABEL_SPACING = 18;

function textLanePosition(preferredY: number, height: number, occupied: readonly number[]): number {
  const maximum = Math.max(LABEL_MIN_Y, height - LABEL_BOTTOM_PADDING);
  const base = clampPixel(preferredY, LABEL_MIN_Y, maximum);

  for (let step = 0; step <= occupied.length; step += 1) {
    const candidates = step === 0
      ? [base]
      : [base + step * LABEL_SPACING, base - step * LABEL_SPACING];
    for (const candidate of candidates) {
      if (
        candidate >= LABEL_MIN_Y
        && candidate <= maximum
        && occupied.every((position) => Math.abs(position - candidate) >= LABEL_SPACING)
      ) {
        return candidate;
      }
    }
  }

  return base;
}

function drawPriceLine(
  surface: AnnotationSurface,
  image: ProcessedImage,
  yRatio: number,
  color: string,
  label: string,
  occupiedTextLanes: number[],
): void {
  const y = ratioToDrawablePixel(yRatio, image.height, PRICE_LINE_MARGIN);
  const labelY = textLanePosition(y - 6, image.height, occupiedTextLanes);
  occupiedTextLanes.push(labelY);
  surface.setStrokeStyle(color);
  surface.setFillStyle(color);
  surface.setLineWidth(1.5);
  surface.beginPath();
  surface.moveTo(PRICE_LINE_MARGIN, y);
  surface.lineTo(image.width - PRICE_LINE_MARGIN, y);
  surface.stroke();
  surface.fillText(label, 12, labelY);
}

function drawDirectionArrow(
  surface: AnnotationSurface,
  image: ProcessedImage,
  signal: TradeSignal,
): void {
  const direction = signal.direction === 'long' ? 1 : -1;
  const x = ratioToDrawablePixel(
    signal.entry.xRatio,
    image.width,
    ARROW_STROKE_MARGIN + ARROW_HEAD_HALF_WIDTH,
  );
  const rawTipY = ratioToPixel(signal.entry.yRatio, image.height);
  const minimumTipY = ARROW_STROKE_MARGIN + (signal.direction === 'short' ? ARROW_LENGTH : 0);
  const maximumTipY = image.height - ARROW_STROKE_MARGIN - (signal.direction === 'long' ? ARROW_LENGTH : 0);
  const tipY = clampPixel(rawTipY, minimumTipY, maximumTipY);
  const bodyY = tipY + direction * ARROW_LENGTH;
  const headY = tipY + direction * ARROW_HEAD_HEIGHT;
  const leftX = x - ARROW_HEAD_HALF_WIDTH;
  const rightX = x + ARROW_HEAD_HALF_WIDTH;
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
    const occupiedTextLanes: number[] = [];
    drawPriceLine(
      surface,
      image,
      signal.entry.yRatio,
      ENTRY_COLOR,
      `Entry ${signal.entry.priceLabel}`,
      occupiedTextLanes,
    );
    drawPriceLine(
      surface,
      image,
      signal.stop.yRatio,
      STOP_COLOR,
      `Stop ${signal.stop.priceLabel}`,
      occupiedTextLanes,
    );
    signal.targets.forEach((target, index) => {
      drawPriceLine(
        surface,
        image,
        target.yRatio,
        TARGET_COLOR,
        `Target ${index + 1} ${target.priceLabel}`,
        occupiedTextLanes,
      );
    });
    drawDirectionArrow(surface, image, signal);
    const riskRewardY = textLanePosition(image.height - 12, image.height, occupiedTextLanes);
    surface.fillText(`Risk/reward ${signal.riskReward ?? 'Not provided'}`, 12, riskRewardY);
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
