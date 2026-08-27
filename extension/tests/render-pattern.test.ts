import { describe, expect, it } from 'vitest';
import type { CommunityReportV3 } from '../src/analysis/stages/community-report-v3-schema';
import type { ProcessedImage } from '../src/capture/image-types';
import {
  type AnnotationCanvasDependencies,
  type AnnotationSurface,
} from '../src/annotations/canvas-surface';
import { renderPattern } from '../src/annotations/render-pattern';

type Operation = readonly [name: string, ...values: unknown[]];
type Pattern = CommunityReportV3['patterns'][number];

function recordingCanvas() {
  const operations: Operation[] = [];
  const surface: AnnotationSurface = {
    drawSource: (source, width, height) => operations.push(['drawSource', source, width, height]),
    setStrokeStyle: (color) => operations.push(['setStrokeStyle', color]),
    setFillStyle: (color) => operations.push(['setFillStyle', color]),
    setLineWidth: (width) => operations.push(['setLineWidth', width]),
    beginPath: () => operations.push(['beginPath']),
    moveTo: (x, y) => operations.push(['moveTo', x, y]),
    lineTo: (x, y) => operations.push(['lineTo', x, y]),
    closePath: () => operations.push(['closePath']),
    stroke: () => operations.push(['stroke']),
    fill: () => operations.push(['fill']),
    fillText: (text, x, y) => operations.push(['fillText', text, x, y]),
    encode: async () => {
      operations.push(['encode']);
      return 'data:image/png;base64,cGF0dGVybg==';
    },
  };
  const dependencies: AnnotationCanvasDependencies = {
    decode: async () => ({ source: 'synthetic-800x600', dispose: () => operations.push(['dispose']) }),
    createSurface: (width, height) => {
      operations.push(['createSurface', width, height]);
      return surface;
    },
  };
  return { dependencies, operations };
}

const image: ProcessedImage = {
  mediaType: 'image/png',
  dataUrl: 'data:image/png;base64,c3ludGhldGljLTgwMHg2MDA=',
  width: 800,
  height: 600,
};

function pattern(points: Pattern['points']): Pattern {
  return {
    id: 'P01',
    name: 'Visible triangle',
    status: 'forming',
    bias: 'neutral',
    timeRange: 'Visible chart range.',
    evidence: 'Price is narrowing between visible swings.',
    confirmation: 'Visible close above the pattern.',
    invalidation: 'Visible close below the pattern.',
    confidence: 0.7,
    points,
  };
}

describe('renderPattern', () => {
  it('draws only the clamped numbered polyline and name for the requested pattern', async () => {
    // Breaks on: out-of-bounds mapping, missing/reordered point numbers, closing the
    // polyline, or mixing any signal/level/other-pattern overlay into this image.
    const input = pattern([
      { xRatio: -0.25, yRatio: 1.25 },
      { xRatio: 0.5, yRatio: 0.5 },
      { xRatio: 1.25, yRatio: -0.5 },
    ]);
    const before = structuredClone(input);
    const { dependencies, operations } = recordingCanvas();

    const result = await renderPattern(image, input, dependencies);

    expect(result).toEqual({
      id: 'P01',
      kind: 'pattern',
      title: 'Visible triangle',
      dataUrl: 'data:image/png;base64,cGF0dGVybg==',
      width: 800,
      height: 600,
    });
    expect(input).toEqual(before);
    expect(operations).toEqual([
      ['createSurface', 800, 600],
      ['drawSource', 'synthetic-800x600', 800, 600],
      ['setStrokeStyle', '#7c3aed'],
      ['setFillStyle', '#7c3aed'],
      ['setLineWidth', 3],
      ['beginPath'],
      ['moveTo', 1.5, 598.5],
      ['lineTo', 400, 300],
      ['lineTo', 798.5, 1.5],
      ['stroke'],
      ['fillText', '1', 7.5, 592],
      ['fillText', '2', 406, 294],
      ['fillText', '3', 784, 16],
      ['fillText', 'Visible triangle', 12, 24],
      ['encode'],
      ['dispose'],
    ]);
    expect(operations.some((operation) => ['S1', 'R1', 'LONG', 'SHORT', 'Entry'].includes(String(operation[1]))))
      .toBe(false);
  });

  it('numbers all eight validated points without adding a ninth or a second image', async () => {
    // Breaks on: truncating the schema's eight-point maximum or rendering a pattern more than once.
    const input = pattern(Array.from({ length: 8 }, (_, index) => ({
      xRatio: index / 7,
      yRatio: index / 7,
    })));
    const { dependencies, operations } = recordingCanvas();

    await renderPattern(image, input, dependencies);

    const labels = operations
      .filter(([name]) => name === 'fillText')
      .map(([, text]) => text);
    expect(labels).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', 'Visible triangle']);
    expect(operations.filter(([name]) => name === 'drawSource')).toHaveLength(1);
    expect(operations.filter(([name]) => name === 'encode')).toHaveLength(1);
  });

  it('maps endpoint points to a 1.5 px margin so the full polyline stroke remains drawable', async () => {
    // Breaks on: centering the 3 px polyline stroke on a clipped canvas boundary.
    const input = pattern([
      { xRatio: 0, yRatio: 0 },
      { xRatio: 1, yRatio: 1 },
    ]);
    const { dependencies, operations } = recordingCanvas();

    await renderPattern(image, input, dependencies);

    expect(operations.filter(([name]) => name === 'moveTo' || name === 'lineTo')).toEqual([
      ['moveTo', 1.5, 1.5],
      ['lineTo', 798.5, 598.5],
    ]);
    expect(operations.filter(([name]) => name === 'fillText')).toEqual([
      ['fillText', '1', 7.5, 16],
      ['fillText', '2', 784, 592],
      ['fillText', 'Visible triangle', 12, 24],
    ]);
  });
});
