import { findSingleTimeframeConflict, findUnexpectedSourceClaim } from '../source-policy';
import type {
  AnalysisWarning,
  AnalysisWarningStage,
  OutputLanguage,
} from './shared-stage-types';

type StringLeaf = Readonly<{
  path: readonly (string | number)[];
  value: string;
}>;

export type QualityInspectionInput = Readonly<{
  stage: AnalysisWarningStage;
  value: unknown;
  declaredTimeframe: string | null;
  outputLanguage?: OutputLanguage;
}>;

const ignoredStringKeys = new Set([
  'schemaVersion',
  'id',
  'instrument',
  'timeframe',
  'priceLabel',
  'riskReward',
  'direction',
  'trend',
  'structure',
  'strength',
  'type',
  'tier',
  'status',
  'bias',
  'geometryKind',
  'signalType',
  'canonicalType',
]);

const internalId = /\b(?:SEG|L|I|S|P)\d{2}\b/;
const chineseCalendarDate = /(?:\d{4}年)?\d{1,2}月\d{1,2}日/gu;
const allowedTechnicalWord = /^(?:RSI|MACD|VWAP|EMA|SMA|ATR|OBV|OHLC|BTC|ETH|USDT)$/i;

function stringLeaves(
  value: unknown,
  path: readonly (string | number)[] = [],
  leaves: StringLeaf[] = [],
): readonly StringLeaf[] {
  if (typeof value === 'string') {
    const key = path[path.length - 1];
    if (!ignoredStringKeys.has(String(key))) leaves.push({ path, value });
    return leaves;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => stringLeaves(entry, [...path, index], leaves));
    return leaves;
  }
  if (value !== null && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => stringLeaves(entry, [...path, key], leaves));
  }
  return leaves;
}

function boundedPreview(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function hasLanguageMismatch(text: string, outputLanguage: OutputLanguage | undefined): boolean {
  if (outputLanguage === undefined) return false;
  const hasHan = /\p{Script=Han}/u.test(text);
  if (outputLanguage === 'en') return hasHan;

  const englishWords = text.match(/[A-Za-z]{4,}/g) ?? [];
  return englishWords.some((word) => !allowedTechnicalWord.test(word));
}

function hasPossibleTimeframeReference(text: string, declaredTimeframe: string | null): boolean {
  const withoutCalendarDates = text.replace(chineseCalendarDate, '');
  return findSingleTimeframeConflict([withoutCalendarDates], declaredTimeframe) !== null;
}

export function collectReportQualityWarnings(
  input: QualityInspectionInput,
): readonly AnalysisWarning[] {
  const warnings: AnalysisWarning[] = [];
  const seen = new Set<string>();
  const add = (
    code: AnalysisWarning['code'],
    path: readonly (string | number)[],
    value: string,
  ): void => {
    const key = `${input.stage}:${code}:${JSON.stringify(path)}`;
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push({
      stage: input.stage,
      code,
      path: Object.freeze([...path]),
      valuePreview: boundedPreview(value),
    });
  };

  for (const leaf of stringLeaves(input.value)) {
    try {
      if (hasPossibleTimeframeReference(leaf.value, input.declaredTimeframe)) {
        add('possible_timeframe_reference', leaf.path, leaf.value);
      }
      if (findUnexpectedSourceClaim(leaf.value) !== null) {
        add('unexpected_source_claim', leaf.path, leaf.value);
      }
      if (internalId.test(leaf.value)) {
        add('internal_id_exposed', leaf.path, leaf.value);
      }
      if (hasLanguageMismatch(leaf.value, input.outputLanguage)) {
        add('output_language_mismatch', leaf.path, leaf.value);
      }
    } catch {
      // Quality heuristics are advisory and must never block a valid report.
    }
  }

  return Object.freeze(warnings);
}
