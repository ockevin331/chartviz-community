import { chartContextSchema, type ChartContext } from '../../domain/chart-context';
import {
  elementText,
  findActiveBinanceChart,
} from '../binance/collect-context';
import { currentUpbitFrameTimeframe } from './frame-timeframe';
import {
  normalizeUpbitLegendTimeframe,
  normalizeUpbitSavedLayoutTimeframe,
  normalizeUpbitTimeframe,
} from './timeframe';

export {
  normalizeUpbitLegendTimeframe,
  normalizeUpbitSavedLayoutTimeframe,
  normalizeUpbitTimeframe,
} from './timeframe';

const UPBIT_EXCHANGE_PATH = /^\/exchange\/?$/i;
const UPBIT_MARKET_CODE = /^(?:CRIX\.UPBIT\.)?([A-Z0-9]{2,12})-([A-Z0-9]{2,20})$/i;

export function parseUpbitExchangeUrl(value: string) {
  const url = new URL(value);
  if (!/(^|\.)upbit\.com$/i.test(url.hostname) || !UPBIT_EXCHANGE_PATH.test(url.pathname)) {
    return null;
  }
  const rawCode = url.searchParams.get('code') ?? url.searchParams.get('market');
  const match = rawCode?.trim().match(UPBIT_MARKET_CODE);
  if (!match) return null;
  const quoteAsset = match[1]!.toUpperCase();
  const baseAsset = match[2]!.toUpperCase();
  return { baseAsset, quoteAsset, symbol: `${baseAsset}/${quoteAsset}` };
}

function savedUpbitTradingViewTimeframe(): { exists: boolean; timeframe?: string } {
  try {
    const value = localStorage.getItem('tvLayout');
    return value === null
      ? { exists: false }
      : { exists: true, timeframe: normalizeUpbitSavedLayoutTimeframe(value) };
  } catch {
    return { exists: false };
  }
}

function visibleArea(element: Element): number {
  const rect = element.getBoundingClientRect();
  const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
  const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
  return width * height;
}

function timeframeValues(element: HTMLElement): Array<string | null> {
  return [
    elementText(element), element.getAttribute('aria-label'), element.getAttribute('title'),
    element.getAttribute('value'), element.getAttribute('data-value'),
    element.getAttribute('data-interval'), element.getAttribute('data-timeframe'),
    element.getAttribute('data-resolution'), element.getAttribute('data-period'),
    element.getAttribute('data-unit'), element.getAttribute('data-candle-unit'),
    element.getAttribute('data-candle-period'),
  ];
}

