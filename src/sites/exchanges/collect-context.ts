import { chartContextSchema, type ChartContext } from '../../domain/analysis';
import { elementText, findActiveBinanceChart, normalizeBinanceTimeframe, selectedTimeframe } from '../binance/collect-context';

type SupportedSite = 'hyperliquid' | 'coinbase' | 'bitget' | 'gate' | 'kucoin' | 'mexc' | 'htx';
type ParsedMarket = { site: SupportedSite; symbol?: string; pageType: 'spot-trade' | 'futures-trade' };

const MEXC_TIMEFRAME_HINT = 'data-chartviz-mexc-timeframe';
const MEXC_TIMEFRAME_HINT_AT = 'data-chartviz-mexc-timeframe-at';
const MEXC_TIMEFRAME_HINT_TTL_MS = 20_000;

export function rememberMexcTimeframe(timeframe: string): void {
  document.documentElement.setAttribute(MEXC_TIMEFRAME_HINT, timeframe);
  document.documentElement.setAttribute(MEXC_TIMEFRAME_HINT_AT, String(Date.now()));
}

function recentMexcTimeframe(): string | undefined {
  const value = document.documentElement.getAttribute(MEXC_TIMEFRAME_HINT);
  const recordedAt = Number(document.documentElement.getAttribute(MEXC_TIMEFRAME_HINT_AT));
  return value && Number.isFinite(recordedAt) && Date.now() - recordedAt <= MEXC_TIMEFRAME_HINT_TTL_MS
    ? normalizeBinanceTimeframe(value) : undefined;
}

function compact(value: string) { return decodeURIComponent(value).replace(/[^a-z0-9]/gi, '').toUpperCase(); }

function hyperliquidUrlSymbol(value: string): string {
  const decoded = decodeURIComponent(value).trim();
  const namespaced = decoded.match(/^([a-z0-9_-]{1,24}):([a-z0-9._-]{1,24})$/i);
  if (namespaced) return `${namespaced[1]!.toLowerCase()}:${namespaced[2]!.toUpperCase()}`;
  return compact(decoded);
}

const HYPERLIQUID_RESOLUTIONS: Record<string, string> = {
  '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m',
  '60': '1h', '120': '2h', '240': '4h', '480': '8h', '720': '12h',
  '1D': '1d', '3D': '3d', '1W': '1w', '1M': '1M',
};

export function normalizeHyperliquidTimeframe(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().replace(/\s+/g, ' ');
  if (HYPERLIQUID_RESOLUTIONS[text]) return HYPERLIQUID_RESOLUTIONS[text];
  const label = text.match(/(?:^|\b)(1|2|3|4|5|8|12|15|30)\s*([mhdw])(?:$|\b)/i);
  if (label) return `${label[1]}${label[2]!.toLowerCase()}`;
  const localized = text.match(/(?:^|\b)(1|2|3|4|5|6|8|12|15|30|60|120|240)\s*(seconds?|minutes?|hours?|days?|weeks?|months?)(?:$|\b)/i)
    ?? text.match(/(1|2|3|4|5|6|8|12|15|30|60|120|240)\s*(秒(?:钟)?|分钟|分|小时|时|天|日|周|星期|个月|月)/);
  if (!localized) return undefined;
  const amount = Number(localized[1]);
  const unit = localized[2]!.toLowerCase();
  if (unit.startsWith('second') || unit.startsWith('秒')) return `${amount}s`;
  if (unit.startsWith('minute') || unit === '分钟' || unit === '分') return amount === 60 ? '1h' : amount === 120 ? '2h' : amount === 240 ? '4h' : `${amount}m`;
  if (unit.startsWith('hour') || unit === '小时' || unit === '时') return `${amount}h`;
  if (unit.startsWith('day') || unit === '天' || unit === '日') return `${amount}d`;
  if (unit.startsWith('week') || unit === '周' || unit === '星期') return `${amount}w`;
  return `${amount}M`;
}

const HYPERLIQUID_INDICATOR_NAMES = new Set([
  'VOLUME', 'VOL', 'RSI', 'MACD', 'EMA', 'SMA', 'MA', 'VWAP', 'ATR',
  'BB', 'BOLL', 'BOLLINGER', 'STOCH', 'STOCHASTIC', 'OBV', 'OPENINTEREST',
]);

