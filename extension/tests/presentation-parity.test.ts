import { describe, expect, it } from 'vitest';
import fixture from '../contracts/extension-cloud/v1/fixtures/single-completed-task.json';
import { parseExtensionAnalysisTask } from '../src/cloud/cloud-task-schema';
import type { AnalysisCapture } from '../src/analysis/runtime/analysis-runtime';
import { adaptCloudPresentation } from '../src/presentation/cloud-presentation-adapter';
import { adaptDirectPresentation } from '../src/presentation/direct-presentation-adapter';
import type { PresentationBundle } from '../src/presentation/report-presentation-model';
import { communityReport, processedImage } from './community-ui-fixtures';

const capture: AnalysisCapture = {
  image: processedImage,
  context: {
    instrument: 'BTC/USDT', timeframe: '15m', site: 'tradingview',
    exchange: 'BINANCE', pageType: 'advanced-chart',
  },
};

function cloudReport() {
  const task = parseExtensionAnalysisTask(structuredClone(fixture));
  if (!task.report) throw new Error('fixture report missing');
  task.report.levels = task.report.levels?.slice(0, 1) ?? [];
  task.report.drawings = task.report.drawings?.filter(({ refId }) => refId !== 'L02') ?? [];
  return task.report;
}

function visibleShape(bundle: PresentationBundle) {
  const { report, drawings } = bundle;
  return {
    sections: [
      'conclusion', 'marketExplanation',
      ...(report.levels.length ? ['levels'] : []),
      'tradePlan',
      ...(report.tradeSignals.length ? ['tradeSignals'] : []),
      ...(report.patterns.length ? ['patterns'] : []),
      'riskNotice',
    ],
    direction: report.conclusion.direction,
    itemIds: {
      levels: report.levels.map(({ id }) => id),
      signals: report.tradeSignals.map(({ id }) => id),
      patterns: report.patterns.map(({ id }) => id),
    },
    drawingMeanings: drawings.map(({ meaning }) => meaning),
  };
}

describe('Direct and Cloud presentation parity', () => {
  it('produces the same visible single-chart structure from semantically equivalent fixtures', () => {
    const direct = adaptDirectPresentation(structuredClone(communityReport), capture, 'en');
    const cloud = adaptCloudPresentation(cloudReport());
    const expected = {
      sections: [
        'conclusion', 'marketExplanation', 'levels', 'tradePlan',
        'tradeSignals', 'patterns', 'riskNotice',
      ],
      direction: 'long',
      itemIds: { levels: ['L01'], signals: ['S01'], patterns: ['P01'] },
      drawingMeanings: [
        'support', 'long_entry', 'stop', 'target', 'target', 'pattern',
      ],
    };

    expect(visibleShape(direct)).toEqual(expected);
    expect(visibleShape(cloud)).toEqual(expected);
  });
});
