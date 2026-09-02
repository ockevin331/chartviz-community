import type { ProcessedImage } from '../capture/image-types';
import type { PresentationDrawing } from '../presentation/report-presentation-model';
import type { AnnotatedImage } from './annotation-types';
import {
  browserAnnotationCanvasDependencies,
  clampPixel,
  drawOnSourceImage,
  ratioToDrawablePixel,
  type AnnotationCanvasDependencies,
  type AnnotationSurface,
} from './canvas-surface';

const STRUCTURE_COLOR = '#2563eb';
const DRAWABLE_MARGIN = 1.5;

type Pixel = Readonly<{ x: number; y: number }>;

function drawLine(surface: AnnotationSurface, points: readonly Pixel[]) {
  const [start, ...rest] = points;
  if (!start) return;
  surface.beginPath();
  surface.moveTo(start.x, start.y);
  rest.forEach(({ x, y }) => surface.lineTo(x, y));
  surface.stroke();
}

export async function renderPresentationStructure(
  image: ProcessedImage,
  drawings: readonly PresentationDrawing[],
  dependencies: AnnotationCanvasDependencies = browserAnnotationCanvasDependencies,
): Promise<AnnotatedImage | null> {
  const structures = drawings.filter((drawing) => (
    drawing.layer === 'structure'
    && drawing.meaning === 'structure'
    && ['trend_line', 'channel', 'range', 'marker'].includes(drawing.tool)
  ));
  const first = structures[0];
  if (!first) return null;

  const dataUrl = await drawOnSourceImage(image, dependencies, (surface) => {
    surface.setStrokeStyle(STRUCTURE_COLOR);
    surface.setFillStyle(STRUCTURE_COLOR);
    surface.setLineWidth(3);

    structures.forEach((drawing, index) => {
      const pixels = drawing.points.map((point) => ({
        x: ratioToDrawablePixel(point.xRatio ?? 0, image.width, DRAWABLE_MARGIN),
        y: ratioToDrawablePixel(point.yRatio, image.height, DRAWABLE_MARGIN),
      }));

      if (drawing.tool === 'trend_line') {
        drawLine(surface, pixels);
      } else if (drawing.tool === 'channel' || drawing.tool === 'range') {
        drawLine(surface, [pixels[0]!, pixels[1]!]);
        drawLine(surface, [pixels[2]!, pixels[3]!]);
      } else if (drawing.tool === 'marker') {
        const marker = pixels[0];
        if (marker) surface.fillText('•', marker.x, marker.y);
      }

      if (structures.length > 1) {
        const anchor = pixels[0];
        if (anchor) {
          surface.fillText(
            `M${index + 1}`,
            clampPixel(anchor.x + 6, 6, Math.max(6, image.width - 28)),
            clampPixel(anchor.y - 6, 16, Math.max(16, image.height - 8)),
          );
        }
      }
    });
  });

  return {
    id: `structure-${first.captureId}`,
    kind: 'structure',
    title: 'Market structure',
    dataUrl,
    width: image.width,
    height: image.height,
  };
}
