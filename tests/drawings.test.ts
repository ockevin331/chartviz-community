import { describe, expect, it } from 'vitest';
import { drawingInstructionSchema } from '../src/domain/analysis';

const drawing = {
  id: 'support-1',
  tool: 'support_line',
  label: 'Support',
  points: [{ timestamp: null, price: 112500, timeLabel: null, xRatio: null, yRatio: 0.72 }],
  reason: 'Repeated rejection from the level.',
  evidenceIds: ['bullish-1'],
  confidence: 0.82,
};

describe('drawing instruction schema', () => {
  it('accepts a normalized chart annotation', () => {
    expect(drawingInstructionSchema.parse(drawing)).toEqual(drawing);
  });

  it('rejects coordinates outside the chart crop', () => {
    expect(() => drawingInstructionSchema.parse({
      ...drawing,
      points: [{ ...drawing.points[0], yRatio: 1.2 }],
    })).toThrow();
  });
});
