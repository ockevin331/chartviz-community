import type { AnalysisReport } from './analysis';

export type AnalysisLanguage = 'en' | 'zh-CN';
export type SetupEvaluation = AnalysisReport['setupEvaluation'];
export type PriceBand = NonNullable<SetupEvaluation['entry']>;

const TEXT = {
  en: {
    TRADE: 'Triggered', WAIT: 'Waiting', NO_TRADE: 'No trade',
    preparing: 'Waiting for trigger', triggered: 'Triggered', invalidated: 'Invalidated',
    trend_pullback: 'Trend pullback', range_breakout: 'Range breakout',
    failed_breakout: 'Failed breakout', none: 'No qualified setup',
  },
  'zh-CN': {
    TRADE: '已触发', WAIT: '等待', NO_TRADE: '不交易',
    preparing: '等待触发条件', triggered: '已触发', invalidated: '已失效',
    trend_pullback: '趋势回调', range_breakout: '区间突破',
    failed_breakout: '假突破反转', none: '暂无合格形态',
  },
} as const;

const GATE_TEXT: Record<string, { en: string; 'zh-CN': string }> = {
  setup_invalidated: { en: 'The setup has been invalidated.', 'zh-CN': '该交易结构已经失效。' },
  setup_outside_allowed_playbook: { en: 'No tested setup is present.', 'zh-CN': '当前不属于已验证的交易形态。' },
  direction_undefined: { en: 'Direction is not sufficiently defined.', 'zh-CN': '方向尚不明确。' },
  setup_location_undefined: { en: 'The setup is not at a qualified location.', 'zh-CN': '尚未到达合格的交易位置。' },
  setup_premise_undefined: { en: 'The setup premise is incomplete.', 'zh-CN': '交易前提不完整。' },
  entry_trigger_undefined: { en: 'No observable entry trigger is defined.', 'zh-CN': '尚无可观察的入场触发条件。' },
  entry_confirmation_undefined: { en: 'Entry confirmation is not defined.', 'zh-CN': '入场确认条件不完整。' },
  setup_evidence_undefined: { en: 'The setup lacks traceable evidence.', 'zh-CN': '交易计划缺少可追溯证据。' },
  setup_evidence_reference_invalid: { en: 'A setup evidence reference is invalid.', 'zh-CN': '交易计划引用了无效证据。' },
  entry_undefined: { en: 'A numeric entry zone is not available.', 'zh-CN': '尚无明确的入场价格区域。' },
  structural_invalidation_undefined: { en: 'Structural invalidation is not defined.', 'zh-CN': '结构失效位置尚未明确。' },
  credible_t1_undefined: { en: 'No credible first target is available.', 'zh-CN': '尚无可信的第一目标位。' },
  entry_stop_target_direction_invalid: { en: 'Entry, stop, and target are directionally inconsistent.', 'zh-CN': '入场、止损和目标价格的方向关系不成立。' },
  effective_r_to_t1_below_minimum: { en: 'Effective reward/risk to T1 is below the minimum.', 'zh-CN': '到第一目标位的有效盈亏比低于最低要求。' },
  setup_not_triggered: { en: 'The setup has not triggered.', 'zh-CN': '交易条件尚未触发。' },
  closed_trigger_candle_pending: { en: 'Waiting for the trigger candle to close.', 'zh-CN': '等待触发K线收盘确认。' },
  minimum_effective_r_not_configured: { en: 'Minimum effective reward/risk is not configured.', 'zh-CN': '尚未配置最低有效盈亏比。' },
  fees_or_slippage_not_configured: { en: 'Fee or slippage assumptions are missing.', 'zh-CN': '缺少手续费或滑点假设。' },
};

const STRUCTURED_REFERENCE_KEYS = new Set([
  'supportingEvidenceRefs',
  'opposingEvidenceRefs',
  'evidenceRefs',
  'evidenceIds',
]);
const NE_REFERENCE = 'NE\\d{3,}';
const NE_RANGE = `${NE_REFERENCE}(?:\\s*(?:-|–|—|to|through|至|到)\\s*${NE_REFERENCE})?`;
const NE_LIST = `${NE_RANGE}(?:\\s*(?:,|，|、|and|&|与|及|和)\\s*${NE_RANGE})*`;
const PARENTHETICAL_NE_CITATION = new RegExp(
  `\\s*[\\(（]\\s*(?:(?:see|refs?|evidence|参见|参考|证据)\\s*[:：]?\\s*)?${NE_LIST}\\s*[\\)）]`,
  'gi',
);
const INLINE_NE_CITATION = new RegExp(NE_LIST, 'gi');

