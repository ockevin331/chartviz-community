import { describe, expect, it } from 'vitest';
import fixture from '../contracts/extension-cloud/v1/fixtures/single-completed-task.json';
import { parseExtensionAnalysisTask } from '../src/cloud/cloud-task-schema';
import { adaptCloudPresentation } from '../src/presentation/cloud-presentation-adapter';

function report() {
  const task = parseExtensionAnalysisTask(structuredClone(fixture));
  if (!task.report) throw new Error('fixture report missing');
  return task.report;
}

describe('Cloud presentation adapter', () => {
  it('maps the complete Cloud report without leaking drawing coordinates into visible items', () => {
    const bundle = adaptCloudPresentation(report());

    expect(bundle.report).toMatchObject({
      schemaVersion: 'presentation-1.0',
      context: {
        instrument: 'BTC/USDT', venue: 'TradingView', outputLanguage: 'en',
        captures: [{ captureId: 'C01', timeframe: '15m', width: 1280, height: 720 }],
      },
      conclusion: { direction: 'long', trend: 'bullish', structure: 'hh-hl' },
      levels: [{ id: 'L01', type: 'support' }, { id: 'L02', type: 'resistance' }],
      tradeSignals: [{
        id: 'S01', direction: 'long', entry: { priceLabel: '65,350' },
        stopLoss: { priceLabel: '64,900' }, invalidation: 'The retest closes back below 64,900.',
      }],
      patterns: [{ id: 'P01', name: 'Rising channel' }],
    });
    expect(JSON.stringify(bundle.report)).not.toContain('yRatio');
    expect(JSON.stringify(bundle.report)).not.toContain('xRatio');
  });

  it('normalizes native drawings and completes signal lines only from explicit report coordinates', () => {
    const bundle = adaptCloudPresentation(report());

    expect(bundle.drawings.map(({ refId, meaning, tool }) => ({ refId, meaning, tool }))).toEqual([
      { refId: 'L01', meaning: 'support', tool: 'horizontal_line' },
      { refId: 'L02', meaning: 'resistance', tool: 'horizontal_line' },
      { refId: 'S01', meaning: 'long_entry', tool: 'entry_arrow' },
      { refId: 'S01', meaning: 'stop', tool: 'stop_line' },
      { refId: 'S01', meaning: 'target', tool: 'target_line' },
      { refId: 'S01', meaning: 'target', tool: 'target_line' },
      { refId: 'P01', meaning: 'pattern', tool: 'channel' },
    ]);
    expect(bundle.drawings[2]).toMatchObject({
      caption: 'Approximately 1:2',
      points: [{ xRatio: 0.9, yRatio: 0.31, priceLabel: '65,350' }],
    });
    expect(bundle.drawings[3]?.points).toEqual([{
      xRatio: null, yRatio: 0.43, priceLabel: '64,900', timeAnchor: null,
    }]);
  });

  it('uses explicit item coordinates as a deterministic fallback but never invents missing geometry', () => {
    const value = report();
    value.drawings = value.drawings?.filter(({ layer }) => layer !== 'levels' && layer !== 'signal') ?? [];
    value.levels![1]!.yRatio = null;
    value.tradeSignals![0]!.entry.xRatio = null;
    value.drawings![0]!.points[0]!.xRatio = null;

    const bundle = adaptCloudPresentation(value);

    expect(bundle.drawings.find(({ refId }) => refId === 'L01')).toMatchObject({
      meaning: 'support', points: [{ xRatio: null, yRatio: 0.7 }],
    });
    expect(bundle.drawings.some(({ refId }) => refId === 'L02')).toBe(false);
    expect(bundle.drawings.some(({ meaning }) => meaning.endsWith('_entry'))).toBe(false);
    expect(bundle.drawings.some(({ layer }) => layer === 'pattern')).toBe(false);
    expect(JSON.stringify(bundle.drawings)).not.toContain('0.5');
  });
});
