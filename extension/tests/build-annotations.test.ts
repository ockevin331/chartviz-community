import { describe, expect, it } from 'vitest';
import type { CommunityReport } from '../src/analysis/community-report';
import type { ProcessedImage } from '../src/capture/image-types';
import {
  type AnnotationCanvasDependencies,
  type AnnotationSurface,
} from '../src/annotations/canvas-surface';
import { buildAnnotations } from '../src/annotations/build-annotations';

type Operation = readonly [name: string, ...values: unknown[]];

function recordingCanvases() {
  const canvases: Operation[][] = [];
  const dependencies: AnnotationCanvasDependencies = {
    decode: async () => ({ source: 'synthetic-800x600', dispose: () => undefined }),
    createSurface: (width, height) => {
      const operations: Operation[] = [['createSurface', width, height]];
      const canvasNumber = canvases.push(operations);
      const surface: AnnotationSurface = {
        drawSource: (source, targetWidth, targetHeight) => operations.push(['drawSource', source, targetWidth, targetHeight]),
        setStrokeStyle: (color) => operations.push(['setStrokeStyle', color]),
        setFillStyle: (color) => operations.push(['setFillStyle', color]),
        setLineWidth: (lineWidth) => operations.push(['setLineWidth', lineWidth]),
        beginPath: () => operations.push(['beginPath']),
        moveTo: (x, y) => operations.push(['moveTo', x, y]),
        lineTo: (x, y) => operations.push(['lineTo', x, y]),
        closePath: () => operations.push(['closePath']),
        stroke: () => operations.push(['stroke']),
        fill: () => operations.push(['fill']),
        fillText: (text, x, y) => operations.push(['fillText', text, x, y]),
        encode: async () => `data:image/png;base64,Y2FudmFzL${canvasNumber}`,
      };
      return surface;
    },
  };
  return { dependencies, canvases };
}

const image: ProcessedImage = {
  mediaType: 'image/png',
  dataUrl: 'data:image/png;base64,c3ludGhldGljLTgwMHg2MDA=',
  width: 800,
  height: 600,
};

function report(): CommunityReport {
  return {
    schemaVersion: 'community-1.0',
    chart: { instrument: 'TEST', timeframe: '1h', limitations: [] },
    marketView: {
      bias: 'sideways',
      phase: 'range',
      strength: 'moderate',
      summary: 'Price is inside the visible range.',
      evidenceIds: [],
    },
    evidence: [],
    volume: null,
    indicators: [],
    levels: [
      {
        id: 'support-a', type: 'support', priceLabel: '100', reason: 'Visible low.',
        timeAnchor: 'Visible range.', yRatio: 0.75, evidenceIds: [],
      },
      {
        id: 'resistance-a', type: 'resistance', priceLabel: '120', reason: 'Visible high.',
        timeAnchor: 'Visible range.', yRatio: 0.25, evidenceIds: [],
      },
    ],
    scenarios: {
      long: {
        condition: 'Visible break higher.', entry: 'After the break.', stop: 'Below the range.',
        targets: ['Visible high.'], reason: 'Conditional long.', evidenceIds: [],
      },
      short: {
        condition: 'Visible break lower.', entry: 'After the break.', stop: 'Above the range.',
        targets: ['Visible low.'], reason: 'Conditional short.', evidenceIds: [],
      },
      wait: { condition: 'Price remains inside.', reason: 'No break is visible.', evidenceIds: [] },
    },
    patterns: [
      {
        id: 'pattern-a', name: 'Pattern Alpha', status: 'forming', bias: 'neutral',
        timeRange: 'Left half.', explanation: 'Visible Alpha structure.', confidence: 0.7,
        points: [{ xRatio: 0.1, yRatio: 0.2 }, { xRatio: 0.3, yRatio: 0.4 }], evidenceIds: [],
      },
      {
        id: 'pattern-b', name: 'Pattern Beta', status: 'confirmed', bias: 'bearish',
        timeRange: 'Right half.', explanation: 'Visible Beta structure.', confidence: 0.8,
        points: [{ xRatio: 0.6, yRatio: 0.4 }, { xRatio: 0.9, yRatio: 0.7 }], evidenceIds: [],
      },
    ],
    signals: [
      {
        id: 'signal-a', direction: 'long', timeAnchor: 'Left signal', reason: 'Alpha trigger.',
        entry: { priceLabel: 'Entry Alpha', xRatio: 0.3, yRatio: 0.5 },
        stop: { priceLabel: 'Stop Alpha', yRatio: 0.7 },
        targets: [{ priceLabel: 'Target Alpha', yRatio: 0.3 }], riskReward: 'Alpha RR',
        confidence: 0.8, evidenceIds: [],
      },
      {
        id: 'signal-b', direction: 'short', timeAnchor: 'Right signal', reason: 'Beta trigger.',
        entry: { priceLabel: 'Entry Beta', xRatio: 0.7, yRatio: 0.5 },
        stop: { priceLabel: 'Stop Beta', yRatio: 0.3 },
        targets: [{ priceLabel: 'Target Beta', yRatio: 0.7 }], riskReward: 'Beta RR',
        confidence: 0.75, evidenceIds: [],
      },
    ],
    riskNotice: 'Educational chart analysis only.',
  };
}

