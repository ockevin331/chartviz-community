import { describe, expect, it } from 'vitest';
import type { AnalysisReport } from '../src/domain/analysis';
import { groupReportDrawings } from '../src/domain/drawing-groups';

const drawing = (id: string, tool: AnalysisReport['drawings'][number]['tool']) => ({
  id, tool, label: id, points: [{ timestamp: null, price: 100, timeLabel: null, xRatio: .5, yRatio: .5 }],
  reason: id, evidenceIds: [], confidence: .8, figureId: null,
});

describe('annotation drawing groups', () => {
  it('separates levels, trade signals, patterns, and structure without duplicating drawings', () => {
    const report = {
      drawings: [drawing('support-1', 'support_line'), drawing('signal-entry', 'entry_line'), drawing('pattern-1', 'trend_line'), drawing('trend-1', 'trend_line')],
      keyLevels: [{ drawingId: 'support-1' }],
      tradeSignals: [{ drawingRefs: ['signal-entry'] }],
      patterns: [{ drawingRefs: ['pattern-1'] }],
    } as unknown as AnalysisReport;
    const groups = groupReportDrawings(report);
    expect(groups.map((group) => [group.id, group.drawings.map((item) => item.id)])).toEqual([
      ['levels', ['support-1']], ['signals', ['signal-entry']], ['patterns', ['pattern-1']], ['structure', ['trend-1']],
    ]);
  });
});
