import { describe, expect, it } from 'vitest';
import type { AnalysisReport, DrawingInstruction } from './analysis';
import { tradeSignalDrawings } from './drawing-groups';

const drawing = (id: string, tool: DrawingInstruction['tool']): DrawingInstruction => ({
  id,
  tool,
  label: id,
  points: [{ timestamp: null, price: 100, timeLabel: null, xRatio: 0.5, yRatio: 0.5 }],
  reason: 'test',
  evidenceIds: [],
  confidence: 0.9,
});

describe('tradeSignalDrawings', () => {
  it('returns only the drawings referenced by one signal', () => {
    const report = {
      drawings: [
        drawing('s01-entry', 'entry_line'),
        drawing('s01-stop', 'stop_line'),
        drawing('s01-target', 'target_line'),
        drawing('s02-entry', 'entry_line'),
        drawing('s02-stop', 'stop_line'),
        drawing('s02-target', 'target_line'),
      ],
    } as AnalysisReport;

    expect(tradeSignalDrawings(report, ['s02-entry', 's02-stop', 's02-target']).map((item) => item.id))
      .toEqual(['s02-entry', 's02-stop', 's02-target']);
  });

  it('does not include an unreferenced entry, stop, or target drawing', () => {
    const report = {
      drawings: [drawing('owned', 'entry_line'), drawing('other', 'target_line')],
    } as AnalysisReport;

    expect(tradeSignalDrawings(report, ['owned']).map((item) => item.id)).toEqual(['owned']);
  });
});
