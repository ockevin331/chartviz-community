import { describe, expect, it } from 'vitest';
import type { TradeSignal } from '../src/analysis/community-report';
import type { ProcessedImage } from '../src/capture/image-types';
import {
  type AnnotationCanvasDependencies,
  type AnnotationSurface,
} from '../src/annotations/canvas-surface';
import { renderSignal } from '../src/annotations/render-signal';

type Operation = readonly [name: string, ...values: unknown[]];

function recordingCanvas(encoded: string) {
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
      return encoded;
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

function signal(overrides: Partial<TradeSignal> = {}): TradeSignal {
  return {
    id: 'signal-long',
    direction: 'long',
    timeAnchor: 'Latest visible candle.',
    reason: 'Visible breakout setup.',
    entry: { priceLabel: '105', xRatio: 0.5, yRatio: 0.4 },
    stop: { priceLabel: '99', yRatio: 0.65 },
    targets: [
      { priceLabel: '110', yRatio: 0.2 },
      { priceLabel: '115', yRatio: 1.25 },
    ],
    riskReward: '2:1',
    confidence: 0.8,
    evidenceIds: [],
    ...overrides,
  };
}

describe('renderSignal', () => {
  it('draws one long signal with a compact arrow below entry and every trade field visible', async () => {
    // Breaks on: combining overlays, omitting a target/RR, failing to clamp a ratio,
    // or drawing a long arrow above/away from the entry candle.
    const input = signal();
    const before = structuredClone(input);
    const { dependencies, operations } = recordingCanvas('data:image/png;base64,bG9uZw==');

    const result = await renderSignal(image, input, dependencies);

    expect(result).toEqual({
      id: 'signal-long',
      kind: 'signal',
      title: 'LONG signal',
      dataUrl: 'data:image/png;base64,bG9uZw==',
      width: 800,
      height: 600,
    });
    expect(input).toEqual(before);
    expect(operations).toEqual([
      ['createSurface', 800, 600],
      ['drawSource', 'synthetic-800x600', 800, 600],
      ['setStrokeStyle', '#2563eb'],
      ['setFillStyle', '#2563eb'],
      ['setLineWidth', 1.5],
      ['beginPath'],
      ['moveTo', 0, 240],
      ['lineTo', 800, 240],
      ['stroke'],
      ['fillText', 'Entry 105', 12, 234],
      ['setStrokeStyle', '#dc2626'],
      ['setFillStyle', '#dc2626'],
      ['setLineWidth', 1.5],
      ['beginPath'],
      ['moveTo', 0, 390],
      ['lineTo', 800, 390],
      ['stroke'],
      ['fillText', 'Stop 99', 12, 384],
      ['setStrokeStyle', '#16a34a'],
      ['setFillStyle', '#16a34a'],
      ['setLineWidth', 1.5],
      ['beginPath'],
      ['moveTo', 0, 120],
      ['lineTo', 800, 120],
      ['stroke'],
      ['fillText', 'Target 1 110', 12, 114],
      ['setStrokeStyle', '#16a34a'],
      ['setFillStyle', '#16a34a'],
      ['setLineWidth', 1.5],
      ['beginPath'],
      ['moveTo', 0, 600],
      ['lineTo', 800, 600],
      ['stroke'],
      ['fillText', 'Target 2 115', 12, 592],
      ['setStrokeStyle', '#16a34a'],
      ['setFillStyle', '#16a34a'],
      ['setLineWidth', 3],
      ['beginPath'],
      ['moveTo', 400, 270],
      ['lineTo', 400, 240],
      ['stroke'],
      ['beginPath'],
      ['moveTo', 394, 248],
      ['lineTo', 400, 240],
      ['lineTo', 406, 248],
      ['stroke'],
      ['fillText', 'LONG', 412, 270],
      ['fillText', 'Risk/reward 2:1', 12, 588],
      ['encode'],
      ['dispose'],
    ]);
  });

  it('mirrors the compact arrow above a short entry and exposes a null risk/reward explicitly', async () => {
    // Breaks on: reusing long geometry/text for short signals or hiding a nullable RR field.
    const input = signal({
      id: 'signal-short',
      direction: 'short',
      entry: { priceLabel: '95', xRatio: 0.75, yRatio: 0.75 },
      stop: { priceLabel: '101', yRatio: 0.6 },
      targets: [{ priceLabel: '90', yRatio: 0.9 }],
      riskReward: null,
    });
    const { dependencies, operations } = recordingCanvas('data:image/png;base64,c2hvcnQ=');

    const result = await renderSignal(image, input, dependencies);

    expect(result.title).toBe('SHORT signal');
    expect(operations).toContainEqual(['moveTo', 600, 420]);
    expect(operations).toContainEqual(['lineTo', 600, 450]);
    expect(operations).toContainEqual(['moveTo', 594, 442]);
    expect(operations).toContainEqual(['lineTo', 606, 442]);
    expect(operations).toContainEqual(['fillText', 'SHORT', 612, 414]);
    expect(operations).toContainEqual(['fillText', 'Risk/reward Not provided', 12, 588]);
    expect(operations.filter(([name]) => name === 'drawSource')).toHaveLength(1);
    expect(operations.filter(([name]) => name === 'encode')).toHaveLength(1);
  });
});
