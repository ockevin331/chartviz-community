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
type Boundary = NonNullable<Pattern['geometry']['upperBoundary']>;

function boundaryPixels(boundary: Boundary, image: ProcessedImage) {
  return {
    start: {
      x: ratioToDrawablePixel(boundary.start.xRatio, image.width, POLYLINE_MARGIN),
      y: ratioToDrawablePixel(boundary.start.yRatio, image.height, POLYLINE_MARGIN),
    },
    end: {
      x: ratioToDrawablePixel(boundary.end.xRatio, image.width, POLYLINE_MARGIN),
      y: ratioToDrawablePixel(boundary.end.yRatio, image.height, POLYLINE_MARGIN),
    },
  };
}

export async function renderPattern(
  image: ProcessedImage,
  pattern: Pattern,
  dependencies: AnnotationCanvasDependencies = browserAnnotationCanvasDependencies,
): Promise<AnnotatedImage> {
  const dataUrl = await drawOnSourceImage(image, dependencies, (surface) => {
    surface.setStrokeStyle(PATTERN_COLOR);
    surface.setFillStyle(PATTERN_COLOR);
    surface.setLineWidth(3);

    if (pattern.geometry.geometryKind === 'polyline') {
      const pixels = pattern.geometry.points.map((point) => ({
        x: ratioToDrawablePixel(point.xRatio, image.width, POLYLINE_MARGIN),
        y: ratioToDrawablePixel(point.yRatio, image.height, POLYLINE_MARGIN),
      }));
      const [first, ...rest] = pixels;
      if (!first) return;
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
    } else {
      const upper = pattern.geometry.upperBoundary;
      const lower = pattern.geometry.lowerBoundary;
      if (upper === null || lower === null) return;
      const boundaries = [boundaryPixels(upper, image), boundaryPixels(lower, image)];

      boundaries.forEach(({ start, end }, index) => {
        const horizontalY = (start.y + end.y) / 2;
        const lineStart = pattern.geometry.geometryKind === 'range' ? { x: start.x, y: horizontalY } : start;
        const lineEnd = pattern.geometry.geometryKind === 'range' ? { x: end.x, y: horizontalY } : end;
        surface.beginPath();
        surface.moveTo(lineStart.x, lineStart.y);
        surface.lineTo(lineEnd.x, lineEnd.y);
        surface.stroke();
        const label = pattern.geometry.geometryKind === 'range'
          ? (index === 0 ? 'Resistance zone' : 'Support zone')
          : (index === 0 ? 'Upper channel' : 'Lower channel');
        surface.fillText(
          label,
          clampPixel(lineStart.x + 6, 6, Math.max(6, image.width - 120)),
          clampPixel(lineStart.y - 6, 16, Math.max(16, image.height - 8)),
        );
      });
    }
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
