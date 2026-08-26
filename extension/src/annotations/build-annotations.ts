import type { CommunityReport } from '../analysis/community-report';
import type { ProcessedImage } from '../capture/image-types';
import type { AnnotatedImage, AnnotatedReportImages } from './annotation-types';
import {
  browserAnnotationCanvasDependencies,
  type AnnotationCanvasDependencies,
} from './canvas-surface';
import { renderLevels } from './render-levels';
import { renderPattern } from './render-pattern';
import { renderSignal } from './render-signal';

export async function buildAnnotations(
  image: ProcessedImage,
  report: CommunityReport,
  dependencies: AnnotationCanvasDependencies = browserAnnotationCanvasDependencies,
): Promise<AnnotatedReportImages> {
  const levels = await renderLevels(image, report.levels, dependencies);
  const signals: Record<string, AnnotatedImage> = {};
  const patterns: Record<string, AnnotatedImage> = {};

  for (const signal of report.signals) {
    signals[signal.id] = await renderSignal(image, signal, dependencies);
  }
  for (const pattern of report.patterns) {
    patterns[pattern.id] = await renderPattern(image, pattern, dependencies);
  }

  return { levels, signals, patterns };
}