export function normalizeHyperliquidSymbol(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  const namespaced = raw.match(/^([a-z0-9_-]{1,24}):([a-z0-9._-]{1,24})$/i);
  if (namespaced && namespaced[1]!.toLowerCase() !== 'hyperliquid') {
    return `${namespaced[1]!.toLowerCase()}:${namespaced[2]!.toUpperCase()}`;
  }
  const text = raw.toUpperCase();
  const match = text.match(/^(?:HYPERLIQUID:)?([A-Z0-9][A-Z0-9._-]{0,23})(?:\s*\/\s*USD)?$/);
  const symbol = match?.[1];
  if (!symbol || ['TRADE', 'CHART', 'PERP', 'USD', 'USDC'].includes(symbol) || HYPERLIQUID_INDICATOR_NAMES.has(symbol)) return undefined;
  return symbol;
}

function hyperliquidFrameDocuments(): Document[] {
  const documents = [document];
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe')) {
    try { if (frame.contentDocument) documents.push(frame.contentDocument); } catch { /* cross-origin frame */ }
  }
  return documents;
}

export function selectedHyperliquidTimeframe(chart: HTMLElement): string | undefined {
  const normalizeElement = (item: HTMLElement) => {
    const candidates = [
      elementText(item), item.getAttribute('data-value'), item.getAttribute('value'),
      item.getAttribute('aria-label'), item.getAttribute('title'),
    ];
    for (const candidate of candidates) {
      const normalized = normalizeHyperliquidTimeframe(candidate) ?? normalizeBinanceTimeframe(candidate);
      if (normalized) return normalized;
    }
    return undefined;
  };
  // Hyperliquid embeds TradingView with several responsive toolbar copies.
  // Read the explicitly checked/selected interval instead of taking the first
  // interval button (which is normally 5m regardless of the active chart).
  const selectedSelectors = [
    '[aria-checked="true"]', '[aria-selected="true"]', '[aria-pressed="true"]',
    '[data-active="true"]', '[data-state="active"]', '[data-state="selected"]',
  ];
  for (const frameDocument of hyperliquidFrameDocuments()) {
    for (const element of frameDocument.querySelectorAll<HTMLElement>(selectedSelectors.join(','))) {
      const normalized = normalizeElement(element);
      if (normalized) return normalized;
    }
  }
  const preferredSelectors = [
    '[data-name="header-intervals"]', '[data-name*="interval" i]',
    '[aria-label*="interval" i]', '[title*="interval" i]',
  ];
  for (const frameDocument of hyperliquidFrameDocuments()) {
    for (const selector of preferredSelectors) {
      for (const element of frameDocument.querySelectorAll<HTMLElement>(selector)) {
        const candidates = [element, ...element.querySelectorAll<HTMLElement>('button,[role="button"],[aria-selected],[aria-pressed],[data-value]')]
          .map(normalizeElement).filter((value): value is string => Boolean(value));
        const unique = [...new Set(candidates)];
        if (unique.length === 1) return unique[0];
      }
    }
  }
  return selectedTimeframe(chart);
}

