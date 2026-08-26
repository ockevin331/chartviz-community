import { describe, expect, it } from 'vitest';
import type { Level } from '../src/analysis/community-report';
import type { ProcessedImage } from '../src/capture/image-types';
import {
  type AnnotationCanvasDependencies,
  type AnnotationSurface,
} from '../src/annotations/canvas-surface';
import { renderLevels } from '../src/annotations/render-levels';

type Operation = readonly [name: string, ...values: unknown[]];

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
      return 'data:image/png;base64,bGV2ZWxz';
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

function level(id: string, type: Level['type'], priceLabel: string, yRatio: number): Level {
  return {
    id,
    type,
    priceLabel,
    reason: 'Visible chart level.',
    timeAnchor: 'Current visible chart.',
    yRatio,
    evidenceIds: [],
  };
}

describe('renderLevels', () => {
  it('draws the source first and keeps clamped price lines fixed while only overlapping same-side labels move', async () => {
    // Breaks on: drawing overlays before the screenshot, missing renderer-boundary
    // clamping, incorrect level colors/ordinals, or moving a price line to avoid text overlap.
    const levels = [
      level('support-one', 'support', '100', -0.25),
      level('support-two', 'support', '101', 0.01),
      level('resistance-one', 'resistance', '120', 1.25),
      level('resistance-two', 'resistance', '119', 0.99),
    ];
    const before = structuredClone(levels);
    const { dependencies, operations } = recordingCanvas();

    const result = await renderLevels(image, levels, dependencies);

    expect(result).toEqual({
      id: 'levels',
      kind: 'levels',
      title: 'Support and resistance',
      dataUrl: 'data:image/png;base64,bGV2ZWxz',
      width: 800,
      height: 600,
    });
    expect(levels).toEqual(before);
    expect(operations).toEqual([
      ['createSurface', 800, 600],
      ['drawSource', 'synthetic-800x600', 800, 600],
      ['setStrokeStyle', '#16a34a'],
      ['setFillStyle', '#16a34a'],
      ['setLineWidth', 2],
      ['beginPath'],
      ['moveTo', 0, 0],
      ['lineTo', 800, 0],
      ['stroke'],
      ['fillText', 'S1 100', 12, 16],
      ['setStrokeStyle', '#16a34a'],
      ['setFillStyle', '#16a34a'],
      ['setLineWidth', 2],
      ['beginPath'],
      ['moveTo', 0, 6],
      ['lineTo', 800, 6],
      ['stroke'],
      ['fillText', 'S2 101', 12, 34],
      ['setStrokeStyle', '#dc2626'],
      ['setFillStyle', '#dc2626'],
      ['setLineWidth', 2],
      ['beginPath'],
      ['moveTo', 0, 600],
      ['lineTo', 800, 600],
      ['stroke'],
      ['fillText', 'R1 120', 12, 592],
      ['setStrokeStyle', '#dc2626'],
      ['setFillStyle', '#dc2626'],
      ['setLineWidth', 2],
      ['beginPath'],
      ['moveTo', 0, 594],
      ['lineTo', 800, 594],
      ['stroke'],
      ['fillText', 'R2 119', 12, 574],
      ['encode'],
      ['dispose'],
    ]);
  });

  it('returns null without decoding or creating a canvas when there are no levels', async () => {
    // Breaks on: generating a spurious levels image for an empty report.
    const { dependencies, operations } = recordingCanvas();

    await expect(renderLevels(image, [], dependencies)).resolves.toBeNull();
    expect(operations).toEqual([]);
  });
});
