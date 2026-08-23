import { normalizeBinanceTimeframe } from '../binance/collect-context';

const UPBIT_TRADINGVIEW_RESOLUTIONS: Record<string, string> = {
  '1': '1m', '3': '3m', '5': '5m', '10': '10m', '15': '15m', '30': '30m',
  '60': '1h', '240': '4h', D: '1d', '1D': '1d', W: '1w', '1W': '1w', M: '1M', '1M': '1M',
};

export function normalizeUpbitTimeframe(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().replace(/\s+/g, ' ');
  const candle = text.match(/^(1|3|5|10|15|30|60|240)\s*(분|분봉)$/);
  if (candle) {
    const minutes = Number(candle[1]);
    if (minutes === 60) return '1h';
    if (minutes === 240) return '4h';
    return `${minutes}m`;
  }
  if (/^(?:1\s*)?(?:날|일|일봉|일간)$/.test(text)) return '1d';
  if (/^(?:1\s*)?(?:주|주봉|주간)$/.test(text)) return '1w';
  if (/^(?:1\s*)?(?:월|월봉|월간)$/.test(text)) return '1M';
  const direct = normalizeBinanceTimeframe(text);
  if (direct) return direct;

  // Upbit accessibility labels can wrap the selected value in explanatory
  // Korean text (for example "현재 선택된 봉: 15분"). Only accept an embedded
  // value when the label contains one unique timeframe, so a complete toolbar
  // such as "1분 3분 5분 …" cannot be mistaken for its first item.
  const embedded = [
    ...text.matchAll(/(?:^|[\s:·|()\[\]])(1|3|5|10|15|30|60|240)\s*(분봉|분)(?=$|[\s:·|()\[\]])/g),
  ].map((match) => {
    const minutes = Number(match[1]);
    return minutes === 60 ? '1h' : minutes === 240 ? '4h' : `${minutes}m`;
  });
  if (/(?:^|[\s:·|()\[\]])(?:1\s*)?(날|일봉|일간|일)(?=$|[\s:·|()\[\]])/.test(text)) embedded.push('1d');
  if (/(?:^|[\s:·|()\[\]])(?:1\s*)?(주봉|주간|주)(?=$|[\s:·|()\[\]])/.test(text)) embedded.push('1w');
  if (/(?:^|[\s:·|()\[\]])(?:1\s*)?(월봉|월간|월)(?=$|[\s:·|()\[\]])/.test(text)) embedded.push('1M');
  const unique = [...new Set(embedded)];
  return unique.length === 1 ? unique[0] : undefined;
}

export function normalizeUpbitLegendTimeframe(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split(/[·|\n]/).map((part) => part.trim()).filter(Boolean);
  const candidates = parts
    .map((part) => UPBIT_TRADINGVIEW_RESOLUTIONS[part])
    .filter((part): part is string => Boolean(part));
  if (candidates.length === 0 && /UPBIT/i.test(value)) {
    for (const match of value.matchAll(/(?:^|\s)(1|3|5|10|15|30|60|240|1?D|1?W|1?M)(?=\s|$)/gi)) {
      const token = match[1]!;
      const normalizedToken = /^\d+$/.test(token) ? token : token.toUpperCase();
      const timeframe = UPBIT_TRADINGVIEW_RESOLUTIONS[normalizedToken];
      if (timeframe) candidates.push(timeframe);
    }
  }
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : undefined;
}

export function normalizeUpbitSavedLayoutTimeframe(value: unknown): string | undefined {
  let layout: unknown = value;
  if (typeof layout === 'string') {
    try { layout = JSON.parse(layout); } catch { return undefined; }
  }
  if (!layout || typeof layout !== 'object') return undefined;

  const candidates: string[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 10 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(item => visit(item, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (/^(interval|resolution|timeframe)$/i.test(key)
        && (typeof child === 'string' || typeof child === 'number')) {
        const token = String(child).trim();
        const normalizedToken = /^\d+$/.test(token) ? token : token.toUpperCase();
        const timeframe = UPBIT_TRADINGVIEW_RESOLUTIONS[normalizedToken]
          ?? normalizeUpbitTimeframe(token);
        if (timeframe) candidates.push(timeframe);
      } else {
        visit(child, depth + 1);
      }
    }
  };
  visit(layout, 0);
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : undefined;
}
