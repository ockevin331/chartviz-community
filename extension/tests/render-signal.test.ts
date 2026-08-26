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

function tradeLabelBaselines(operations: Operation[]): number[] {
  return operations
    .filter(([name, text]) => (
      name === 'fillText' && /^(Entry|Stop|Target|Risk\/reward)/.test(String(text))
    ))
    .map((operation) => operation[3] as number);
}

function expectPairwiseSpacing(values: number[], minimum: number): void {
  values.forEach((value, index) => {
    values.slice(index + 1).forEach((other) => {
      expect(Math.abs(value - other)).toBeGreaterThanOrEqual(minimum);
    });
  });
}

function priceLineYs(operations: Operation[]): number[] {
  return operations
    .filter(([name, x]) => name === 'moveTo' && x === 0.75)
    .map((operation) => operation[2] as number);
}

function arrowPathCoordinates(operations: Operation[]): Array<[number, number]> {
  const arrowStart = operations.findIndex((operation) => (
    operation[0] === 'setLineWidth' && operation[1] === 3
  ));
  return operations
    .slice(arrowStart)
    .filter(([name]) => name === 'moveTo' || name === 'lineTo')
    .map((operation) => [operation[1] as number, operation[2] as number]);
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
      ['moveTo', 0.75, 240],
      ['lineTo', 799.25, 240],
      ['stroke'],
      ['fillText', 'Entry 105', 12, 234],
      ['setStrokeStyle', '#dc2626'],
      ['setFillStyle', '#dc2626'],
      ['setLineWidth', 1.5],
      ['beginPath'],
      ['moveTo', 0.75, 390],
      ['lineTo', 799.25, 390],
      ['stroke'],
      ['fillText', 'Stop 99', 12, 384],
      ['setStrokeStyle', '#16a34a'],
      ['setFillStyle', '#16a34a'],
      ['setLineWidth', 1.5],
      ['beginPath'],
      ['moveTo', 0.75, 120],
      ['lineTo', 799.25, 120],
      ['stroke'],
      ['fillText', 'Target 1 110', 12, 114],
      ['setStrokeStyle', '#16a34a'],
      ['setFillStyle', '#16a34a'],
      ['setLineWidth', 1.5],
      ['beginPath'],
      ['moveTo', 0.75, 599.25],
      ['lineTo', 799.25, 599.25],
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
      ['fillText', 'Risk/reward 2:1', 12, 574],
      ['encode'],
      ['dispose'],
    ]);
    expect(tradeLabelBaselines(operations)).toEqual([234, 384, 114, 592, 574]);
    expectPairwiseSpacing(tradeLabelBaselines(operations), 18);
  });

  it('mirrors the compact arrow above a short entry and exposes a null risk/reward explicitly', async () => {
    // Breaks on: reusing long geometry/text for short signals or hiding a nullable RR field.
    const input = signal({
      id: 'signal-short',
      direction: 'short',
      entry: { priceLabel: '95', xRatio: 0.75, yRatio: 0.75 },
      stop: { priceLabel: '101', yRatio: 0.6 },
      targets: [{ priceLabel: '90', yRatio: 1 }],
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
    expect(operations).toContainEqual(['fillText', 'Target 1 90', 12, 592]);
    expect(operations).toContainEqual(['fillText', 'Risk/reward Not provided', 12, 574]);
    expect(tradeLabelBaselines(operations)).toEqual([444, 354, 592, 574]);
    expectPairwiseSpacing(tradeLabelBaselines(operations), 18);
    expect(operations.filter(([name]) => name === 'drawSource')).toHaveLength(1);
    expect(operations.filter(([name]) => name === 'encode')).toHaveLength(1);
  });

  it('keeps a long arrow at ratio-one entry fully drawable, directional, and non-zero', async () => {
    // Breaks on: a bottom-edge long arrow collapsing to zero length or clipping its left arrowhead.
    const input = signal({
      entry: { priceLabel: 'BOTTOM', xRatio: 0, yRatio: 1 },
      stop: { priceLabel: 'STOP', yRatio: 0 },
      targets: [{ priceLabel: 'TARGET', yRatio: 1 }],
    });
    const { dependencies, operations } = recordingCanvas('data:image/png;base64,bG9uZy1lZGdl');

    await renderSignal(image, input, dependencies);

    const arrowStart = operations.findIndex((operation) => (
      operation[0] === 'setLineWidth' && operation[1] === 3
    ));
    expect(operations.slice(arrowStart, arrowStart + 15)).toEqual([
      ['setLineWidth', 3],
      ['beginPath'],
      ['moveTo', 7.5, 598.5],
      ['lineTo', 7.5, 568.5],
      ['stroke'],
      ['beginPath'],
      ['moveTo', 1.5, 576.5],
      ['lineTo', 7.5, 568.5],
      ['lineTo', 13.5, 576.5],
      ['stroke'],
      ['fillText', 'LONG', 19.5, 592],
      ['fillText', 'Risk/reward 2:1', 12, 556],
      ['encode'],
      ['dispose'],
    ]);
    expect(operations).toContainEqual(['moveTo', 0.75, 599.25]);
    expect(operations).toContainEqual(['lineTo', 799.25, 599.25]);
  });

  it('keeps a short arrow at ratio-zero entry fully drawable, directional, and non-zero', async () => {
    // Breaks on: a top-edge short arrow collapsing to zero length or clipping its right arrowhead.
    const input = signal({
      id: 'signal-short-edge',
      direction: 'short',
      entry: { priceLabel: 'TOP', xRatio: 1, yRatio: 0 },
      stop: { priceLabel: 'STOP', yRatio: 1 },
      targets: [{ priceLabel: 'TARGET', yRatio: 0 }],
    });
    const { dependencies, operations } = recordingCanvas('data:image/png;base64,c2hvcnQtZWRnZQ==');

    await renderSignal(image, input, dependencies);

    const arrowStart = operations.findIndex((operation) => (
      operation[0] === 'setLineWidth' && operation[1] === 3
    ));
    expect(operations.slice(arrowStart, arrowStart + 11)).toEqual([
      ['setLineWidth', 3],
      ['beginPath'],
      ['moveTo', 792.5, 1.5],
      ['lineTo', 792.5, 31.5],
      ['stroke'],
      ['beginPath'],
      ['moveTo', 786.5, 23.5],
      ['lineTo', 792.5, 31.5],
      ['lineTo', 798.5, 23.5],
      ['stroke'],
      ['fillText', 'SHORT', 728, 16],
    ]);
    expect(operations).toContainEqual(['moveTo', 0.75, 0.75]);
    expect(operations).toContainEqual(['lineTo', 799.25, 0.75]);
  });

  it('places three same-price targets in deterministic non-overlapping text lanes', async () => {
    // Breaks on: independently clamping same-y labels to one baseline instead of moving labels only.
    const input = signal({
      stop: { priceLabel: '99', yRatio: 0.6 },
      targets: [
        { priceLabel: 'T1', yRatio: 0.5 },
        { priceLabel: 'T2', yRatio: 0.5 },
        { priceLabel: 'T3', yRatio: 0.5 },
      ],
    });
    const { dependencies, operations } = recordingCanvas('data:image/png;base64,bGFuZXM=');

    await renderSignal(image, input, dependencies);

    expect(operations.filter(([name, , y]) => (
      (name === 'moveTo' || name === 'lineTo') && y === 300
    ))).toEqual([
      ['moveTo', 0.75, 300],
      ['lineTo', 799.25, 300],
      ['moveTo', 0.75, 300],
      ['lineTo', 799.25, 300],
      ['moveTo', 0.75, 300],
      ['lineTo', 799.25, 300],
    ]);
    expect(tradeLabelBaselines(operations)).toEqual([234, 354, 294, 312, 330, 588]);
    expectPairwiseSpacing(tradeLabelBaselines(operations), 18);
  });

  it('globally packs six top-clustered labels while preserving their price-line Ys', async () => {
    // Breaks on: returning the per-label greedy lanes instead of a globally ordered packing.
    const input = signal({
      entry: { priceLabel: 'ENTRY', xRatio: 0.5, yRatio: 0 },
      stop: { priceLabel: 'STOP', yRatio: 0 },
      targets: [
        { priceLabel: 'T1', yRatio: 0 },
        { priceLabel: 'T2', yRatio: 0 },
        { priceLabel: 'T3', yRatio: 0 },
      ],
      riskReward: '2:1',
    });
    const { dependencies, operations } = recordingCanvas('data:image/png;base64,dG9w');

    await renderSignal({ ...image, width: 320, height: 180 }, input, dependencies);

    expect(tradeLabelBaselines(operations)).toEqual([16, 34, 52, 70, 88, 168]);
    expectPairwiseSpacing(tradeLabelBaselines(operations), 18);
    expect(tradeLabelBaselines(operations).every((y) => y >= 16 && y <= 172)).toBe(true);
    expect(priceLineYs(operations)).toEqual([0.75, 0.75, 0.75, 0.75, 0.75]);
  });

  it('globally packs six bottom-clustered labels without returning a colliding fallback', async () => {
    // Breaks on: greedy placement choosing order-dependent lanes or falling back to a collision.
    const input = signal({
      entry: { priceLabel: 'ENTRY', xRatio: 0.5, yRatio: 1 },
      stop: { priceLabel: 'STOP', yRatio: 1 },
      targets: [
        { priceLabel: 'T1', yRatio: 1 },
        { priceLabel: 'T2', yRatio: 1 },
        { priceLabel: 'T3', yRatio: 1 },
      ],
      riskReward: null,
    });
    const { dependencies, operations } = recordingCanvas('data:image/png;base64,Ym90dG9t');

    await renderSignal({ ...image, width: 320, height: 180 }, input, dependencies);

    expect(tradeLabelBaselines(operations)).toEqual([100, 118, 136, 154, 172, 82]);
    expectPairwiseSpacing(tradeLabelBaselines(operations), 18);
    expect(tradeLabelBaselines(operations).every((y) => y >= 16 && y <= 172)).toBe(true);
    expect(priceLineYs(operations)).toEqual([179.25, 179.25, 179.25, 179.25, 179.25]);
    expect(operations).toContainEqual(['fillText', 'Risk/reward Not provided', 12, 82]);
  });

  it('stably packs mixed preferred baselines in original label order', async () => {
    // Breaks on: skipping the stable sort by preferred baseline then original field order.
    const input = signal({
      entry: { priceLabel: 'ENTRY', xRatio: 0.5, yRatio: 31 / 180 },
      stop: { priceLabel: 'STOP', yRatio: 49 / 180 },
      targets: [
        { priceLabel: 'T1', yRatio: 22 / 180 },
        { priceLabel: 'T2', yRatio: 80 / 180 },
        { priceLabel: 'T3', yRatio: 140 / 180 },
      ],
      riskReward: '3:1',
    });
    const { dependencies, operations } = recordingCanvas('data:image/png;base64,bWl4ZWQ=');

    await renderSignal({ ...image, width: 320, height: 180 }, input, dependencies);

    expect(tradeLabelBaselines(operations)).toEqual([34, 52, 16, 74, 134, 168]);
    expectPairwiseSpacing(tradeLabelBaselines(operations), 18);
    expect(tradeLabelBaselines(operations).every((y) => y >= 16 && y <= 172)).toBe(true);
    [31, 49, 22, 80, 140].forEach((expected, index) => {
      expect(priceLineYs(operations)[index]).toBeCloseTo(expected);
    });
  });

  it.each([
    ['long', signal({ entry: { priceLabel: 'BOTTOM', xRatio: 0, yRatio: 1 } })],
    ['short', signal({ direction: 'short', entry: { priceLabel: 'TOP', xRatio: 1, yRatio: 0 } })],
  ] as const)('keeps every %s arrow body and head coordinate inside a 320x180 canvas', async (_, input) => {
    // Breaks on: a minimum-size arrow clipping at an edge or collapsing its body/head geometry.
    const { dependencies, operations } = recordingCanvas('data:image/png;base64,YXJyb3c=');

    await renderSignal({ ...image, width: 320, height: 180 }, input, dependencies);

    const coordinates = arrowPathCoordinates(operations);
    expect(coordinates).toHaveLength(5);
    expect(coordinates.every(([x, y]) => x >= 0 && x <= 320 && y >= 0 && y <= 180)).toBe(true);
    expect(coordinates[0]![1]).not.toBe(coordinates[1]![1]);
    expect(coordinates.slice(2)).toEqual([
      [coordinates[0]![0] - 6, coordinates[1]![1] + (input.direction === 'long' ? 8 : -8)],
      coordinates[1],
      [coordinates[0]![0] + 6, coordinates[1]![1] + (input.direction === 'long' ? 8 : -8)],
    ]);
  });
});
