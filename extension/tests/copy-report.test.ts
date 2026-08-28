import { describe, expect, it } from 'vitest';
import { parseReportPresentationModel } from '../src/presentation/report-presentation-model';
import { reportToText } from '../src/ui/export/copy-report';
import { validPresentationBundle } from './presentation-fixtures';

const presentation = parseReportPresentationModel(structuredClone(validPresentationBundle.report));

describe('reportToText presentation export', () => {
  it('exports the visible English presentation without schema or drawing fields', () => {
    const text = reportToText(presentation, 'en');

    expect(text.split('\n').slice(0, 6)).toEqual([
      'ChartViz — LONG',
      'Instrument: BTC/USDT',
      'Timeframe: 15m',
      'Trend: Bullish · Structure: Higher highs and higher lows · Strength: Moderate · Confidence: 78%',
      'Higher lows remain visible.',
      'Primary risk: Resistance may reject price.',
    ]);
    expect(text).toContain('Trade signals: S01 · LONG · Breakout and retest');
    expect(text).toContain('Chart patterns: Rising channel · Forming · Bullish');
    expect(text).not.toMatch(/schemaVersion|captureId|xRatio|yRatio|drawings/i);
  });

  it('exports Chinese labels while preserving the model-authored Chinese-or-English content verbatim', () => {
    const text = reportToText(presentation, 'zh-CN');

    expect(text.split('\n').slice(0, 4)).toEqual([
      'ChartViz — 做多',
      '交易品种: BTC/USDT',
      '周期: 15m',
      '当前走势: 上涨 · 市场结构: 高点和低点逐步抬高 · 强度: 中等 · 置信度: 78%',
    ]);
    expect(text).toContain('交易信号解读: S01 · 做多 · Breakout and retest');
    expect(text).toContain('图表形态: Rising channel · 形成中 · 上涨');
  });
});