export function selectedUpbitTimeframe(chart: HTMLElement): string | undefined {
  const chartRect = chart.getBoundingClientRect();
  const frameTimeframe = currentUpbitFrameTimeframe();
  if (frameTimeframe) return frameTimeframe;

  const tradingViewContainer = document.getElementById('tv_chart_container');
  const savedTradingView = tradingViewContainer && visibleArea(tradingViewContainer) > 0
    ? savedUpbitTradingViewTimeframe()
    : undefined;
  if (savedTradingView?.timeframe) return savedTradingView.timeframe;
  // The TradingView legend exposes the active resolution as a compact token,
  // for example "BTC/KRW · 30 · UPBIT". This remains stable even when Upbit's
  // toolbar uses localized labels or does not expose an ARIA selected state.
  const legendCandidates = [
    elementText(chart).slice(0, 1000),
    ...[...document.querySelectorAll<HTMLElement>(
      '[data-name="legend-source-title"],[data-name="legend-series-item"],[class*="legend-source" i],[class*="pane-legend" i]',
    )].map(elementText),
  ];
  for (const candidate of legendCandidates) {
    const timeframe = normalizeUpbitLegendTimeframe(candidate);
    if (timeframe) return timeframe;
  }

  const explicitlySelected = [...document.querySelectorAll<HTMLElement>(
    '[aria-selected="true"],[aria-pressed="true"],[data-active="true"],[data-state="active"],[data-state="selected"]',
  )].flatMap((element) => {
    if (visibleArea(element) === 0) return [];
    const rect = element.getBoundingClientRect();
    if (rect.width > 240 || rect.height > 80) return [];
    const timeframe = timeframeValues(element)
      .map(normalizeUpbitTimeframe).find((value): value is string => Boolean(value));
    return timeframe ? [{ timeframe, distance: Math.abs(rect.bottom - chartRect.top) }] : [];
  }).sort((a, b) => a.distance - b.distance);
  if (explicitlySelected[0]) return explicitlySelected[0].timeframe;

  const candidates = [...document.querySelectorAll<HTMLElement>(
    'button,a,[role="button"],[role="tab"],[aria-selected],[aria-pressed],[data-value],[data-interval],[data-timeframe],[data-resolution],[data-period],span,li,div',
  )].flatMap((element) => {
    if (visibleArea(element) === 0) return [];
    const rect = element.getBoundingClientRect();
    if (rect.width > 180 || rect.height > 72
      || rect.bottom < chartRect.top - 180 || rect.top > chartRect.top + 220
      || rect.right < chartRect.left || rect.left > chartRect.right) return [];
    const timeframe = timeframeValues(element)
      .map(normalizeUpbitTimeframe).find((value): value is string => Boolean(value));
    if (!timeframe) return [];
    const identity = `${element.className} ${element.getAttribute('data-state') ?? ''}`.toLowerCase();
    let score = 0;
    if (element.getAttribute('aria-selected') === 'true' || element.getAttribute('aria-pressed') === 'true') score += 12;
    if (element.getAttribute('data-active') === 'true' || /active|selected|current|checked|on\b/.test(identity)) score += 9;
    const style = getComputedStyle(element);
    return [{
      timeframe, score, color: style.color,
      background: style.backgroundColor, weight: style.fontWeight,
    }];
  }).sort((a, b) => b.score - a.score);
  if ((candidates[0]?.score ?? 0) >= 8) return candidates[0]!.timeframe;
  const unique = [...new Set(candidates.map(item => item.timeframe))];
  if (unique.length === 1) return unique[0];

  const deduplicated = [...new Map(candidates.map(item => [
    `${item.timeframe}|${item.color}|${item.background}|${item.weight}`, item,
  ])).values()];
  const count = (key: 'color' | 'background' | 'weight', value: string) =>
    deduplicated.filter(item => item[key] === value).length;
  const visuallyRanked = deduplicated.map(item => {
    let visualScore = 0;
    if (count('color', item.color) === 1) visualScore += 4;
    if (count('weight', item.weight) === 1) visualScore += 2;
    if (!/rgba?\(0, 0, 0(?:, 0)?\)|transparent/.test(item.background)
      && count('background', item.background) === 1) visualScore += 5;
    return { timeframe: item.timeframe, visualScore };
  }).sort((a, b) => b.visualScore - a.visualScore);
  const visuallySelected = visuallyRanked[0]?.visualScore
    && visuallyRanked[0].visualScore > (visuallyRanked[1]?.visualScore ?? 0)
    ? visuallyRanked[0].timeframe : undefined;
  if (visuallySelected) return visuallySelected;

  // Upbit initializes a new TradingView layout at 1D. Use this only when the
  // TradingView container is active and no saved layout exists; a saved but
  // unreadable layout must remain unknown rather than being mislabeled 1D.
  return savedTradingView && !savedTradingView.exists ? '1d' : undefined;
}

export function collectUpbitContext(): ChartContext {
  const market = parseUpbitExchangeUrl(location.href);
  if (!market) throw new Error('Open an Upbit exchange page for a specific market first.');
  const chart = findActiveBinanceChart();
  if (!chart) throw new Error('No visible Upbit candlestick chart was found. Open the chart tab and try again.');
  const rect = chart.getBoundingClientRect();
  return chartContextSchema.parse({
    site: 'upbit', pageType: 'spot-trade', url: location.href,
    symbol: market.symbol, exchange: 'UPBIT', timeframe: selectedUpbitTimeframe(chart),
    currentOhlcText: elementText(chart).slice(0, 500) || undefined,
    chart: {
      id: chart.id || chart.getAttribute('data-testid') || 'Upbit chart',
      ariaLabel: chart.getAttribute('aria-label') || undefined,
      bounds: {
        x: Math.max(0, rect.x), y: Math.max(0, rect.y),
        width: Math.min(rect.right, innerWidth) - Math.max(0, rect.x),
        height: Math.min(rect.bottom, innerHeight) - Math.max(0, rect.y),
      },
    },
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
  });
}

export async function collectUpbitContextWithRetry(timeoutMs = 12000): Promise<ChartContext> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  let contextWithoutTimeframe: ChartContext | undefined;
  let timeframeGraceDeadline = 0;
  do {
    try {
      const context = collectUpbitContext();
      if (context.timeframe) return context;
      contextWithoutTimeframe = context;
      if (!timeframeGraceDeadline) timeframeGraceDeadline = Date.now() + 4000;
      if (Date.now() >= timeframeGraceDeadline) return context;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  } while (Date.now() < deadline);
  if (contextWithoutTimeframe) return contextWithoutTimeframe;
  throw lastError;
}
