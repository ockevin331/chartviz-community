import type { Level } from '../analysis/community-report';
import type { ProcessedImage } from '../capture/image-types';
import type { AnnotatedImage } from './annotation-types';
import {
  browserAnnotationCanvasDependencies,
  clampPixel,
  drawOnSourceImage,
  ratioToPixel,
  type AnnotationCanvasDependencies,
} from './canvas-surface';

const COLORS = {
  support: '#16a34a',
  resistance: '#dc2626',
} as const;
const LABEL_MIN_Y = 16;
const LABEL_SPACING = 18;
const LABEL_BOTTOM_PADDING = 8;

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

export async function renderLevels(
  image: ProcessedImage,
  levels: readonly Level[],
  dependencies: AnnotationCanvasDependencies = browserAnnotationCanvasDependencies,
): Promise<AnnotatedImage | null> {
  if (levels.length === 0) {
    return null;
  }

  const supportLabels: number[] = [];
  const resistanceLabels: number[] = [];
  const dataUrl = await drawOnSourceImage(image, dependencies, (surface) => {
    const ordinal = { support: 0, resistance: 0 };
    for (const level of levels) {
      ordinal[level.type] += 1;
      const lineY = ratioToPixel(level.yRatio, image.height);
      const occupied = level.type === 'support' ? supportLabels : resistanceLabels;
      const textY = labelPosition(lineY, image.height, occupied);
      occupied.push(textY);

      surface.setStrokeStyle(COLORS[level.type]);
      surface.setFillStyle(COLORS[level.type]);
      surface.setLineWidth(2);
      surface.beginPath();
      surface.moveTo(0, lineY);
      surface.lineTo(image.width, lineY);
      surface.stroke();
      const prefix = level.type === 'support' ? 'S' : 'R';
      surface.fillText(`${prefix}${ordinal[level.type]} ${level.priceLabel}`, 12, textY);
    }
  });

  return {
    id: 'levels',
    kind: 'levels',
    title: 'Support and resistance',
    dataUrl,
    width: image.width,
    height: image.height,
  };
}
