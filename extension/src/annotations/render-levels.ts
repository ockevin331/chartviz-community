import type { ProcessedImage } from '../capture/image-types';
import type { PresentationDrawing } from '../presentation/report-presentation-model';
import type { AnnotatedImage } from './annotation-types';
import {
  browserAnnotationCanvasDependencies,
  clampPixel,
  drawOnSourceImage,
  ratioToDrawablePixel,
  type AnnotationCanvasDependencies,
} from './canvas-surface';

const COLORS = {
  support: '#16a34a',
  resistance: '#dc2626',
} as const;
const LABEL_MIN_Y = 16;
const LABEL_SPACING = 18;
const LABEL_BOTTOM_PADDING = 8;
const LINE_MARGIN = 1;

function labelPosition(rawY: number, height: number, occupied: number[]): number {
  const maximum = Math.max(LABEL_MIN_Y, height - LABEL_BOTTOM_PADDING);
  const base = clampPixel(rawY, LABEL_MIN_Y, maximum);

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

export async function renderPresentationLevels(
  image: ProcessedImage,
  drawings: readonly PresentationDrawing[],
  dependencies: AnnotationCanvasDependencies = browserAnnotationCanvasDependencies,
): Promise<AnnotatedImage | null> {
  const levels = drawings.filter((drawing) => (
    drawing.layer === 'levels'
    && (drawing.meaning === 'support' || drawing.meaning === 'resistance')
    && (drawing.tool === 'horizontal_line' || drawing.tool === 'zone')
  ));
  if (levels.length === 0) return null;

  const supportLabels: number[] = [];
  const resistanceLabels: number[] = [];
  const dataUrl = await drawOnSourceImage(image, dependencies, (surface) => {
    const ordinal = { support: 0, resistance: 0 };
    for (const drawing of levels) {
      const type = drawing.meaning as 'support' | 'resistance';
      ordinal[type] += 1;
      const occupied = type === 'support' ? supportLabels : resistanceLabels;
      drawing.points.forEach((point, pointIndex) => {
        const lineY = ratioToDrawablePixel(point.yRatio, image.height, LINE_MARGIN);
        surface.setStrokeStyle(COLORS[type]);
        surface.setFillStyle(COLORS[type]);
        surface.setLineWidth(2);
        surface.beginPath();
        surface.moveTo(LINE_MARGIN, lineY);
        surface.lineTo(image.width - LINE_MARGIN, lineY);
        surface.stroke();
        if (pointIndex > 0) return;
        const textY = labelPosition(lineY, image.height, occupied);
        occupied.push(textY);
        const prefix = type === 'support' ? 'S' : 'R';
        surface.fillText(`${prefix}${ordinal[type]} ${point.priceLabel ?? ''}`.trim(), 12, textY);
      });
    }
  });

  return {
    id: 'levels', kind: 'levels', title: 'Support and resistance',
    dataUrl, width: image.width, height: image.height,
  };
}
