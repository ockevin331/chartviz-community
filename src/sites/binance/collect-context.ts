import { chartContextSchema, type ChartContext } from '../../domain/analysis';

const SPOT_PATH = /^\/[^/]+\/trade\/([A-Z0-9]+)_([A-Z0-9]+)\/?$/i;
const FUTURES_PATH = /^\/[^/]+\/futures\/([A-Z0-9._-]+)\/?$/i;
const STOCK_PATH = /^\/[^/]+\/stocks\/EQ_([A-Z0-9.-]+)\/?$/i;
const WEB3_TOKEN_PATH = /^\/[^/]+\/token\/([^/]+)\/([^/]+)\/?$/i;
const TIMEFRAME_PATTERN = /^(?:1s|1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$/;

export function parseBinanceSpotUrl(value: string) {
  const url = new URL(value);
  const tradeType = url.searchParams.get('type');
  if (!/(^|\.)binance\.com$/i.test(url.hostname) || (tradeType && tradeType.toLowerCase() !== 'spot')) return null;
  const match = url.pathname.match(SPOT_PATH);
  if (!match) return null;
  const baseAsset = match[1]!.toUpperCase();
  const quoteAsset = match[2]!.toUpperCase();
  return { baseAsset, quoteAsset, symbol: `${baseAsset}${quoteAsset}` };
}

export function parseBinanceFuturesUrl(value: string) {
  const url = new URL(value);
  if (!/(^|\.)binance\.com$/i.test(url.hostname)) return null;
  const match = url.pathname.match(FUTURES_PATH);
  if (!match?.[1]) return null;
  return { symbol: match[1].replace(/[^A-Z0-9]/gi, '').toUpperCase() };
}

export function parseBinanceStockUrl(value: string) {
  const url = new URL(value);
  if (!/(^|\.)binance\.com$/i.test(url.hostname)) return null;
  const match = url.pathname.match(STOCK_PATH);
  if (!match?.[1]) return null;
  const ticker = match[1].toUpperCase();
  return { ticker, symbol: ticker };
}

export function parseBinanceWeb3TokenUrl(value: string) {
  const url = new URL(value);
  if (url.hostname.toLowerCase() !== 'web3.binance.com') return null;
  const match = url.pathname.match(WEB3_TOKEN_PATH);
  if (!match?.[1] || !match[2]) return null;
  return {
    chain: decodeURIComponent(match[1]).toLowerCase(),
    address: decodeURIComponent(match[2]).toLowerCase(),
  };
}

function web3TokenSymbol(): string | undefined {
  const candidates = [
    ...document.querySelectorAll<HTMLElement>('[data-testid*="token" i],[class*="token-symbol" i],h1,h2'),
  ];
  for (const element of candidates) {
    const text = elementText(element).replace(/\s+/g, ' ').trim();
    const ticker = text.match(/(?:^|\()\$?([A-Z][A-Z0-9.-]{1,14})(?:\)|$|\s)/)?.[1];
    if (ticker && !['TOKEN', 'PRICE', 'TRADE', 'MARKET'].includes(ticker)) return ticker;
  }
  const titleTicker = document.title.match(/(?:^|\()\$?([A-Z][A-Z0-9.-]{1,14})(?:\)|\s|$)/)?.[1];
  return titleTicker && titleTicker !== 'BINANCE' ? titleTicker : undefined;
}

function visibleArea(element: Element): number {
  const rect = element.getBoundingClientRect();
  const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
  const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
  return width * height;
}

function chartScore(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  if (rect.width < 480 || rect.height < 300 || visibleArea(element) === 0) return -1;
  const identity = `${element.id} ${element.className} ${element.getAttribute('data-testid') ?? ''} ${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''}`.toLowerCase();
  let score = visibleArea(element);
  if (/tradingview|kline|candlestick|chart/.test(identity)) score *= 4;
  if (/depth|orderbook|order-book/.test(identity)) score *= 0.15;
  if (element.tagName === 'IFRAME') score *= 2;
  return score;
}

export function findActiveBinanceChart(): HTMLElement | null {
  const semantic = [
    'iframe[src*="tradingview" i]', 'iframe[title*="tradingview" i]',
    'iframe[title="Financial Chart" i]',
    '[data-testid*="tradingview" i]', '[id*="tradingview" i]', '[class*="tradingview" i]',
    '[data-testid*="chart" i]', '[data-testid*="kline" i]',
    '[id*="chart" i]', '[class*="chart" i]', '[class*="kline" i]',
  ].flatMap(selector => [...document.querySelectorAll<HTMLElement>(selector)]);
  const candidates = [...new Set(semantic)].sort((a, b) => chartScore(b) - chartScore(a));
  if (candidates[0] && chartScore(candidates[0]) > 0) return candidates[0];

  const canvas = [...document.querySelectorAll<HTMLCanvasElement>('canvas')]
    .filter(item => item.getBoundingClientRect().width >= 480 && item.getBoundingClientRect().height >= 300)
    .sort((a, b) => visibleArea(b) - visibleArea(a))[0];
  if (!canvas) return null;
  let chart: HTMLElement = canvas;
  for (let parent = canvas.parentElement, depth = 0; parent && depth < 6; parent = parent.parentElement, depth += 1) {
    const rect = parent.getBoundingClientRect();
    if (rect.width > innerWidth * 0.95 || rect.height > innerHeight * 0.9) break;
    if (rect.width >= 480 && rect.height >= 300) chart = parent;
  }
  return chart;
}

export function elementText(element: Element): string {
  return ('innerText' in element && typeof element.innerText === 'string'
    ? element.innerText : element.textContent ?? '').trim();
}

export function normalizeBinanceTimeframe(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().replace(/\s+/g, ' ');
  if (TIMEFRAME_PATTERN.test(text)) return text;
  const shorthand = text.match(/^(1|2|3|4|5|6|8|12|15|30)([SMHDW])$/);
  if (shorthand) {
    const suffix = shorthand[2] === 'S' ? 's'
      : shorthand[2] === 'M' ? 'M'
        : shorthand[2] === 'H' ? 'h'
          : shorthand[2] === 'D' ? 'd' : 'w';
    const normalized = `${shorthand[1]}${suffix}`;
    return TIMEFRAME_PATTERN.test(normalized) ? normalized : undefined;
  }
  const localized = text.match(/^(1|2|3|4|5|6|8|12|15|30)\s*(秒|秒钟|分钟|分|小时|时|天|日|周|星期|个月|月)$/);
  if (localized) {
    const unit = localized[2];
    const suffix = unit === '秒' || unit === '秒钟' ? 's'
      : unit === '分钟' || unit === '分' ? 'm'
        : unit === '小时' || unit === '时' ? 'h'
          : unit === '天' || unit === '日' ? 'd'
            : unit === '周' || unit === '星期' ? 'w' : 'M';
    const normalized = `${localized[1]}${suffix}`;
    return TIMEFRAME_PATTERN.test(normalized) ? normalized : undefined;
  }
  const english = text.toLowerCase().match(/^(1|2|3|4|5|6|8|12|15|30)\s*(sec(?:ond)?s?|mins?|minutes?|hrs?|hours?|days?|weeks?|months?)$/);
  if (!english) return undefined;
  const unit = english[2]!;
  const suffix = unit.startsWith('sec') ? 's' : unit.startsWith('min') ? 'm'
    : unit.startsWith('h') ? 'h' : unit.startsWith('d') ? 'd'
      : unit.startsWith('w') ? 'w' : 'M';
  const normalized = `${english[1]}${suffix}`;
  return TIMEFRAME_PATTERN.test(normalized) ? normalized : undefined;
}

type TimeframeCandidate = {
  value: string;
  score: number;
  color: string;
  background: string;
  weight: string;
  area: number;
};

function elementStyle(element: Element): CSSStyleDeclaration {
  return element.ownerDocument.defaultView?.getComputedStyle(element) ?? getComputedStyle(element);
}

function timeframeValue(element: HTMLElement): string | undefined {
  const values = [
    elementText(element), element.getAttribute('aria-label'), element.getAttribute('title'),
    element.getAttribute('value'), element.getAttribute('data-value'),
    element.getAttribute('data-interval'), element.getAttribute('data-timeframe'),
    element.getAttribute('data-resolution'),
  ];
  for (const value of values) {
    const normalized = normalizeBinanceTimeframe(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function timeframeDocuments(chart: HTMLElement): Document[] {
  const documents = [document];
  const chartRect = chart.getBoundingClientRect();
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe')) {
    try {
      const frameRect = frame.getBoundingClientRect();
      const overlapWidth = Math.max(0, Math.min(frameRect.right, chartRect.right) - Math.max(frameRect.left, chartRect.left));
      const overlapHeight = Math.max(0, Math.min(frameRect.bottom, chartRect.bottom) - Math.max(frameRect.top, chartRect.top));
      const overlapsChart = overlapWidth * overlapHeight >= Math.min(
        Math.max(1, frameRect.width * frameRect.height),
        Math.max(1, chartRect.width * chartRect.height),
      ) * 0.2;
      if ((frame === chart || chart.contains(frame) || overlapsChart) && frame.contentDocument) {
        documents.push(frame.contentDocument);
      }
    } catch { /* cross-origin chart frame */ }
  }
  return documents;
}

function selectedTimeframeInDocument(
  rootDocument: Document,
  chartRect: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>,
): string | undefined {
  const view = rootDocument.defaultView;
  const viewportWidth = view?.innerWidth ?? innerWidth;
  const viewportHeight = view?.innerHeight ?? innerHeight;
  const candidates: TimeframeCandidate[] = [];
  for (const element of rootDocument.querySelectorAll<HTMLElement>(
    'button,[role="button"],[role="tab"],[aria-selected],[aria-pressed],[data-active],[data-state],[data-testid],span,div',
  )) {
    if (element.children.length > 2) continue;
    const value = timeframeValue(element);
    if (!value) continue;
    const rect = element.getBoundingClientRect();
    const style = elementStyle(element);
    const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    if (visibleWidth * visibleHeight === 0 || style.visibility === 'hidden' || style.display === 'none'
      || rect.height > 52 || rect.width > 120
      || rect.bottom < chartRect.top - 140 || rect.top > chartRect.top + 180
      || rect.right < chartRect.left || rect.left > chartRect.right) continue;
    const identity = `${element.className} ${element.getAttribute('data-state') ?? ''} ${element.getAttribute('data-testid') ?? ''}`.toLowerCase();
    let score = 0;
    if (element.getAttribute('aria-pressed') === 'true' || element.getAttribute('aria-selected') === 'true') score += 12;
    if (element.getAttribute('data-active') === 'true' || /active|selected|current|checked/.test(identity)) score += 10;
    if (element.tagName === 'BUTTON' && normalizeBinanceTimeframe(element.getAttribute('aria-label')) === value) score += 8;
    if (element.matches('button,[role="button"],[role="tab"]')) score += 2;
    if (/primarytext|primary-text/.test(identity) && !/tertiary|secondary/.test(identity)) score += 4;
    if (style.fontWeight === '600' || style.fontWeight === '700') score += 2;
    candidates.push({
      value, score, color: style.color, background: style.backgroundColor,
      weight: style.fontWeight, area: rect.width * rect.height,
    });
  }
  const representativeMap = new Map<string, TimeframeCandidate>();
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score || a.area - b.area)) {
    if (!representativeMap.has(candidate.value)) representativeMap.set(candidate.value, candidate);
  }
  const representatives = [...representativeMap.values()];
  if (!representatives.length) return undefined;
  const countStyle = (key: 'color' | 'background' | 'weight', value: string) =>
    representatives.filter(candidate => candidate[key] === value).length;
  const ranked = representatives.map(candidate => {
    let score = candidate.score;
    if (candidate.color && countStyle('color', candidate.color) === 1) score += 4;
    if (candidate.weight && countStyle('weight', candidate.weight) === 1) score += 2;
    if (candidate.background && !/rgba?\(0, 0, 0(?:, 0)?\)|transparent/.test(candidate.background)
      && countStyle('background', candidate.background) === 1) score += 5;
    return { value: candidate.value, score };
  }).sort((a, b) => b.score - a.score);
  if (ranked[0]!.score > (ranked[1]?.score ?? 0)) return ranked[0]!.value;
  return ranked.length === 1 ? ranked[0]!.value : undefined;
}

export function selectedTimeframe(chart: HTMLElement): string | undefined {
  const chartRect = chart.getBoundingClientRect();
  for (const rootDocument of timeframeDocuments(chart)) {
    const rootRect = rootDocument === document
      ? chartRect
      : { top: 0, left: 0, right: rootDocument.defaultView?.innerWidth ?? chartRect.width, bottom: 180 };
    const timeframe = selectedTimeframeInDocument(rootDocument, rootRect);
    if (timeframe) return timeframe;
  }
  return undefined;
}

export function collectBinanceSpotContext(): ChartContext {
  const pair = parseBinanceSpotUrl(location.href);
  const futures = parseBinanceFuturesUrl(location.href);
  const stock = parseBinanceStockUrl(location.href);
  const web3Token = parseBinanceWeb3TokenUrl(location.href);
  if (!pair && !futures && !stock && !web3Token) throw new Error('Open a supported Binance chart page first.');
  const chart = findActiveBinanceChart();
  if (!chart) throw new Error('No visible Binance candlestick chart was found.');
  const rect = chart.getBoundingClientRect();
  return chartContextSchema.parse({
    site: 'binance', pageType: web3Token ? 'web3-token' : stock ? 'stock-trade' : futures ? 'futures-trade' : 'spot-trade', url: location.href,
    symbol: web3Token ? web3TokenSymbol() : stock?.symbol ?? futures?.symbol ?? pair?.symbol,
    exchange: web3Token ? `BINANCE WEB3 · ${web3Token.chain.toUpperCase()}` : stock ? 'BINANCE STOCKS' : futures ? 'BINANCE FUTURES' : 'BINANCE',
    timeframe: selectedTimeframe(chart),
    currentOhlcText: elementText(chart).slice(0, 500) || undefined,
    chart: { id: chart.id || chart.getAttribute('data-testid') || 'Binance chart', ariaLabel: chart.getAttribute('aria-label') || undefined,
      bounds: { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.min(rect.right, innerWidth) - Math.max(0, rect.x), height: Math.min(rect.bottom, innerHeight) - Math.max(0, rect.y) } },
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
  });
}

export async function collectBinanceSpotContextWithRetry(timeoutMs = 10000): Promise<ChartContext> {
  const deadline = Date.now() + timeoutMs; let lastError: unknown;
  do {
    try {
      const context = collectBinanceSpotContext();
      // Binance initializes the chart container before its toolbar. When the
      // extension is auto-opened from a ChartViz link, returning this partial
      // context makes the panel permanently show "Timeframe not detected".
      // Keep polling until the interval control has mounted, just as we already
      // do while waiting for the chart itself.
      if (!context.timeframe) throw new Error('The Binance chart timeframe is still loading.');
      return context;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } while (Date.now() < deadline);
  throw lastError;
}