function texts(operations: Operation[]): unknown[] {
  return operations.filter(([name]) => name === 'fillText').map(([, text]) => text);
}

describe('buildAnnotations', () => {
  it('builds one levels canvas and one isolated canvas for each signal and pattern without mutating inputs', async () => {
    // Breaks on: combined signal/pattern rendering, skipped outputs, repeated level images,
    // wrong dimensions, or mutation of either source contract.
    const inputReport = report();
    const imageBefore = structuredClone(image);
    const reportBefore = structuredClone(inputReport);
    const { dependencies, canvases } = recordingCanvases();

    const result = await buildAnnotations(image, inputReport, dependencies);

    expect(result).toEqual({
      levels: {
        id: 'levels', kind: 'levels', title: 'Support and resistance',
        dataUrl: 'data:image/png;base64,Y2FudmFzL1', width: 800, height: 600,
      },
      signals: {
        'signal-a': {
          id: 'signal-a', kind: 'signal', title: 'LONG signal',
          dataUrl: 'data:image/png;base64,Y2FudmFzL2', width: 800, height: 600,
        },
        'signal-b': {
          id: 'signal-b', kind: 'signal', title: 'SHORT signal',
          dataUrl: 'data:image/png;base64,Y2FudmFzL3', width: 800, height: 600,
        },
      },
      patterns: {
        'pattern-a': {
          id: 'pattern-a', kind: 'pattern', title: 'Pattern Alpha',
          dataUrl: 'data:image/png;base64,Y2FudmFzL4', width: 800, height: 600,
        },
        'pattern-b': {
          id: 'pattern-b', kind: 'pattern', title: 'Pattern Beta',
          dataUrl: 'data:image/png;base64,Y2FudmFzL5', width: 800, height: 600,
        },
      },
    });
    expect(image).toEqual(imageBefore);
    expect(inputReport).toEqual(reportBefore);
    expect(canvases).toHaveLength(5);
    expect(texts(canvases[0]!)).toEqual(['S1 100', 'R1 120']);
    expect(texts(canvases[1]!)).toEqual([
      'Entry Entry Alpha', 'Stop Stop Alpha', 'Target 1 Target Alpha', 'LONG', 'Risk/reward Alpha RR',
    ]);
    expect(texts(canvases[2]!)).toEqual([
      'Entry Entry Beta', 'Stop Stop Beta', 'Target 1 Target Beta', 'SHORT', 'Risk/reward Beta RR',
    ]);
    expect(texts(canvases[3]!)).toEqual(['1', '2', 'Pattern Alpha']);
    expect(texts(canvases[4]!)).toEqual(['1', '2', 'Pattern Beta']);
    canvases.forEach((operations) => {
      expect(operations.filter(([name]) => name === 'drawSource')).toEqual([
        ['drawSource', 'synthetic-800x600', 800, 600],
      ]);
    });
  });

  it('returns the empty output contract without decoding or creating canvases', async () => {
    // Breaks on: creating blank artifacts for empty report arrays or returning unstable shapes.
    const inputReport = report();
    inputReport.levels = [];
    inputReport.signals = [];
    inputReport.patterns = [];
    const { dependencies, canvases } = recordingCanvases();

    await expect(buildAnnotations(image, inputReport, dependencies)).resolves.toEqual({
      levels: null,
      signals: {},
      patterns: {},
    });
    expect(canvases).toEqual([]);
  });
});
