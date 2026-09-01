import { z } from 'zod';
import type { OutputLanguage } from './shared-stage-types';

export const signalTypeCodes = [
  'breakout_retest',
  'support_bounce',
  'resistance_rejection',
  'range_breakout',
  'failed_breakout',
  'trend_pullback',
  'liquidity_sweep',
  'momentum_reversal',
  'other',
] as const;

export const signalTypeSchema = z.enum(signalTypeCodes);
export type SignalTypeCode = z.infer<typeof signalTypeSchema>;

const labels: Record<OutputLanguage, Record<SignalTypeCode, string>> = {
  en: {
    breakout_retest: 'Breakout and retest',
    support_bounce: 'Support bounce',
    resistance_rejection: 'Resistance rejection',
    range_breakout: 'Range breakout',
    failed_breakout: 'Failed breakout',
    trend_pullback: 'Trend pullback',
    liquidity_sweep: 'Liquidity sweep',
    momentum_reversal: 'Momentum reversal',
    other: 'Other trade signal',
  },
  'zh-CN': {
    breakout_retest: '突破后回踩',
    support_bounce: '支撑位反弹',
    resistance_rejection: '阻力位拒绝',
    range_breakout: '区间突破',
    failed_breakout: '假突破',
    trend_pullback: '趋势回调',
    liquidity_sweep: '流动性清扫',
    momentum_reversal: '动量反转',
    other: '其他交易信号',
  },
};

export function localizedSignalType(type: SignalTypeCode, language: OutputLanguage): string {
  return labels[language][type];
}
