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

function assertUniqueIds(items: readonly { id: string }[], kind: 'signal' | 'pattern'): void {
  const ids = new Set<string>();
  for (const { id } of items) {
    if (ids.has(id)) {
      throw new Error(`Duplicate ${kind} annotation id: ${id}`);
    }
    ids.add(id);
  }
}

export async function buildAnnotations(
  image: ProcessedImage,
  report: CommunityReport,
  dependencies: AnnotationCanvasDependencies = browserAnnotationCanvasDependencies,
): Promise<AnnotatedReportImages> {
  assertUniqueIds(report.signals, 'signal');
  assertUniqueIds(report.patterns, 'pattern');

  const levels = await renderLevels(image, report.levels, dependencies);
  const signalEntries: Array<[string, AnnotatedImage]> = [];
  const patternEntries: Array<[string, AnnotatedImage]> = [];

  for (const signal of report.signals) {
    signalEntries.push([signal.id, await renderSignal(image, signal, dependencies)]);
  }
  for (const pattern of report.patterns) {
    patternEntries.push([pattern.id, await renderPattern(image, pattern, dependencies)]);
  }

  return {
    levels,
    signals: Object.fromEntries(signalEntries),
    patterns: Object.fromEntries(patternEntries),
  };
}
