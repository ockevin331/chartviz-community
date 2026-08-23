import { describe, expect, it } from 'vitest';
import { visibleAnalysisProgress, type AnalysisProgressEvent } from '../src/domain/analysis-progress';

const event = (code: AnalysisProgressEvent['code'], index: number): AnalysisProgressEvent => ({
  code,
  createdAt: `2026-08-18T00:00:0${index}Z`,
});

describe('analysis progress presentation', () => {
  it('keeps only the latest three distinct user-facing updates', () => {
    const visible = visibleAnalysisProgress([
      event('preparing', 0), event('reading_chart', 1), event('reading_chart', 2),
      event('reviewing_clues', 3), event('checking_signals', 4),
    ], 'en');

    expect(visible.map((item) => item.code)).toEqual([
      'reading_chart', 'reviewing_clues', 'checking_signals',
    ]);
  });

  it('localizes abstract updates without exposing internal pipeline names', () => {
    const visible = visibleAnalysisProgress([event('preparing_result', 0)], 'zh-CN');

    expect(visible[0]?.message).toBe('正在整理分析结果…');
    expect(visible[0]?.message).not.toMatch(/LLM|prompt|schema|模型|提示词/i);
  });
});
