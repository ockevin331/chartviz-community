const prohibitedSourceClaims: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  {
    label: 'exchange API or feed',
    pattern: /\b(?:exchange|binance|okx|hyperliquid)(?:\s*['’]s)?[\s:;,./_-]*(?:apis?|data|feeds?)\b/i,
  },
  {
    label: 'calculated feed',
    pattern: /\bcalculated(?:\s*['’]s)?[\s:;,./_-]+(?:data|feeds?|indicators?)\b/i,
  },
  {
    label: 'web search',
    pattern: /\b(?:web|internet|online)(?:\s*['’]s)?[\s:;,./_-]+search(?:es)?\b/i,
  },
  {
    label: 'news reports',
    pattern: /\bnews(?:\s*['’]s)?[\s:;,./_-]+(?:reports?|search(?:es)?|sources?|feeds?)\b/i,
  },
  {
    label: 'external data',
    pattern: /\bexternal(?:\s*['’]s)?[\s:;,./_-]+(?:data|feeds?|sources?)\b/i,
  },
  {
    label: 'exchange API or feed',
    pattern: /(?:交易所|币安|欧易|海波龙)(?:的)?[\s：:、,，-]*(?:接口|APIs?|数据源|行情源)/iu,
  },
  {
    label: 'calculated feed',
    pattern: /(?:计算|推算)(?:的)?[\s：:、,，-]*(?:数据源|行情源|指标数据|数据|行情)/u,
  },
  {
    label: 'web search',
    pattern: /(?:网页|网络|互联网|在线)(?:的)?[\s：:、,，-]*(?:搜索|检索)/u,
  },
  {
    label: 'news reports',
    pattern: /新闻(?:报道|报告|搜索|消息源|数据源)/u,
  },
  {
    label: 'external data',
    pattern: /外部(?:数据|行情|数据源|信息源)/u,
  },
];

const numericEnglishWordTimeframe = /(?<![\p{L}\p{N}])(\d+(?:\.\d+)?)\s*-?\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|mos?|years?|yrs?)(?![\p{L}\p{N}])/giu;
const compactEnglishTimeframe = /(?<![\p{L}\p{N}.])(\d+)\s*([smhHdDwWMyY])(?![\p{L}\p{N}])/gu;
const numericChineseTimeframe = /(\d+(?:\.\d+)?)\s*(秒|分钟|分|小时|时|日|天|周|月|年)/gu;
const namedEnglishTimeframe = /\b(hourly|daily|weekly|monthly|quarterly|yearly)\b/giu;
const namedChineseTimeframe = /每分钟|分钟(?:线|图|级别|周期)|每小时|小时(?:线|图|级别|周期)|每日|每天|日(?:线|图|级别|周期)|每周|周(?:线|图|级别|周期)|每月|月(?:线|图|级别|周期)|每年|年(?:线|图|级别|周期)/gu;
const explicitMultipleTimeframeClaim = /\b(?:(?:second|another|additional|multiple|combined|multi)\s*[-–—]?\s*(?:visible\s+)?timeframes?|(?:higher|lower)\s+timeframe)\b/i;
const explicitChineseMultipleTimeframeClaim = /(?:第二(?:个)?|另一个|额外|多个|多重|多|组合|跨)(?:可见)?(?:时间框架|时间周期|周期)/u;

function durationKey(quantity: string, unit: string): string {
  const value = Number(quantity);
  const normalizedUnit = unit.toLowerCase();
  if (/^(?:sec|secs|second|seconds|秒)$/.test(normalizedUnit)) return `seconds:${value}`;
  if (/^(?:min|mins|minute|minutes|分|分钟)$/.test(normalizedUnit)) return `seconds:${value * 60}`;
  if (/^(?:hr|hrs|hour|hours|时|小时)$/.test(normalizedUnit)) return `seconds:${value * 3600}`;
  if (/^(?:day|days|日|天)$/.test(normalizedUnit)) return `seconds:${value * 86400}`;
  if (/^(?:week|weeks|周)$/.test(normalizedUnit)) return `seconds:${value * 604800}`;
  if (/^(?:mo|mos|month|months|月)$/.test(normalizedUnit)) return `months:${value}`;
  return `years:${value}`;
}

function compactDurationKey(quantity: string, unit: string): string {
  const value = Number(quantity);
  if (unit === 'M') return `months:${value}`;
  if (unit.toLowerCase() === 's') return `seconds:${value}`;
  if (unit.toLowerCase() === 'm') return `seconds:${value * 60}`;
  if (unit.toLowerCase() === 'h') return `seconds:${value * 3600}`;
  if (unit.toLowerCase() === 'd') return `seconds:${value * 86400}`;
  if (unit.toLowerCase() === 'w') return `seconds:${value * 604800}`;
  return `years:${value}`;
}

function hasTimeframeContext(text: string, matchIndex: number, matchLength: number): boolean {
  const before = text.slice(Math.max(0, matchIndex - 24), matchIndex);
  const after = text.slice(matchIndex + matchLength, matchIndex + matchLength + 24);
  return /(?:\b(?:chart|timeframe|interval|candles?|bars?)\s*[:=]?\s*$|(?:图表|图|周期|级别|K线)\s*[:：=]?\s*$)/iu.test(before)
    || /^\s*(?:[-–—/:]\s*)?(?:chart|timeframe|interval|candles?|bars?|view|图表|图|周期|级别|K线)/iu.test(after);
}

function collectCanonicalTimeframes(text: string, declaredTimeframe = false): string[] {
  const mentions: string[] = [];
  for (const match of text.matchAll(numericEnglishWordTimeframe)) {
    if (!declaredTimeframe && !hasTimeframeContext(text, match.index, match[0].length)) continue;
    mentions.push(durationKey(match[1]!, match[2]!));
  }
  for (const match of text.matchAll(compactEnglishTimeframe)) {
    if (!declaredTimeframe && !hasTimeframeContext(text, match.index, match[0].length)) continue;
    const unit = match[2]!;
    mentions.push(compactDurationKey(match[1]!, unit));
  }
  for (const match of text.matchAll(numericChineseTimeframe)) {
    if (!declaredTimeframe && !hasTimeframeContext(text, match.index, match[0].length)) continue;
    mentions.push(durationKey(match[1]!, match[2]!));
  }
  for (const match of text.matchAll(namedEnglishTimeframe)) {
    if (!declaredTimeframe && !hasTimeframeContext(text, match.index, match[0].length)) continue;
    const keys: Record<string, string> = {
      hourly: 'seconds:3600',
      daily: 'seconds:86400',
      weekly: 'seconds:604800',
      monthly: 'months:1',
      quarterly: 'months:3',
      yearly: 'years:1',
    };
    mentions.push(keys[match[1]!.toLowerCase()]!);
  }
  for (const match of text.matchAll(namedChineseTimeframe)) {
    const value = match[0];
    if (!declaredTimeframe
      && !/(?:线|图|级别|周期)/u.test(value)
      && !hasTimeframeContext(text, match.index, match[0].length)) continue;
    if (/分钟/.test(value)) mentions.push('seconds:60');
    else if (/小时/.test(value)) mentions.push('seconds:3600');
    else if (/(?:每日|每天|日(?:线|图|级别|周期))/.test(value)) mentions.push('seconds:86400');
    else if (/周/.test(value)) mentions.push('seconds:604800');
    else if (/月/.test(value)) mentions.push('months:1');
    else mentions.push('years:1');
  }
  return mentions;
}

export type UnexpectedSourceClaim = Readonly<{ label: string }>;

export function findUnexpectedSourceClaim(text: string): UnexpectedSourceClaim | null {
  for (const { label, pattern } of prohibitedSourceClaims) {
    if (pattern.test(text)) {
      return { label };
    }
  }
  return null;
}

export type TimeframeConflict = Readonly<{
  index: number;
  text: string;
  detected: readonly string[];
}>;

export function findSingleTimeframeConflict(
  texts: readonly string[],
  declaredTimeframe: string | null,
): TimeframeConflict | null {
  const mentions = new Set<string>();
  if (declaredTimeframe !== null) {
    const declaredMentions = collectCanonicalTimeframes(declaredTimeframe, true);
    declaredMentions.forEach((timeframe) => mentions.add(timeframe));
    if (explicitMultipleTimeframeClaim.test(declaredTimeframe)
      || explicitChineseMultipleTimeframeClaim.test(declaredTimeframe)
      || mentions.size > 1) {
      return { index: -1, text: declaredTimeframe, detected: [...mentions] };
    }
  }
  for (const [index, text] of texts.entries()) {
    if (explicitMultipleTimeframeClaim.test(text) || explicitChineseMultipleTimeframeClaim.test(text)) {
      return { index, text, detected: collectCanonicalTimeframes(text) };
    }
    const detected = collectCanonicalTimeframes(text);
    const combined = new Set([...mentions, ...detected]);
    if (combined.size > 1) return { index, text, detected };
    detected.forEach((timeframe) => mentions.add(timeframe));
  }
  return null;
}
