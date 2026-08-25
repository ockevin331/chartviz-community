const prohibitedSourceClaims: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  {
    label: 'exchange API or feed',
    pattern: /\b(?:exchange|binance|okx|hyperliquid)\s*(?:api|data|feed)\b/i,
  },
  {
    label: 'calculated feed',
    pattern: /\bcalculated\s+(?:data|feed|indicator(?:s)?)\b/i,
  },
  {
    label: 'web search',
    pattern: /\b(?:web|internet|online)\s+search\b/i,
  },
  {
    label: 'news reports',
    pattern: /\bnews\s+(?:report(?:s)?|search|source(?:s)?|feed)\b/i,
  },
  {
    label: 'external data',
    pattern: /\bexternal\s+(?:data|feed|source(?:s)?)\b/i,
  },
  {
    label: 'exchange API or feed',
    pattern: /(?:交易所|币安|欧易|海波龙)\s*(?:接口|API|数据源|行情源)/iu,
  },
  {
    label: 'calculated feed',
    pattern: /(?:计算|推算)(?:数据源|行情源|指标数据|数据|行情)/u,
  },
  {
    label: 'web search',
    pattern: /(?:网页|网络|互联网|在线)(?:搜索|检索)/u,
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

const numericEnglishTimeframe = /\d+(?:\.\d+)?\s*-?\s*(?:s(?:ec(?:ond)?s?)?|m(?:in(?:ute)?s?)?|h(?:ou)?r?s?|d(?:ay)?s?|w(?:eek)?s?|mo(?:nth)?s?|y(?:ear)?s?)\b/giu;
const numericChineseTimeframe = /\d+(?:\.\d+)?\s*(?:秒|分钟|分|小时|时|日|天|周|月|年)/gu;
const namedTimeframe = /\b(?:intraday|daily|weekly|monthly|quarterly|yearly)\b/giu;
const namedChineseTimeframe = /(?<!\d)(?:分钟线|小时线|日线|周线|月线|年线)/gu;

export function assertScreenshotOnlyText(text: string): void {
  for (const { label, pattern } of prohibitedSourceClaims) {
    if (pattern.test(text)) {
      throw new Error(`Report text must not claim ${label} evidence`);
    }
  }
}

export function assertSingleTimeframe(timeframe: string): void {
  const trimmed = timeframe.trim();
  if (/^\[[\s\S]*\]$/.test(trimmed)) {
    throw new Error('Report must describe exactly one visible timeframe');
  }
  if (/\b(?:second|another|multiple|combined)\s+(?:visible\s+)?timeframes?\b/i.test(trimmed)
    || /(?:第二(?:个)?|另一个|多个|多重|组合)(?:可见)?(?:时间框架|周期)/u.test(trimmed)) {
    throw new Error('Report must describe exactly one visible timeframe');
  }

  const numericMatches = [
    ...(trimmed.match(numericEnglishTimeframe) ?? []),
    ...(trimmed.match(numericChineseTimeframe) ?? []),
  ];
  const namedMatches = trimmed.match(namedTimeframe) ?? [];
  const namedChineseMatches = trimmed.match(namedChineseTimeframe) ?? [];
  if (numericMatches.length + namedMatches.length + namedChineseMatches.length > 1) {
    throw new Error('Report must describe exactly one visible timeframe');
  }
}
