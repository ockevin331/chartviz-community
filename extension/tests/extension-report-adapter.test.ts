import { describe, expect, it } from 'vitest';
import fixture from '../contracts/extension-cloud/v1/fixtures/single-completed-task.json';
import { parseExtensionAnalysisTask } from '../src/cloud/cloud-task-schema';
import { adaptExtensionReport } from '../src/cloud/extension-report-adapter';
import { parseCommunityReportV3Shape } from '../src/analysis/stages/community-report-v3';

function report() {
  const task = parseExtensionAnalysisTask(structuredClone(fixture));
  if (!task.report) throw new Error('fixture report missing');
  return task.report;
}

describe('Extension report presentation adapter', () => {
  it('maps the public report into the current single-timeframe UI model', () => {
    const converted = adaptExtensionReport(report());

    expect(converted).toMatchObject({
      schemaVersion: 'community-3.0',
      chart: { instrument: 'BTC/USDT', timeframe: '15m' },
      conclusion: { direction: 'long', trend: 'bullish', structure: 'hh-hl' },
    });
    expect(converted.levels[0]).toMatchObject({ id: 'L01', yRatio: 0.7 });
    expect(converted.tradeSignals[0]).toMatchObject({
      id: 'S01', entry: { xRatio: 0.9, yRatio: 0.31 },
    });
    expect(converted.patterns[0]?.geometry.geometryKind).toBe('channel');
    expect(() => parseCommunityReportV3Shape(converted)).not.toThrow();
  });

  it('drops only items with incomplete geometry and never invents midpoint coordinates', () => {
    const value = structuredClone(report());
    value.levels![0]!.yRatio = null;
    value.tradeSignals![0]!.entry.xRatio = null;
    value.drawings!.find((drawing) => drawing.layer === 'pattern')!.points[0]!.xRatio = null;

    const converted = adaptExtensionReport(value);

    expect(converted.levels.map(({ id }) => id)).not.toContain('L01');
    expect(converted.tradeSignals).toEqual([]);
    expect(converted.patterns).toEqual([]);
    expect(JSON.stringify(converted)).not.toContain('0.5');
    expect(() => parseCommunityReportV3Shape(converted)).not.toThrow();
  });
});
