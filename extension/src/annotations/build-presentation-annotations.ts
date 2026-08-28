import type { ProcessedImage } from '../capture/image-types';
import type { PresentationDrawing } from '../presentation/report-presentation-model';
import type { PresentationAnnotatedImages } from './annotation-types';
import {
  browserAnnotationCanvasDependencies,
  type AnnotationCanvasDependencies,
} from './canvas-surface';
import { renderPresentationLevels } from './render-levels';
import { renderPresentationPattern } from './render-pattern';
import { renderPresentationSignal } from './render-signal';

export type PresentationSourceCapture = {
  captureId: string;
  image: ProcessedImage;
};

function groupedByRef(drawings: readonly PresentationDrawing[]): Map<string, PresentationDrawing[]> {
  const groups = new Map<string, PresentationDrawing[]>();
  for (const drawing of drawings) {
    const group = groups.get(drawing.refId) ?? [];
    group.push(drawing);
    groups.set(drawing.refId, group);
  }
  return groups;
}

export async function buildPresentationAnnotations(
  captures: readonly PresentationSourceCapture[],
  drawings: readonly PresentationDrawing[],
  dependencies: AnnotationCanvasDependencies = browserAnnotationCanvasDependencies,
): Promise<PresentationAnnotatedImages> {
  const sources = new Map(captures.map((capture) => [capture.captureId, capture.image]));
  const result: PresentationAnnotatedImages = { levels: {}, signals: {}, patterns: {} };

  for (const capture of captures) {
    if (capture.image.width < 320 || capture.image.height < 180) continue;
    const scoped = drawings.filter((drawing) => drawing.captureId === capture.captureId);
    const levelImage = await renderPresentationLevels(
      capture.image,
      scoped.filter(({ layer }) => layer === 'levels'),
      dependencies,
    );
    if (levelImage) result.levels[capture.captureId] = { ...levelImage, id: `levels-${capture.captureId}` };
  }

  for (const [refId, group] of groupedByRef(drawings.filter(({ layer }) => layer === 'signal'))) {
    const image = sources.get(group[0]!.captureId);
    if (!image || image.width < 320 || image.height < 180) continue;
    const rendered = await renderPresentationSignal(image, group, dependencies);
    if (rendered) result.signals[refId] = rendered;
  }

  for (const [refId, group] of groupedByRef(drawings.filter(({ layer }) => layer === 'pattern'))) {
    const image = sources.get(group[0]!.captureId);
    if (!image || image.width < 320 || image.height < 180) continue;
    const rendered = await renderPresentationPattern(image, group, dependencies);
    if (rendered) result.patterns[refId] = rendered;
  }

  return result;
}
