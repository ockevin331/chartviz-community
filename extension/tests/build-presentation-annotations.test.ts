import { describe, expect, it } from 'vitest';
import {
  buildPresentationAnnotations,
  type PresentationSourceCapture,
} from '../src/annotations/build-presentation-annotations';
import type { AnnotationCanvasDependencies, AnnotationSurface } from '../src/annotations/canvas-surface';
import type { PresentationDrawing } from '../src/presentation/report-presentation-model';

type Operation = readonly [name: string, ...values: unknown[]];

function recordingCanvases() {
  const canvases: Operation[][] = [];
  const dependencies: AnnotationCanvasDependencies = {
    decode: async (dataUrl) => ({ source: dataUrl, dispose: () => undefined }),
    createSurface: (width, height) => {
      const operations: Operation[] = [['size', width, height]];
      const index = canvases.push(operations);
      const surface: AnnotationSurface = {
        drawSource: (...values) => operations.push(['drawSource', ...values]),
        setStrokeStyle: (value) => operations.push(['setStrokeStyle', value]),
        setFillStyle: (value) => operations.push(['setFillStyle', value]),
        setLineWidth: (value) => operations.push(['setLineWidth', value]),
        beginPath: () => operations.push(['beginPath']),
        moveTo: (...values) => operations.push(['moveTo', ...values]),
        lineTo: (...values) => operations.push(['lineTo', ...values]),
        closePath: () => operations.push(['closePath']),
        stroke: () => operations.push(['stroke']),
        fill: () => operations.push(['fill']),
        fillText: (...values) => operations.push(['fillText', ...values]),
        encode: async () => `data:image/png;base64,CANVAS${index}`,
      };
      return surface;
    },
  };
  return { canvases, dependencies };
}

const captures: PresentationSourceCapture[] = [
  {
    captureId: 'C01',
    image: { mediaType: 'image/png', dataUrl: 'data:image/png;base64,C01', width: 800, height: 600 },
  },
  {
    captureId: 'C02',
    image: { mediaType: 'image/png', dataUrl: 'data:image/png;base64,C02', width: 640, height: 360 },
  },
];

const point = (xRatio: number | null, yRatio: number, priceLabel: string | null = null) => ({
  xRatio, yRatio, priceLabel, timeAnchor: null,
});

const drawings: PresentationDrawing[] = [
  { id: 'D01', captureId: 'C01', layer: 'levels', refId: 'L01', meaning: 'support', caption: null, tool: 'horizontal_line', points: [point(null, 0.7, '100')] },
  { id: 'D02', captureId: 'C02', layer: 'levels', refId: 'L02', meaning: 'resistance', caption: null, tool: 'horizontal_line', points: [point(null, 0.3, '120')] },
  { id: 'D03', captureId: 'C01', layer: 'signal', refId: 'S01', meaning: 'long_entry', caption: '2:1', tool: 'entry_arrow', points: [point(0.8, 0.4, '105')] },
  { id: 'D04', captureId: 'C01', layer: 'signal', refId: 'S01', meaning: 'stop', caption: null, tool: 'stop_line', points: [point(null, 0.6, '99')] },
  { id: 'D05', captureId: 'C01', layer: 'signal', refId: 'S01', meaning: 'target', caption: null, tool: 'target_line', points: [point(null, 0.2, '110')] },
  { id: 'D06', captureId: 'C02', layer: 'signal', refId: 'S02', meaning: 'short_entry', caption: null, tool: 'entry_arrow', points: [point(0.7, 0.5, '115')] },
  { id: 'D07', captureId: 'C02', layer: 'signal', refId: 'S02', meaning: 'stop', caption: null, tool: 'stop_line', points: [point(null, 0.3, '121')] },
  { id: 'D08', captureId: 'C02', layer: 'signal', refId: 'S02', meaning: 'target', caption: null, tool: 'target_line', points: [point(null, 0.8, '103')] },
  { id: 'D09', captureId: 'C01', layer: 'pattern', refId: 'P01', meaning: 'pattern', caption: 'Trend line', tool: 'trend_line', points: [point(0.2, 0.7), point(0.8, 0.3)] },
  { id: 'D10', captureId: 'C02', layer: 'pattern', refId: 'P02', meaning: 'pattern', caption: 'Range', tool: 'range', points: [point(0.2, 0.3), point(0.8, 0.3), point(0.2, 0.7), point(0.8, 0.7)] },
  { id: 'D11', captureId: 'C99', layer: 'levels', refId: 'L99', meaning: 'support', caption: null, tool: 'horizontal_line', points: [point(null, 0.5, 'missing')] },
  { id: 'D12', captureId: 'C01', layer: 'signal', refId: 'S03', meaning: 'long_entry', caption: null, tool: 'entry_arrow', points: [point(0.5, 0.5, 'incomplete')] },
];

describe('buildPresentationAnnotations', () => {
  it('isolates normalized drawings by capture, layer, and finding', async () => {
    const { canvases, dependencies } = recordingCanvases();

    const result = await buildPresentationAnnotations(captures, drawings, dependencies);

    expect(Object.keys(result.levels)).toEqual(['C01', 'C02']);
    expect(Object.keys(result.signals)).toEqual(['S01', 'S02']);
    expect(Object.keys(result.patterns)).toEqual(['P01', 'P02']);
    expect(result.levels.C01).toMatchObject({ id: 'levels-C01', width: 800, height: 600 });
    expect(result.levels.C02).toMatchObject({ id: 'levels-C02', width: 640, height: 360 });
    expect(result.signals.S01).toMatchObject({ id: 'S01', title: 'LONG signal' });
    expect(result.signals.S02).toMatchObject({ id: 'S02', title: 'SHORT signal' });
    expect(result.signals.S03).toBeUndefined();
    expect(canvases).toHaveLength(6);
    expect(canvases.filter((operations) => operations.some((operation) => operation[1] === 'data:image/png;base64,C01'))).toHaveLength(3);
    expect(canvases.filter((operations) => operations.some((operation) => operation[1] === 'data:image/png;base64,C02'))).toHaveLength(3);
    expect(canvases.some((operations) => operations.some((operation) => operation[1] === 'missing'))).toBe(false);
  });

  it('returns stable empty maps without canvas work', async () => {
    const { canvases, dependencies } = recordingCanvases();
    await expect(buildPresentationAnnotations(captures, [], dependencies)).resolves.toEqual({
      levels: {}, signals: {}, patterns: {},
    });
    expect(canvases).toEqual([]);
  });
});
