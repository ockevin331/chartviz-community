import { describe, expect, it } from 'vitest';
import { parsePresentationBundle } from '../src/presentation/report-presentation-model';
import { validPresentationBundle } from './presentation-fixtures';

function clone(): any {
  return structuredClone(validPresentationBundle);
}

describe('presentation-1.0 contract', () => {
  it('parses the producer-neutral report and drawing bundle', () => {
    const bundle = parsePresentationBundle(clone());

    expect(bundle.report.schemaVersion).toBe('presentation-1.0');
    expect(bundle.report.context.captures.map(({ captureId }) => captureId)).toEqual(['C01']);
    expect(bundle.drawings.map(({ meaning }) => meaning)).toEqual([
      'support', 'long_entry', 'stop', 'target', 'pattern',
    ]);
  });

  it('accepts capture-scoped market-structure geometry', () => {
    const value = clone();
    value.drawings.push({
      id: 'D06',
      captureId: 'C01',
      layer: 'structure',
      refId: 'C01',
      meaning: 'structure',
      caption: null,
      tool: 'range',
      points: [
        { xRatio: 0.15, yRatio: 0.25, priceLabel: null, timeAnchor: null },
        { xRatio: 0.85, yRatio: 0.25, priceLabel: null, timeAnchor: null },
        { xRatio: 0.15, yRatio: 0.75, priceLabel: null, timeAnchor: null },
        { xRatio: 0.85, yRatio: 0.75, priceLabel: null, timeAnchor: null },
      ],
    });

    expect(parsePresentationBundle(value).drawings.at(-1)).toMatchObject({
      layer: 'structure',
      refId: 'C01',
      meaning: 'structure',
      tool: 'range',
    });
  });

  it.each([
    ['another capture reference', (drawing: any) => { drawing.refId = 'C02'; }],
    ['a non-structure tool', (drawing: any) => { drawing.tool = 'horizontal_line'; }],
  ])('rejects structure geometry with %s', (_name, mutate) => {
    const value = clone();
    const drawing = {
      id: 'D06', captureId: 'C01', layer: 'structure', refId: 'C01',
      meaning: 'structure', caption: null, tool: 'trend_line',
      points: [
        { xRatio: 0.2, yRatio: 0.7, priceLabel: null, timeAnchor: null },
        { xRatio: 0.8, yRatio: 0.3, priceLabel: null, timeAnchor: null },
      ],
    };
    mutate(drawing);
    value.drawings.push(drawing);

    expect(() => parsePresentationBundle(value)).toThrow();
  });

  it.each([
    ['duplicate capture IDs', (value: any) => value.report.context.captures.push({ ...value.report.context.captures[0] })],
    ['duplicate item IDs', (value: any) => value.report.levels.push({ ...value.report.levels[0] })],
    ['duplicate drawing IDs', (value: any) => value.drawings.push({ ...value.drawings[0] })],
    ['unknown fields', (value: any) => { value.report.privateTrace = 'secret'; }],
    ['out-of-range coordinates', (value: any) => { value.drawings[0].points[0].yRatio = 1.1; }],
    ['non-finite coordinates', (value: any) => { value.drawings[0].points[0].yRatio = Number.NaN; }],
    ['missing capture reference', (value: any) => { value.report.levels[0].captureId = 'C99'; }],
    ['wrong drawing layer reference', (value: any) => { value.drawings[0].layer = 'signal'; }],
    ['wrong tool meaning', (value: any) => { value.drawings[1].meaning = 'support'; }],
    ['horizontal line with X', (value: any) => { value.drawings[0].points[0].xRatio = 0.5; }],
    ['short channel geometry', (value: any) => { value.drawings[4].points.pop(); }],
  ])('rejects %s', (_name, mutate) => {
    const value = clone();
    mutate(value);
    expect(() => parsePresentationBundle(value)).toThrow();
  });
});
