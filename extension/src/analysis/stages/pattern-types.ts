import { z } from 'zod';
import type { OutputLanguage } from './shared-stage-types';

export const canonicalPatternTypes = [
  'horizontal_range',
  'rising_channel',
  'falling_channel',
  'ascending_triangle',
  'descending_triangle',
  'symmetrical_triangle',
  'rising_wedge',
  'falling_wedge',
  'bull_flag',
  'bear_flag',
  'pennant',
  'double_top',
  'double_bottom',
  'head_and_shoulders',
  'inverse_head_and_shoulders',
  'cup_and_handle',
  'rounding_top',
  'rounding_bottom',
] as const;

export const canonicalPatternTypeSchema = z.enum(canonicalPatternTypes);
export type CanonicalPatternType = z.infer<typeof canonicalPatternTypeSchema>;

const labels: Record<OutputLanguage, Record<CanonicalPatternType, string>> = {
  en: {
    horizontal_range: 'Horizontal range',
    rising_channel: 'Rising channel',
    falling_channel: 'Falling channel',
    ascending_triangle: 'Ascending triangle',
    descending_triangle: 'Descending triangle',
    symmetrical_triangle: 'Symmetrical triangle',
    rising_wedge: 'Rising wedge',
    falling_wedge: 'Falling wedge',
    bull_flag: 'Bull flag',
    bear_flag: 'Bear flag',
    pennant: 'Pennant',
    double_top: 'Double top',
    double_bottom: 'Double bottom',
    head_and_shoulders: 'Head and shoulders',
    inverse_head_and_shoulders: 'Inverse head and shoulders',
    cup_and_handle: 'Cup and handle',
    rounding_top: 'Rounding top',
    rounding_bottom: 'Rounding bottom',
  },
  'zh-CN': {
    horizontal_range: '横盘整理区间',
    rising_channel: '上升通道',
    falling_channel: '下降通道',
    ascending_triangle: '上升三角形',
    descending_triangle: '下降三角形',
    symmetrical_triangle: '对称三角形',
    rising_wedge: '上升楔形',
    falling_wedge: '下降楔形',
    bull_flag: '看涨旗形',
    bear_flag: '看跌旗形',
    pennant: '三角旗形',
    double_top: '双顶',
    double_bottom: '双底',
    head_and_shoulders: '头肩顶',
    inverse_head_and_shoulders: '头肩底',
    cup_and_handle: '杯柄形态',
    rounding_top: '圆弧顶',
    rounding_bottom: '圆弧底',
  },
};

export function localizedPatternName(type: CanonicalPatternType, language: OutputLanguage): string {
  return labels[language][type];
}
