import { describe, expect, it } from 'vitest';
import type { CommunityReportV3 } from '../src/analysis/stages/community-report-v3-schema';
import type { ProcessedImage } from '../src/capture/image-types';
import { buildAnnotations, ANNOTATION_IMAGE_TOO_SMALL_CODE } from '../src/annotations/build-annotations';
import type { AnnotationCanvasDependencies, AnnotationSurface } from '../src/annotations/canvas-surface';
import { communityReport } from './community-ui-fixtures';

type Operation = readonly [name: string, ...values: unknown[]];

function recordingCanvases() {
  const canvases: Operation[][] = [];
  const dependencies: AnnotationCanvasDependencies = {
    decode: async () => ({ source: 'source', dispose: () => undefined }),
    createSurface: (width, height) => {
      const operations: Operation[] = [];
      const index = canvases.push(operations);
      const surface: AnnotationSurface = {
        drawSource: (...values) => operations.push(['drawSource', ...values]),
        setStrokeStyle: (value) => operations.push(['setStrokeStyle', value]),
        setFillStyle: (value) => operations.push(['setFillStyle', value]),
        setLineWidth: (value) => operations.push(['setLineWidth', value]),
        beginPath: () => operations.push(['beginPath']), moveTo: (...values) => operations.push(['moveTo', ...values]),
        lineTo: (...values) => operations.push(['lineTo', ...values]), closePath: () => operations.push(['closePath']),
        stroke: () => operations.push(['stroke']), fill: () => operations.push(['fill']),
        fillText: (...values) => operations.push(['fillText', ...values]),
        encode: async () => `data:image/png;base64,CANVAS${index}`,
      };
      operations.push(['size', width, height]);
      return surface;
    },
  };
  return { canvases, dependencies };
}

const image: ProcessedImage = { mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAAA', width: 800, height: 600 };

function reportWithMultipleFindings(): CommunityReportV3 {
  const report = structuredClone(communityReport);
  report.tradeSignals.push({
    ...structuredClone(report.tradeSignals[0]!), id: 'S02', direction: 'short', signalType: 'Support breakdown',
    signalTime: 'Middle-right candles', thesisAtSignal: 'Support failure shows sellers accepting lower prices.',
    entry: { priceLabel: '63,850', xRatio: 0.75, yRatio: 0.72 }, stopLoss: { priceLabel: '64,200', yRatio: 0.62 },
    takeProfits: [{ priceLabel: '63,200', yRatio: 0.84 }],
  });
  report.patterns.push({
    ...structuredClone(report.patterns[0]!), id: 'P02', name: 'Range compression', bias: 'neutral',
    points: [{ xRatio: 0.55, yRatio: 0.42 }, { xRatio: 0.9, yRatio: 0.48 }],
  });
  return report;
}

describe('buildAnnotations community-3.0', () => {
  it('renders one levels image and one isolated image for every direct trade signal and pattern', async () => {
    const report = reportWithMultipleFindings();
    const { canvases, dependencies } = recordingCanvases();

    const result = await buildAnnotations(image, report, dependencies);

    expect(result.levels?.id).toBe('levels');
    expect(Object.keys(result.signals)).toEqual(['S01', 'S02']);
    expect(Object.keys(result.patterns)).toEqual(['P01', 'P02']);
    expect(canvases).toHaveLength(5);
    expect(canvases[1]).toContainEqual(['fillText', 'Entry 65,350', 12, expect.any(Number)]);
    expect(canvases[1]).toContainEqual(['fillText', 'Stop 64,900', 12, expect.any(Number)]);
    expect(canvases[2]).toContainEqual(['fillText', 'SHORT', expect.any(Number), expect.any(Number)]);
  });

  it('fails before annotation work when the screenshot is too small', async () => {
    const { canvases, dependencies } = recordingCanvases();
    await expect(buildAnnotations({ ...image, width: 319 }, communityReport, dependencies))
      .rejects.toMatchObject({ code: ANNOTATION_IMAGE_TOO_SMALL_CODE });
    expect(canvases).toEqual([]);
  });

  it('returns stable empty annotation collections when no drawable findings exist', async () => {
    const report = structuredClone(communityReport);
    report.levels = []; report.tradeSignals = []; report.patterns = [];
    const { canvases, dependencies } = recordingCanvases();
    await expect(buildAnnotations(image, report, dependencies)).resolves.toEqual({ levels: null, signals: {}, patterns: {} });
    expect(canvases).toEqual([]);
  });
});
