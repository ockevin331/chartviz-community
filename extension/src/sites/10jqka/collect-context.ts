import { chartContextSchema, type ChartContext } from '../../domain/chart-context';
import { elementText } from '../binance/collect-context';

const STOCK_PAGE_PATH = /^\/([A-Z0-9._-]+)(?:\/index)?\/?$/i;

export function parse10jqkaStockUrl(value: string) {
  const url = new URL(value);
  if (url.hostname.toLowerCase() !== 'stockpage.10jqka.com.cn') return null;
  const match = decodeURIComponent(url.pathname).match(STOCK_PAGE_PATH);
  if (!match?.[1]) return null;
  const symbol = match[1].toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(symbol)) return null;
  return { symbol };
}

function visibleArea(element: Element): number {
  const rect = element.getBoundingClientRect();
  const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
  const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
  return width * height;
}

function chartScore(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  if (rect.width < 460 || rect.height < 260 || visibleArea(element) === 0) return -1;
  const identity = `${element.id} ${element.className} ${element.getAttribute('data-type') ?? ''} ${element.getAttribute('aria-label') ?? ''}`.toLowerCase();
  let score = visibleArea(element);
  if (/kline|k-line|candlestick|stockchart|stock-chart|hqchart/.test(identity)) score *= 8;
  else if (/chart|canvas/.test(identity)) score *= 3;
  if (/minute|timeline|trend|small|mini|fund|flow|pie/.test(identity)) score *= 0.12;
  if (element.querySelectorAll('canvas').length > 0) score *= 1.5;
  return score;
}

export function find10jqkaChart(): HTMLElement | null {
  const selectors = [
    '[id*="kline" i]', '[class*="kline" i]', '[id*="hqchart" i]', '[class*="hqchart" i]',
    '[id*="stockchart" i]', '[class*="stock-chart" i]', '[class*="chart-box" i]',
    '[class*="chart_wrap" i]', '[class*="chart-wrap" i]', '[id*="chart" i]', '[class*="chart" i]',
  ];
  const semantic = selectors.flatMap(selector => [...document.querySelectorAll<HTMLElement>(selector)]);
  const candidates = [...new Set(semantic)].sort((a, b) => chartScore(b) - chartScore(a));
  if (candidates[0] && chartScore(candidates[0]) > 0) return candidates[0];

  const canvas = [...document.querySelectorAll<HTMLCanvasElement>('canvas')]
    .filter(item => item.getBoundingClientRect().width >= 460 && item.getBoundingClientRect().height >= 260)
    .sort((a, b) => visibleArea(b) - visibleArea(a))[0];
  if (!canvas) return null;
  let chart: HTMLElement = canvas;
  for (let parent = canvas.parentElement, depth = 0; parent && depth < 5; parent = parent.parentElement, depth += 1) {
    const rect = parent.getBoundingClientRect();
    if (rect.width > innerWidth * 0.98 || rect.height > innerHeight * 0.92) break;
    if (rect.width >= 460 && rect.height >= 260) chart = parent;
  }
  return chart;
}

export function normalize10jqkaTimeframe(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, '').trim().toLowerCase();
  const values: Record<string, string> = {
    '日k': '1d', '日线': '1d', 'daily': '1d',
    '周k': '1w', '周线': '1w', 'weekly': '1w',
    '月k': '1M', '月线': '1M', 'monthly': '1M',
    '季k': '3M', '季线': '3M',
    '年k': '1y', '年线': '1y',
    '5分钟': '5m', '15分钟': '15m', '30分钟': '30m', '60分钟': '1h',
  };
  return values[text];
}

function selected10jqkaTimeframe(chart: HTMLElement): string | undefined {
  const chartRect = chart.getBoundingClientRect();
  const candidates = [...document.querySelectorAll<HTMLElement>('button,a,li,span,[role="tab"]')]
    .filter(element => {
      if (!normalize10jqkaTimeframe(elementText(element)) || visibleArea(element) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width <= 140 && rect.height <= 56
        && rect.bottom >= chartRect.top - 160 && rect.top <= chartRect.top + 200
        && rect.right >= chartRect.left && rect.left <= chartRect.right;
    })
    .map(element => {
      const identity = `${element.className} ${element.getAttribute('aria-selected') ?? ''}`.toLowerCase();
      let score = 0;
      if (element.getAttribute('aria-selected') === 'true' || element.getAttribute('aria-pressed') === 'true') score += 10;
      if (/active|current|selected|cur\b|on\b/.test(identity)) score += 8;
      const color = getComputedStyle(element).color;
      if (color === 'rgb(238, 45, 45)' || color === 'rgb(255, 51, 51)') score += 3;
      return { value: normalize10jqkaTimeframe(elementText(element))!, score };
    })
    .sort((a, b) => b.score - a.score);
  if (candidates[0]?.score) return candidates[0].value;
  const unique = [...new Set(candidates.map(item => item.value))];
  return unique.length === 1 ? unique[0] : undefined;
}

function marketName(symbol: string): string {
  if (/^(?:6|68)\d{4}$/.test(symbol)) return 'SSE';
  if (/^(?:0|3)\d{5}$/.test(symbol)) return 'SZSE';
  if (/^(?:4|8|9)\d{5}$/.test(symbol)) return 'BSE';
  return '10JQKA';
}

export function collect10jqkaContext(): ChartContext {
  const market = parse10jqkaStockUrl(location.href);
  if (!market) throw new Error('Open a supported 10jqka stock quote page first.');
  const chart = find10jqkaChart();
  if (!chart) throw new Error('No visible 10jqka candlestick chart was found. Select a K-line tab and try again.');
  const rect = chart.getBoundingClientRect();
  return chartContextSchema.parse({
    site: '10jqka', pageType: 'stock-trade', url: location.href,
    symbol: market.symbol, exchange: marketName(market.symbol), timeframe: selected10jqkaTimeframe(chart),
    currentOhlcText: elementText(chart).slice(0, 500) || undefined,
    chart: {
      id: chart.id || '10jqka chart', ariaLabel: chart.getAttribute('aria-label') || undefined,
      bounds: {
        x: Math.max(0, rect.x), y: Math.max(0, rect.y),
        width: Math.min(rect.right, innerWidth) - Math.max(0, rect.x),
        height: Math.min(rect.bottom, innerHeight) - Math.max(0, rect.y),
      },
    },
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
  });
}

export async function collect10jqkaContextWithRetry(timeoutMs = 10000): Promise<ChartContext> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  do {
    try { return collect10jqkaContext(); }
    catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 300)); }
  } while (Date.now() < deadline);
  throw lastError;
}