export function selectedGateTimeframe(chart: HTMLElement): string | undefined {
  const topLevelChartRect = chart.getBoundingClientRect();
  const selectors = [
    '[aria-selected="true"]', '[aria-pressed="true"]', '[data-active="true"]',
    '[data-state="active"]', '[data-state="selected"]',
  ];
  const documents = hyperliquidFrameDocuments();
  const chartRectFor = (rootDocument: Document) => rootDocument === document
    ? topLevelChartRect
    : {
      top: 0, bottom: 180, left: 0,
      right: rootDocument.defaultView?.innerWidth ?? topLevelChartRect.width,
    };
  const candidates = documents.flatMap((rootDocument) => {
    const chartRect = chartRectFor(rootDocument);
    return [...rootDocument.querySelectorAll<HTMLElement>(selectors.join(','))]
      .map((element) => {
        const value = normalizeBinanceTimeframe(elementText(element));
        const rect = element.getBoundingClientRect();
        return { value, rect };
      })
      .filter(({ value, rect }) => value && rect.width > 0 && rect.height > 0
        && rect.width <= 140 && rect.height <= 60
        && rect.bottom >= chartRect.top - 160 && rect.top <= chartRect.top + 200
        && rect.right >= chartRect.left && rect.left <= chartRect.right);
  });
  const unique = [...new Set(candidates.map(({ value }) => value!))];
  if (unique.length === 1) return unique[0];

  // Gate does not currently expose an ARIA/data selected state on every chart
  // variant. In that case the active interval is the visually distinct member
  // of the compact interval row. Compare it with its peers instead of taking
  // the first option (which is normally 1m).
  const toolbar = documents.flatMap((rootDocument) => {
    const chartRect = chartRectFor(rootDocument);
    return [...rootDocument.querySelectorAll<HTMLElement>('button,[role="tab"],span,div')]
      .map((element) => {
        const value = normalizeBinanceTimeframe(elementText(element));
        const rect = element.getBoundingClientRect();
        if (!value || rect.width <= 0 || rect.height <= 0 || rect.width > 140 || rect.height > 60
          || rect.bottom < chartRect.top - 160 || rect.top > chartRect.top + 200
          || rect.right < chartRect.left || rect.left > chartRect.right) return null;
        const style = element.ownerDocument.defaultView?.getComputedStyle(element);
        if (!style) return null;
        return { value, color: style.color, background: style.backgroundColor, weight: style.fontWeight };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  });
  const deduplicated = [...new Map(toolbar.map((item) => [
    `${item.value}|${item.color}|${item.background}|${item.weight}`, item,
  ])).values()];
  const count = (key: 'color' | 'background' | 'weight', value: string) =>
    deduplicated.filter((item) => item[key] === value).length;
  const ranked = deduplicated.map((item) => {
    let score = 0;
    if (count('color', item.color) === 1) score += 4;
    if (count('weight', item.weight) === 1) score += 2;
    if (!/rgba?\(0, 0, 0(?:, 0)?\)|transparent/.test(item.background)
      && count('background', item.background) === 1) score += 5;
    return { value: item.value, score };
  }).sort((a, b) => b.score - a.score);
  return ranked[0]?.score && ranked[0].score > (ranked[1]?.score ?? 0)
    ? ranked[0].value : undefined;
}

export function activeHyperliquidSymbol(): string | undefined {
  const marketSelectors = [
    '[data-testid="coin-selector"]', '[data-testid="active-coin"]',
    '[aria-label*="coin" i][aria-selected="true"]', '[aria-label*="asset" i][aria-selected="true"]',
  ];
  for (const frameDocument of hyperliquidFrameDocuments()) {
    for (const selector of marketSelectors) {
      for (const element of frameDocument.querySelectorAll<HTMLElement>(selector)) {
        const candidates = [elementText(element), element.getAttribute('data-symbol'), element.getAttribute('data-value')];
        for (const candidate of candidates) {
          const symbol = normalizeHyperliquidSymbol(candidate);
          if (symbol) return symbol;
        }
      }
    }
  }
  // TradingView creates one legend title for the price series and one for each
  // indicator pane. Indicator titles such as VOLUME must never become the market.
  for (const frameDocument of hyperliquidFrameDocuments()) {
    for (const element of frameDocument.querySelectorAll<HTMLElement>('[data-name="legend-source-title"], [data-name="legend-series-item"] [class*="title" i]')) {
      const symbol = normalizeHyperliquidSymbol(elementText(element));
      if (symbol) return symbol;
    }
  }
  const title = document.title.match(/(?:^|\s)([A-Z0-9][A-Z0-9._-]{1,19})(?:\s*[-|·]|\s*\/\s*USD)/)?.[1];
  return normalizeHyperliquidSymbol(title);
}

export function parseAdditionalExchangeUrl(value: string): ParsedMarket | null {
  const url = new URL(value); const host = url.hostname.toLowerCase(); const path = decodeURIComponent(url.pathname);
  let match: RegExpMatchArray | null;
  if (host === 'app.hyperliquid.xyz' && (match = path.match(/^\/trade(?:\/([^/?#]+))?\/?$/i)))
    return { site: 'hyperliquid', symbol: match[1] ? hyperliquidUrlSymbol(match[1]) : undefined, pageType: 'futures-trade' };
  if (/(^|\.)coinbase\.com$/.test(host) && (match = path.match(/\/advanced-trade\/(spot|perpetuals?|futures)\/([^/?#]+)/i)))
    return { site: 'coinbase', symbol: decodeURIComponent(match[2]!).toUpperCase(), pageType: match[1]!.toLowerCase() === 'spot' ? 'spot-trade' : 'futures-trade' };
  if (/(^|\.)bitget\.com$/.test(host)) {
    if ((match = path.match(/\/(?:markets\/)?spot\/([^/?#]+)/i))) return { site: 'bitget', symbol: compact(match[1]!), pageType: 'spot-trade' };
    if ((match = path.match(/\/futures\/(?:[^/]+\/)?([^/?#]+)/i))) return { site: 'bitget', symbol: compact(match[1]!), pageType: 'futures-trade' };
  }
  if (/(^|\.)gate(?:\.com|\.io)$/.test(host)) {
    if ((match = path.match(/\/trade\/([^/?#]+)/i))) return { site: 'gate', symbol: compact(match[1]!), pageType: 'spot-trade' };
    if ((match = path.match(/\/futures\/[^/]+\/([^/?#]+)/i))) return { site: 'gate', symbol: compact(match[1]!), pageType: 'futures-trade' };
  }
  if (/(^|\.)kucoin\.com$/.test(host)) {
    if ((match = path.match(/\/futures\/trade\/([^/?#]+)/i))) return { site: 'kucoin', symbol: compact(match[1]!), pageType: 'futures-trade' };
    if ((match = path.match(/\/trade\/([^/?#]+)/i))) return { site: 'kucoin', symbol: decodeURIComponent(match[1]!).toUpperCase(), pageType: 'spot-trade' };
  }
  if (/(^|\.)mexc\.com$/.test(host)) {
    if ((match = path.match(/\/exchange\/([^/?#]+)/i))) return { site: 'mexc', symbol: compact(match[1]!), pageType: 'spot-trade' };
    if ((match = path.match(/\/futures\/([^/?#]+)/i))) return { site: 'mexc', symbol: compact(match[1]!), pageType: 'futures-trade' };
  }
  if (/(^|\.)htx\.com$/.test(host)) {
    if ((match = path.match(/\/trade\/([^/?#]+)/i))) return { site: 'htx', symbol: compact(match[1]!), pageType: 'spot-trade' };
    if (/\/futures\//i.test(path)) {
      const hashParams = new URLSearchParams(url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?') + 1) : url.hash.slice(1));
      const raw = url.searchParams.get('contract_code') || hashParams.get('contract_code') || hashParams.get('symbol') || path.split('/').filter(Boolean).at(-1);
      if (raw && !/^(linear_swap|coin_swap|futures)$/i.test(raw)) return { site: 'htx', symbol: compact(raw), pageType: 'futures-trade' };
    }
  }
  return null;
}

export function collectAdditionalExchangeContext(): ChartContext {
  const market = parseAdditionalExchangeUrl(location.href);
  if (!market) throw new Error('Open a supported exchange trading page first.');
  const chart = findActiveBinanceChart();
  if (!chart) throw new Error(`No visible ${market.site} candlestick chart was found.`);
  const rect = chart.getBoundingClientRect();
  const symbol = market.symbol ?? (market.site === 'hyperliquid' ? activeHyperliquidSymbol() : undefined);
  if (!symbol) throw new Error('The active Hyperliquid trading instrument could not be detected. Select a market and try again.');
  return chartContextSchema.parse({
    site: market.site, pageType: market.pageType, url: location.href,
    symbol, exchange: market.site.toUpperCase(),
    timeframe: market.site === 'hyperliquid'
      ? selectedHyperliquidTimeframe(chart)
      : market.site === 'mexc' ? recentMexcTimeframe() ?? selectedGateTimeframe(chart)
        : market.site === 'gate' || market.site === 'htx'
        ? selectedGateTimeframe(chart) : selectedTimeframe(chart),
    currentOhlcText: elementText(chart).slice(0, 500) || undefined,
    chart: { id: chart.id || chart.getAttribute('data-testid') || `${market.site} chart`, ariaLabel: chart.getAttribute('aria-label') || undefined,
      bounds: { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.min(rect.right, innerWidth) - Math.max(0, rect.x), height: Math.min(rect.bottom, innerHeight) - Math.max(0, rect.y) } },
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
  });
}

export async function collectAdditionalExchangeContextWithRetry(timeoutMs = 45000): Promise<ChartContext> {
  const deadline = Date.now() + timeoutMs; let lastError: unknown;
  do {
    try {
      const context = collectAdditionalExchangeContext();
      // These exchanges mount the chart frame before its interval toolbar is
      // hydrated. Never return a partial context to an auto-opened panel.
      if (!context.timeframe) {
        const siteName = context.site === 'hyperliquid' ? 'Hyperliquid'
          : context.site === 'coinbase' ? 'Coinbase'
            : context.site === 'bitget' ? 'Bitget' : context.exchange;
        throw new Error(`The ${siteName} chart timeframe is still loading.`);
      }
      return context;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } while (Date.now() < deadline);
  throw lastError;
}
