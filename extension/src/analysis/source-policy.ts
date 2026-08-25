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

const numericEnglishTimeframe = /(?<![\p{L}\p{N}])(\d+(?:\.\d+)?)\s*-?\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|months?|mos?|mo|years?|yrs?|y)(?![\p{L}\p{N}])/giu;
const numericChineseTimeframe = /(\d+(?:\.\d+)?)\s*(秒|分钟|分|小时|时|日|天|周|月|年)/gu;
const namedEnglishTimeframe = /\b(hourly|daily|weekly|monthly|quarterly|yearly)\b/giu;
const namedChineseTimeframe = /每分钟|分钟(?:线|图|级别|周期)|每小时|小时(?:线|图|级别|周期)|每日|每天|日(?:线|图|级别|周期)|每周|周(?:线|图|级别|周期)|每月|月(?:线|图|级别|周期)|每年|年(?:线|图|级别|周期)/gu;
const explicitMultipleTimeframeClaim = /\b(?:(?:second|another|additional|multiple|combined|multi)\s*[-–—]?\s*(?:visible\s+)?timeframes?|(?:higher|lower)\s+timeframe)\b/i;
const explicitChineseMultipleTimeframeClaim = /(?:第二(?:个)?|另一个|额外|多个|多重|多|组合|跨)(?:可见)?(?:时间框架|时间周期|周期)/u;

function durationKey(quantity: string, unit: string): string {
  const value = Number(quantity);
  const normalizedUnit = unit.toLowerCase();
  if (/^(?:s|sec|secs|second|seconds|秒)$/.test(normalizedUnit)) return `seconds:${value}`;
  if (/^(?:m|min|mins|minute|minutes|分|分钟)$/.test(normalizedUnit)) return `seconds:${value * 60}`;
  if (/^(?:h|hr|hrs|hour|hours|时|小时)$/.test(normalizedUnit)) return `seconds:${value * 3600}`;
  if (/^(?:d|day|days|日|天)$/.test(normalizedUnit)) return `seconds:${value * 86400}`;
  if (/^(?:w|week|weeks|周)$/.test(normalizedUnit)) return `seconds:${value * 604800}`;
  if (/^(?:mo|mos|month|months|月)$/.test(normalizedUnit)) return `months:${value}`;
  return `years:${value}`;
}

function collectCanonicalTimeframes(text: string): string[] {
  const mentions: string[] = [];
  for (const match of text.matchAll(numericEnglishTimeframe)) {
    mentions.push(durationKey(match[1]!, match[2]!));
  }
  for (const match of text.matchAll(numericChineseTimeframe)) {
    mentions.push(durationKey(match[1]!, match[2]!));
  }
  for (const match of text.matchAll(namedEnglishTimeframe)) {
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
    if (/分钟/.test(value)) mentions.push('seconds:60');
    else if (/小时/.test(value)) mentions.push('seconds:3600');
    else if (/(?:每日|每天|日(?:线|图|级别|周期))/.test(value)) mentions.push('seconds:86400');
    else if (/周/.test(value)) mentions.push('seconds:604800');
    else if (/月/.test(value)) mentions.push('months:1');
    else mentions.push('years:1');
  }
  return mentions;
}

export function assertScreenshotOnlyText(text: string): void {
  for (const { label, pattern } of prohibitedSourceClaims) {
    if (pattern.test(text)) {
      throw new Error(`Report text must not claim ${label} evidence`);
    }
  }
}

export function assertSingleTimeframe(texts: readonly string[]): void {
  const mentions = new Set<string>();
  for (const text of texts) {
    if (explicitMultipleTimeframeClaim.test(text) || explicitChineseMultipleTimeframeClaim.test(text)) {
      throw new Error('Report must describe exactly one visible timeframe');
    }
    collectCanonicalTimeframes(text).forEach((timeframe) => mentions.add(timeframe));
  }
  if (mentions.size > 1) {
    throw new Error('Report must describe exactly one visible timeframe');
  }
}
