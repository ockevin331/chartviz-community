import { describe, expect, it } from 'vitest';
import policy from '../../contracts/analysis-validation/v1/cases.json';
import { collectReportQualityWarnings } from '../src/analysis/stages/report-quality-warnings';

describe('report quality warnings', () => {
  it('reports advisory prose findings without throwing', () => {
    const value = {
      timeframe: '1h',
      timeframeReference: 'The prose mentions a 4h chart.',
      sourceClaim: 'Binance API confirms the move.',
      internalReference: 'Wait while L01 remains under review.',
      mixedLanguage: '价格 remains sideways',
    };

    expect(collectReportQualityWarnings({
      stage: 'evidence_reasoning',
      value,
      declaredTimeframe: '1h',
      outputLanguage: 'zh-CN',
    })).toEqual([
      {
        stage: 'evidence_reasoning',
        code: 'possible_timeframe_reference',
        path: ['timeframeReference'],
        valuePreview: 'The prose mentions a 4h chart.',
      },
      {
        stage: 'evidence_reasoning',
        code: 'output_language_mismatch',
        path: ['timeframeReference'],
        valuePreview: 'The prose mentions a 4h chart.',
      },
      {
        stage: 'evidence_reasoning',
        code: 'unexpected_source_claim',
        path: ['sourceClaim'],
        valuePreview: 'Binance API confirms the move.',
      },
      {
        stage: 'evidence_reasoning',
        code: 'output_language_mismatch',
        path: ['sourceClaim'],
        valuePreview: 'Binance API confirms the move.',
      },
      {
        stage: 'evidence_reasoning',
        code: 'internal_id_exposed',
        path: ['internalReference'],
        valuePreview: 'Wait while L01 remains under review.',
      },
      {
        stage: 'evidence_reasoning',
        code: 'output_language_mismatch',
        path: ['internalReference'],
        valuePreview: 'Wait while L01 remains under review.',
      },
      {
        stage: 'evidence_reasoning',
        code: 'output_language_mismatch',
        path: ['mixedLanguage'],
        valuePreview: '价格 remains sideways',
      },
    ]);
  });

  it('does not mistake calendar dates for chart timeframes', () => {
    expect(collectReportQualityWarnings({
      stage: 'visual_extraction',
      value: {
        first: '9月4日图表高点',
        second: '2026年9月4日低点',
        third: 'Sep 4 chart high',
      },
      declaredTimeframe: '1h',
      outputLanguage: 'zh-CN',
    }).filter(({ code }) => code === 'possible_timeframe_reference')).toEqual([]);
  });

  it('implements every prose case in the shared deterministic policy', () => {
    const chineseCases = new Set(['zh-calendar-day', 'zh-full-date', 'mixed-language']);
    for (const testCase of policy.cases.filter((entry) => entry.kind === 'prose')) {
      const warnings = collectReportQualityWarnings({
        stage: 'evidence_reasoning',
        value: { summary: testCase.text },
        declaredTimeframe: '1h',
        outputLanguage: chineseCases.has(testCase.name) ? 'zh-CN' : 'en',
      });

      expect(testCase.hardFailure, testCase.name).toBe(false);
      if ('warning' in testCase) {
        expect(warnings.map(({ code }) => code), testCase.name).toContain(testCase.warning);
      } else {
        expect(warnings, testCase.name).toEqual([]);
      }
    }
  });

  it('bounds previews and deduplicates warnings by stage, code, and path', () => {
    const warnings = collectReportQualityWarnings({
      stage: 'evidence_reasoning',
      value: { summary: `L01 ${'English prose '.repeat(20)}` },
      declaredTimeframe: '1h',
      outputLanguage: 'zh-CN',
    });

    expect(warnings.filter(({ code }) => code === 'internal_id_exposed')).toHaveLength(1);
    expect(Math.max(...warnings.map(({ valuePreview }) => valuePreview.length))).toBeLessThanOrEqual(120);
  });
});
