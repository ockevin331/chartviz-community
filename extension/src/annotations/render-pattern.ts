import type { CommunityReportV3 } from '../analysis/stages/community-report-v3-schema';
import type { ProcessedImage } from '../capture/image-types';
import type { AnnotatedImage } from './annotation-types';
import {
  browserAnnotationCanvasDependencies,
  clampPixel,
  drawOnSourceImage,
  ratioToDrawablePixel,
  type AnnotationCanvasDependencies,
} from './canvas-surface';

const PATTERN_COLOR = '#7c3aed';
const POLYLINE_MARGIN = 1.5;
type Pattern = CommunityReportV3['patterns'][number];

export async function renderPattern(
  image: ProcessedImage,
  pattern: Pattern,
  dependencies: AnnotationCanvasDependencies = browserAnnotationCanvasDependencies,
): Promise<AnnotatedImage> {
  const dataUrl = await drawOnSourceImage(image, dependencies, (surface) => {
    const pixels = pattern.points.map((point) => ({
      x: ratioToDrawablePixel(point.xRatio, image.width, POLYLINE_MARGIN),
      y: ratioToDrawablePixel(point.yRatio, image.height, POLYLINE_MARGIN),
    }));

    const [first, ...rest] = pixels;
    if (!first) {
      return;
    }

    surface.setStrokeStyle(PATTERN_COLOR);
    surface.setFillStyle(PATTERN_COLOR);
    surface.setLineWidth(3);
    surface.beginPath();
    surface.moveTo(first.x, first.y);
    rest.forEach(({ x, y }) => surface.lineTo(x, y));
    surface.stroke();

    pixels.forEach(({ x, y }, index) => {
      surface.fillText(
        String(index + 1),
        clampPixel(x + 6, 6, Math.max(6, image.width - 16)),
        clampPixel(y - 6, 16, Math.max(16, image.height - 8)),
      );
    });
    surface.fillText(pattern.name, 12, clampPixel(24, 16, Math.max(16, image.height - 8)));
  });

  return {
    id: pattern.id,
    kind: 'pattern',
    title: pattern.name,
    dataUrl,
    width: image.width,
    height: image.height,
  };
}
