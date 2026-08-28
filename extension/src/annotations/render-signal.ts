import type { CommunityReportV3 } from '../analysis/stages/community-report-v3-schema';
import type { ProcessedImage } from '../capture/image-types';
import type { PresentationDrawing } from '../presentation/report-presentation-model';
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
type TradeSignal = CommunityReportV3['tradeSignals'][number];

type RenderableSignal = {
  id: string;
  direction: 'long' | 'short';
  entry: { priceLabel: string; xRatio: number; yRatio: number };
  stopLoss: { priceLabel: string; yRatio: number };
  takeProfits: Array<{ priceLabel: string; yRatio: number }>;
  riskReward: string | null;
};

type SignalLabel = {
  key: string;
  originalOrder: number;
  preferredBaseline: number;
};

function packLabelBaselines(labels: readonly SignalLabel[], height: number): ReadonlyMap<string, number> {
  const maximum = height - LABEL_BOTTOM_PADDING;
  const sorted = [...labels].sort((left, right) => (
    left.preferredBaseline - right.preferredBaseline || left.originalOrder - right.originalOrder
  ));
  const baselines: number[] = [];

  for (const label of sorted) {
    const previous = baselines.at(-1) ?? Number.NEGATIVE_INFINITY;
    baselines.push(Math.max(LABEL_MIN_Y, label.preferredBaseline, previous + LABEL_SPACING));
  }

  if (baselines.at(-1)! > maximum) {
    baselines[baselines.length - 1] = maximum;
    for (let index = baselines.length - 2; index >= 0; index -= 1) {
      baselines[index] = Math.min(baselines[index]!, baselines[index + 1]! - LABEL_SPACING);
    }
  }

  return new Map(sorted.map((label, index) => [label.key, baselines[index]!]));
}

function drawPriceLine(
  surface: AnnotationSurface,
  image: ProcessedImage,
  yRatio: number,
  color: string,
  label: string,
  labelY: number,
): void {
  const y = ratioToDrawablePixel(yRatio, image.height, PRICE_LINE_MARGIN);
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
  signal: RenderableSignal,
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

async function renderSignalShape(
  image: ProcessedImage,
  signal: RenderableSignal,
  dependencies: AnnotationCanvasDependencies = browserAnnotationCanvasDependencies,
): Promise<AnnotatedImage> {
  const dataUrl = await drawOnSourceImage(image, dependencies, (surface) => {
    const priceLabels = [
      {
        key: 'entry', yRatio: signal.entry.yRatio, color: ENTRY_COLOR,
        text: `Entry ${signal.entry.priceLabel}`,
      },
      {
        key: 'stop', yRatio: signal.stopLoss.yRatio, color: STOP_COLOR,
        text: `Stop ${signal.stopLoss.priceLabel}`,
      },
      ...signal.takeProfits.slice(0, 3).map((target, index) => ({
        key: `target-${index}`, yRatio: target.yRatio, color: TARGET_COLOR,
        text: `Target ${index + 1} ${target.priceLabel}`,
      })),
    ];
    const labels: SignalLabel[] = [
      ...priceLabels.map((label, originalOrder) => ({
        key: label.key,
        originalOrder,
        preferredBaseline: ratioToDrawablePixel(label.yRatio, image.height, PRICE_LINE_MARGIN) - 6,
      })),
      {
        key: 'risk-reward',
        originalOrder: priceLabels.length,
        preferredBaseline: image.height - 12,
      },
    ];
    const labelBaselines = packLabelBaselines(labels, image.height);

    priceLabels.forEach((label) => {
      drawPriceLine(
        surface,
        image,
        label.yRatio,
        label.color,
        label.text,
        labelBaselines.get(label.key)!,
      );
    });
    drawDirectionArrow(surface, image, signal);
    surface.fillText(
      `Risk/reward ${signal.riskReward ?? 'Not provided'}`,
      12,
      labelBaselines.get('risk-reward')!,
    );
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

export async function renderSignal(
  image: ProcessedImage,
  signal: TradeSignal,
  dependencies: AnnotationCanvasDependencies = browserAnnotationCanvasDependencies,
): Promise<AnnotatedImage> {
  return renderSignalShape(image, signal, dependencies);
}

export async function renderPresentationSignal(
  image: ProcessedImage,
  drawings: readonly PresentationDrawing[],
  dependencies: AnnotationCanvasDependencies = browserAnnotationCanvasDependencies,
): Promise<AnnotatedImage | null> {
  const entry = drawings.find((drawing) => (
    drawing.layer === 'signal'
    && (drawing.meaning === 'long_entry' || drawing.meaning === 'short_entry')
    && drawing.tool === 'entry_arrow'
  ));
  const stop = drawings.find((drawing) => drawing.meaning === 'stop' && drawing.tool === 'stop_line');
  const targets = drawings.filter((drawing) => drawing.meaning === 'target' && drawing.tool === 'target_line');
  const entryPoint = entry?.points[0];
  const stopPoint = stop?.points[0];
  if (!entry || !entryPoint || entryPoint.xRatio === null || !stopPoint || targets.length === 0) return null;
  const targetPoints = targets.map((drawing) => drawing.points[0]).filter((point) => point !== undefined);
  if (targetPoints.length !== targets.length) return null;

  return renderSignalShape(image, {
    id: entry.refId,
    direction: entry.meaning === 'long_entry' ? 'long' : 'short',
    entry: {
      priceLabel: entryPoint.priceLabel ?? '',
      xRatio: entryPoint.xRatio,
      yRatio: entryPoint.yRatio,
    },
    stopLoss: { priceLabel: stopPoint.priceLabel ?? '', yRatio: stopPoint.yRatio },
    takeProfits: targetPoints.map((point) => ({
      priceLabel: point.priceLabel ?? '', yRatio: point.yRatio,
    })),
    riskReward: entry.caption,
  }, dependencies);
}
