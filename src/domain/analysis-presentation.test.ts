import { describe, expect, it } from 'vitest';
import { decisionSummary, effectiveRLabel, gateReason, marketRegimeLabel, priceBandLabel, sanitizeAnalysisReportForDisplay, setupLabel, stripInternalEvidenceRefs, targetSourceLabel } from './analysis-presentation';

describe('analysis presentation', () => {
  it('localizes deterministic setup states and gate reasons', () => {
    expect(setupLabel('trend_pullback', 'zh-CN')).toBe('趋势回调');
    expect(setupLabel('WAIT', 'en')).toBe('Waiting');
    expect(gateReason('closed_trigger_candle_pending', 'zh-CN')).toContain('收盘');
    expect(targetSourceLabel('measured_move', 'zh-CN')).toBe('测量目标');
  });

  it('formats price bands and effective R without inventing values', () => {
    expect(priceBandLabel({ lower: 100, upper: 101, label: '100–101', precision: 'estimated' })).toBe('100–101');
    expect(effectiveRLabel({ effectiveRToT1: { gross: 2, net: 1.8 } } as never)).toBe('1:1.80');
    expect(effectiveRLabel({ effectiveRToT1: null } as never)).toBeNull();
  });

  it('makes the market regime directional and removes legacy risk-gate boilerplate', () => {
    expect(marketRegimeLabel('trend', 'bullish', 'zh-CN')).toBe('上涨趋势');
    expect(marketRegimeLabel('trend', 'bearish', 'en')).toBe('Falling trend');
    expect(marketRegimeLabel('range', 'neutral', 'zh-CN')).toBe('区间震荡');
    expect(decisionSummary('暂无通过风险检查的可执行交易条件。等待回踩确认。')).toBe('等待回踩确认。');
    expect(decisionSummary('No actionable setup passed the risk checks. Wait for confirmation.')).toBe('Wait for confirmation.');
  });

  it('hides internal NE citations while preserving figure and structured evidence references', () => {
    expect(stripInternalEvidenceRefs('多头趋势延续（NE004至NE012），但阻力仍在（NE027、NE028）。'))
      .toBe('多头趋势延续，但阻力仍在。');
    expect(stripInternalEvidenceRefs('Bullish structure (NE004 to NE012), see F01.'))
      .toBe('Bullish structure, see F01.');

    const sanitized = sanitizeAnalysisReportForDisplay({
      decision: { summary: '趋势延续（NE004、NE005）。' },
      evidence: [{ id: 'NE004', claim: 'market state' }],
      marketState: { supportingEvidenceRefs: ['NE004'] },
      drawings: [{ evidenceIds: ['NE004'], figureId: 'F01', label: '趋势（NE004）' }],
    } as never);
    expect(sanitized.decision.summary).toBe('趋势延续。');
    expect(sanitized.evidence[0]!.id).toBe('NE004');
    expect(sanitized.marketState.supportingEvidenceRefs).toEqual(['NE004']);
    expect(sanitized.drawings[0]!.evidenceIds).toEqual(['NE004']);
    expect(sanitized.drawings[0]!.label).toBe('趋势');
    expect(sanitized.drawings[0]!.figureId).toBe('F01');
  });
});