export function stripInternalEvidenceRefs(text: string): string {
  let cleaned = text.replace(PARENTHETICAL_NE_CITATION, '');
  if (!new RegExp(NE_LIST, 'i').test(cleaned)) return cleaned;
  const replacement = /[\u3400-\u9fff]/u.test(cleaned) ? '相关证据' : 'the evidence';
  cleaned = cleaned
    .replace(INLINE_NE_CITATION, replacement)
    .replace(/[ \t]+([,.;:!?，。；：！？])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
  return cleaned.trim();
}

function sanitizeUserVisibleValue(value: unknown, key?: string): unknown {
  if (key && STRUCTURED_REFERENCE_KEYS.has(key)) return value;
  if (typeof value === 'string') return stripInternalEvidenceRefs(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeUserVisibleValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(
      ([itemKey, itemValue]) => [itemKey, sanitizeUserVisibleValue(itemValue, itemKey)],
    ));
  }
  return value;
}

export function sanitizeAnalysisReportForDisplay(report: AnalysisReport): AnalysisReport {
  const { evidence, ...userVisibleReport } = report;
  return {
    ...(sanitizeUserVisibleValue(userVisibleReport) as Omit<AnalysisReport, 'evidence'>),
    evidence,
  };
}

export function setupLabel(
  value: SetupEvaluation['actionability'] | SetupEvaluation['state'] | SetupEvaluation['playbook'],
  language: AnalysisLanguage,
): string {
  return (TEXT[language] as Record<string, string>)[value] ?? value;
}

export function marketRegimeLabel(
  regime: AnalysisReport['marketState']['regime'],
  bias: AnalysisReport['marketState']['directionalBias'],
  language: AnalysisLanguage,
): string {
  if (language === 'zh-CN') {
    if (regime === 'trend') {
      if (bias === 'bullish') return '上涨趋势';
      if (bias === 'bearish') return '下跌趋势';
      return bias === 'neutral' ? '趋势行情（方向中性）' : '趋势行情（方向待确认）';
    }
    return { range: '区间震荡', transition: '结构转换期', insufficient: '证据不足' }[regime];
  }
  if (regime === 'trend') {
    if (bias === 'bullish') return 'Rising trend';
    if (bias === 'bearish') return 'Falling trend';
    return bias === 'neutral' ? 'Trend · neutral direction' : 'Trend · direction unconfirmed';
  }
  return { range: 'Range-bound', transition: 'Transition', insufficient: 'Insufficient evidence' }[regime];
}

export function decisionSummary(summary: string): string {
  return summary.replace(
    /^(?:暂无通过风险检查的可执行交易条件。|No actionable setup passed the risk checks\.)\s*/,
    '',
  );
}

export function gateReason(code: string, language: AnalysisLanguage): string {
  return GATE_TEXT[code]?.[language] ?? code.replaceAll('_', ' ');
}

export function priceBandLabel(band: PriceBand | null): string | null {
  if (!band) return null;
  return band.label;
}

export function effectiveRLabel(setup: SetupEvaluation): string | null {
  const value = setup.effectiveRToT1?.net ?? setup.effectiveRToT1?.gross;
  if (value == null) return null;
  return `1:${value.toFixed(2)}`;
}

export function targetSourceLabel(
  source: SetupEvaluation['targets'][number]['source'],
  language: AnalysisLanguage,
): string {
  const labels = {
    en: {
      structure: 'Opposing structure',
      measured_move: 'Measured move',
      extension: 'Conditional extension',
    },
    'zh-CN': {
      structure: '对侧结构目标',
      measured_move: '测量目标',
      extension: '条件延伸目标',
    },
  } as const;
  return labels[language][source];
}

export function setupEvidence(report: AnalysisReport) {
  const ids = new Set([
    ...report.setupEvaluation.evidenceRefs,
    ...report.setupEvaluation.opposingEvidenceRefs,
  ]);
  return report.evidence.filter((item) => ids.has(item.id));
}

export function zoneFigure(report: AnalysisReport, zoneId: string): string | null {
  return report.drawings.find((drawing) => drawing.id === `zone-${zoneId.toLowerCase()}`)?.figureId ?? null;
}
