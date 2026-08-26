import {
  chartContextSchema,
  type ChartContext,
} from '../../domain/chart-context';
import { normalizeBinanceTimeframe } from '../binance/collect-context';

const CHART_SELECTOR = [
  '[aria-label^="Chart #"]',
  '[aria-label^="图表 #"]',
  '[data-name="chart-widget"]',
].join(',');
const CHART_CANVAS_SELECTOR = 'canvas[aria-label*="Chart"], canvas[aria-label*="图表"]';

function textOf(selector: string): string | undefined {
  const value = [...document.querySelectorAll<HTMLElement>(selector)]
    .filter((element) => visibleArea(element) > 0)
    .sort((a, b) => visibleArea(b) - visibleArea(a))[0]
    ?.innerText.trim();
  return value || undefined;
}

function activeIntervalLabel(): string | undefined {
  const candidates = [...document.querySelectorAll<HTMLElement>('button[aria-label]')]
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const label = element.getAttribute('aria-label')?.trim() ?? '';
      return visibleArea(element) > 0 && rect.top < 80 && rect.width < 120
        && /^\d+\s+(?:minute|minutes|hour|hours|day|days|week|weeks|month|months)$/i.test(label);
    })
    .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  return candidates[0]?.getAttribute('aria-label')?.trim() || undefined;
}

export function normalizeTradingViewTimeframe(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  const internalValues: Record<string, string> = {
    '5': '5m', '15': '15m', '60': '1h', '240': '4h', D: '1d', '1D': '1d',
  };
  return internalValues[text] ?? normalizeBinanceTimeframe(text);
}

function parseQualifiedSymbol(raw: string): { exchange?: string; symbol?: string } {
  const value = raw.trim().replace(/\s+/g, ' ');
  const qualified = value.match(/^([A-Z0-9._-]{2,20}):([A-Z0-9._/-]{1,30})$/i);
  if (qualified) return { exchange: qualified[1]?.toUpperCase(), symbol: qualified[2]?.toUpperCase() };
  const ticker = value.match(/^[A-Z0-9][A-Z0-9._/-]{0,29}$/i)?.[0];
  return ticker ? { symbol: ticker.toUpperCase() } : {};
}

function parseSymbolFromLiveChart(chart: HTMLElement): { exchange?: string; symbol?: string } {
  const selectors = [
    '#header-toolbar-symbol-search',
    '[data-name="header-toolbar-symbol-search"]',
    '[data-name="legend-source-title"]',
  ];
  for (const selector of selectors) {
    const elements = [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => visibleArea(element) > 0);
    for (const element of elements) {
      const candidates = [
        element.getAttribute('data-symbol-full'), element.getAttribute('data-symbol'),
        element.getAttribute('data-ticker'), element.innerText,
      ];
      for (const candidate of candidates) {
        if (!candidate) continue;
        for (const line of candidate.split(/\r?\n/)) {
          const parsed = parseQualifiedSymbol(line);
          if (parsed.symbol) return parsed;
        }
      }
    }
  }
  for (const element of chart.querySelectorAll<HTMLElement>('[data-symbol-full],[data-symbol],[data-ticker]')) {
    if (visibleArea(element) === 0) continue;
    for (const attribute of ['data-symbol-full', 'data-symbol', 'data-ticker']) {
      const parsed = parseQualifiedSymbol(element.getAttribute(attribute) ?? '');
      if (parsed.symbol) return parsed;
    }
  }
  return {};
}

function parseSymbolFromUrl(): {
  exchange?: string;
  symbol?: string;
} {
  const raw = new URL(location.href).searchParams.get('symbol');
  if (!raw) return {};

  const [exchange, ...symbolParts] = raw.split(':');
  const symbol = symbolParts.join(':');

  return {
    exchange: exchange || undefined,
    symbol: symbol || exchange || undefined,
  };
}

function visibleArea(element: Element): number {
  const rect = element.getBoundingClientRect();
  const width = Math.max(
    0,
    Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0),
  );
  const height = Math.max(
    0,
    Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0),
  );
  return width * height;
}

export function findActiveTradingViewChart(): HTMLElement | null {
  const labelledCharts = [...document.querySelectorAll<HTMLElement>(CHART_SELECTOR)]
    .filter((chart) => visibleArea(chart) > 0);
  if (labelledCharts.length > 0) {
    return labelledCharts.sort((a, b) => visibleArea(b) - visibleArea(a))[0] ?? null;
  }

  const canvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas')]
    .filter((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return rect.width >= 320 && rect.height >= 200 && visibleArea(canvas) > 0;
    })
    .sort((a, b) => visibleArea(b) - visibleArea(a));
  const canvas = canvases[0];
  if (!canvas) return null;

  let chart: HTMLElement = canvas;
  let ancestor = canvas.parentElement;
  for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
    const rect = ancestor.getBoundingClientRect();
    if (rect.width > window.innerWidth * 1.05 || rect.height > window.innerHeight * 1.05) break;
    if (rect.width >= 320 && rect.height >= 240 && visibleArea(ancestor) > 0) chart = ancestor;
  }
  return chart;
}

export async function collectTradingViewContextWithRetry(
  timeoutMs = 6000,
): Promise<ChartContext> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  do {
    try {
      return collectTradingViewContext();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } while (Date.now() < deadline);
  throw lastError;
}

export function collectTradingViewContext(): ChartContext {
  const chart = findActiveTradingViewChart();
  if (!chart) {
    throw new Error('No visible TradingView chart was found.');
  }

  const rect = chart.getBoundingClientRect();
  if (rect.width < 320 || rect.height < 240 || visibleArea(chart) === 0) {
    throw new Error('The TradingView chart is too small or outside the viewport.');
  }

  const urlSymbol = parseSymbolFromUrl();
  const liveSymbol = parseSymbolFromLiveChart(chart);
  const symbolChangedFromUrl = Boolean(
    liveSymbol.symbol && urlSymbol.symbol && liveSymbol.symbol !== urlSymbol.symbol,
  );
  const canvasLabel = (chart.matches('canvas') ? chart : chart.querySelector<HTMLCanvasElement>(CHART_CANVAS_SELECTOR))
    ?.getAttribute('aria-label');
  // The legacy Change interval node may remain mounted with stale text after
  // TradingView switches resolution. The visible top-toolbar button is the
  // authoritative state and must win when both nodes exist.
  const rawTimeframe = activeIntervalLabel() ?? textOf('[aria-label="Change interval"]');
  const context = {
    site: 'tradingview' as const,
    pageType: 'advanced-chart' as const,
    url: location.href,
    symbol: liveSymbol.symbol ?? urlSymbol.symbol,
    exchange: liveSymbol.exchange ?? (symbolChangedFromUrl ? undefined : urlSymbol.exchange),
    timeframe: normalizeTradingViewTimeframe(rawTimeframe) ?? rawTimeframe,
    currentOhlcText: chart.innerText.trim().slice(0, 500) || undefined,
    chart: {
      id: chart.getAttribute('aria-label') ?? 'Chart #1',
      ariaLabel: canvasLabel ?? undefined,
      bounds: {
        x: Math.max(0, rect.x),
        y: Math.max(0, rect.y),
        width: Math.min(rect.right, window.innerWidth) - Math.max(0, rect.x),
        height: Math.min(rect.bottom, window.innerHeight) - Math.max(0, rect.y),
      },
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
  };

  return chartContextSchema.parse(context);
}
