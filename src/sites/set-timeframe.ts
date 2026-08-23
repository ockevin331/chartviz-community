import { collectActiveChartContext } from './collect-context';
import type { SupportedCaptureTimeframe } from '../domain/messages';
import { elementText, findActiveBinanceChart, normalizeBinanceTimeframe } from './binance/collect-context';
import { normalizeHyperliquidTimeframe, rememberMexcTimeframe } from './exchanges/collect-context';
import { normalizeTradingViewTimeframe } from './tradingview/collect-context';
import { requestUpbitFrameTimeframeSwitch } from './upbit/frame-timeframe';

const LABELS: Record<string, string[]> = {
  '5m': ['5m', '5 min', '5 mins', '5 minutes', '5分钟', '5분', '5분봉'],
  '15m': ['15m', '15 min', '15 mins', '15 minutes', '15分钟', '15분', '15분봉'],
  '1h': ['1h', '60m', '1 hour', '1小时', '60分钟', '1시간', '60분', '60분봉'],
  '4h': ['4h', '240m', '4 hours', '4小时', '4시간', '240분', '240분봉'],
  '1d': ['1d', '1 day', 'daily', '日线', '1天', '1일', '1일봉', '일봉', '일간'],
};

const VERGEX_INTERVAL_VALUES: Record<string, string[]> = {
  '5m': ['5', '300'],
  '15m': ['15', '900'],
  '1h': ['60', '3600'],
  '4h': ['240', '14400'],
  '1d': ['1440', '86400'],
};

const TRADINGVIEW_INTERVAL_VALUES: Record<string, string[]> = {
  '5m': ['5', '5m'],
  '15m': ['15', '15m'],
  '1h': ['60', '1h'],
  '4h': ['240', '4h'],
  '1d': ['1D', '1d', 'D'],
};

function elementStyle(element: Element): CSSStyleDeclaration {
  return element.ownerDocument.defaultView?.getComputedStyle(element) ?? getComputedStyle(element);
}

export function rectIntersectsViewport(
  rect: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  return rect.right > 0 && rect.bottom > 0
    && rect.left < viewportWidth && rect.top < viewportHeight;
}

function visible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = elementStyle(element);
  const view = element.ownerDocument.defaultView;
  return rect.width > 0 && rect.height > 0
    && rectIntersectsViewport(rect, view?.innerWidth ?? innerWidth, view?.innerHeight ?? innerHeight)
    && style.visibility !== 'hidden' && style.display !== 'none';
}

function roots(): ParentNode[] {
  const values: ParentNode[] = [document];
  for (let index = 0; index < values.length; index += 1) {
    const root = values[index]!;
    for (const frame of root.querySelectorAll<HTMLIFrameElement>('iframe')) {
      try {
        if (frame.contentDocument && !values.includes(frame.contentDocument)) values.push(frame.contentDocument);
      } catch { /* cross-origin */ }
    }
    for (const element of root.querySelectorAll<HTMLElement>('*')) {
      if (element.shadowRoot && !values.includes(element.shadowRoot)) values.push(element.shadowRoot);
    }
  }
  return values;
}

const CONTROL_SELECTOR = 'button, a, option, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [value], [data-value], [data-interval], [data-timeframe], [data-resolution]';

function clickableControl(element: HTMLElement): HTMLElement | undefined {
  const direct = element.closest<HTMLElement>(CONTROL_SELECTOR);
  if (direct && visible(direct)) return direct;
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
    const style = elementStyle(current);
    if (current.onclick || current.tabIndex >= 0 || style.cursor === 'pointer') return current;
  }
  // React delegates click handlers, so a plain div/span with no `onclick`
  // property can still be the actual option (as on VergeX).
  return visible(element) ? element : undefined;
}

function controlValues(element: HTMLElement): string[] {
  return [element.textContent, element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('value'), element.getAttribute('data-value'), element.getAttribute('data-interval'), element.getAttribute('data-timeframe'), element.getAttribute('data-resolution')]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLowerCase().replace(/\s+/g, ' '));
}

function labelMatches(value: string, labels: string[]): boolean {
  if (labels.includes(value)) return true;
  return labels.some((label) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[\\s(/·|])${escaped}(?:$|[\\s)/·|])`, 'i').test(value);
  });
}

export function hyperliquidControlMatchesTimeframe(
  target: SupportedCaptureTimeframe,
  values: Array<string | null | undefined>,
): boolean {
  return values.some((value) => normalizeHyperliquidTimeframe(value) === target);
}

function hyperliquidMatchingControl(target: SupportedCaptureTimeframe): HTMLElement | undefined {
  if (location.hostname !== 'app.hyperliquid.xyz') return undefined;
  const chart = findActiveBinanceChart();
  if (!chart) return undefined;
  const chartRect = chart.getBoundingClientRect();
  const candidates: Array<{ control: HTMLElement; score: number }> = [];
  const seen = new Set<HTMLElement>();

  for (const root of roots()) {
    for (const element of root.querySelectorAll<HTMLElement>(`${CONTROL_SELECTOR}, span, li, div`)) {
      if (!visible(element) || element.children.length > 3) continue;
      const values = controlValues(element);
      if (!hyperliquidControlMatchesTimeframe(target, values)) continue;
      const control = clickableControl(element);
      if (!control || seen.has(control) || !visible(control)) continue;
      const rect = control.getBoundingClientRect();
      // Keep the search around the chart toolbar and its opened interval menu.
      // This avoids treating matching price/quantity text elsewhere on the
      // trading screen as an interval control.
      if (rect.width > 180 || rect.height > 72
        || rect.bottom < chartRect.top - 180 || rect.top > chartRect.top + 560
        || rect.right < chartRect.left - 120 || rect.left > chartRect.right + 120) continue;
      seen.add(control);
      const identity = `${control.tagName} ${control.className} ${control.getAttribute('role') ?? ''} ${control.getAttribute('data-state') ?? ''} ${control.getAttribute('data-testid') ?? ''}`.toLowerCase();
      let score = 0;
      if (control.matches('button,a,[role="button"],[role="tab"],[role="menuitem"],[role="option"]')) score += 12;
      if (control.matches('[role="menuitem"],[role="option"],[data-radix-collection-item]')) score += 10;
      if (control.hasAttribute('data-value') || control.hasAttribute('data-interval')
        || control.hasAttribute('data-timeframe') || control.hasAttribute('data-resolution')) score += 8;
      if (/time|period|interval|resolution|candle/.test(identity)) score += 6;
      if (control !== element) score += 2;
      score -= Math.abs(rect.top - chartRect.top) / 200;
      candidates.push({ control, score });
    }
  }
  return candidates.sort((a, b) => b.score - a.score)[0]?.control;
}

function matchingControl(target: string): HTMLElement | undefined {
  const labels = LABELS[target]!.map((label) => label.toLowerCase());
  const vergexValues = location.hostname === 'vergex.trade'
    ? (VERGEX_INTERVAL_VALUES[target] ?? []) : [];
  const tradingViewValues = /(^|\.)tradingview\.com$/i.test(location.hostname)
    ? (TRADINGVIEW_INTERVAL_VALUES[target] ?? []) : [];
  for (const root of roots()) {
    const elements = root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR);
    // TradingView has range shortcuts such as `1D` whose accessible label is
    // "1 day in 1 minute intervals". A fuzzy "1 day" text match clicks that
    // range shortcut and changes the chart to 1m. Prefer the interval menu's
    // exact data-value (for example `1D`) before considering any labels.
    if (tradingViewValues.length) {
      for (const element of elements) {
        if (!visible(element)) continue;
        // Only interval-picker rows are valid. Saved TradingView layouts may
        // expose range shortcuts elsewhere with the same `data-value="1D"`;
        // clicking those changes the visible range and can leave the chart on
        // a 1-minute resolution.
        const role = element.getAttribute('role');
        if (!['row', 'option', 'menuitem'].includes(role ?? '')) continue;
        const intervalAttributes = [
          element.getAttribute('value'), element.getAttribute('data-value'),
          element.getAttribute('data-interval'), element.getAttribute('data-timeframe'),
          element.getAttribute('data-resolution'),
        ].filter((value): value is string => Boolean(value)).map((value) => value.trim());
        if (intervalAttributes.some((value) => tradingViewValues.includes(value))) return element;
      }
    }
    for (const element of elements) {
      if (!visible(element)) continue;
      const values = controlValues(element);
      const isTradingViewRangeShortcut = tradingViewValues.length > 0
        && values.some((value) => /\bin\s+\d+\s+(?:second|minute|hour|day|week|month)s?\s+intervals?\b/i.test(value));
      if (!isTradingViewRangeShortcut && values.some((value) => labelMatches(value, labels))) return element;
      const intervalAttributes = [
        element.getAttribute('value'), element.getAttribute('data-value'),
        element.getAttribute('data-interval'), element.getAttribute('data-timeframe'),
        element.getAttribute('data-resolution'),
      ].filter((value): value is string => Boolean(value)).map((value) => value.trim());
      // TradingView interval attributes are only trustworthy on the picker
      // rows handled by the exact pass above. Range shortcuts can expose the
      // same data-value (notably `1D`) while changing the chart to 1-minute
      // candles, so never accept them through this generic fallback.
      if (intervalAttributes.some((value) => vergexValues.includes(value))) return element;
    }
    if (!tradingViewValues.length) {
      // Bybit renders chart intervals as plain span/div nodes with the click
      // handler attached to a styled ancestor instead of an ARIA button.
      // Never run this loose fallback on TradingView: its bottom `1D` range
      // shortcut contains the same text as the daily candle interval.
      for (const element of root.querySelectorAll<HTMLElement>('span, div, li')) {
        if (!visible(element) || element.children.length > 2) continue;
        const text = element.textContent?.trim().toLowerCase();
        if (!text || !labelMatches(text, labels)) continue;
        const control = clickableControl(element);
        if (control) return control;
      }
    }
  }
  return undefined;
}

function htxMatchingControl(target: string): HTMLElement | undefined {
  if (!/(^|\.)htx\.com$/i.test(location.hostname)) return undefined;
  const chart = findActiveBinanceChart();
  if (!chart) return undefined;
  const chartRect = chart.getBoundingClientRect();
  const labels = LABELS[target]!.map((label) => label.toLowerCase());
  const candidates: Array<{ control: HTMLElement; score: number }> = [];
  for (const root of roots()) {
    for (const element of root.querySelectorAll<HTMLElement>(`${CONTROL_SELECTOR}, span, li, div`)) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width > 180 || rect.height > 64
        || rect.bottom < chartRect.top - 180 || rect.top > chartRect.top + 160
        || rect.right < chartRect.left || rect.left > chartRect.right) continue;
      const values = controlValues(element);
      if (!values.some((value) => labelMatches(value, labels))) continue;
      const control = clickableControl(element);
      if (!control) continue;
      const identity = `${control.tagName} ${control.className} ${control.getAttribute('role') ?? ''}`.toLowerCase();
      let score = 0;
      if (control.matches('button,a,[role="button"],[role="tab"],[role="menuitem"],[data-value],[data-interval],[data-timeframe],[data-resolution]')) score += 8;
      if (control !== element) score += 3;
      if (/period|time|interval|resolution|kline/.test(identity)) score += 4;
      score -= Math.abs(rect.bottom - chartRect.top) / 100;
      candidates.push({ control, score });
    }
  }
  return candidates.sort((a, b) => b.score - a.score)[0]?.control;
}

function binanceMatchingControl(target: SupportedCaptureTimeframe): HTMLElement | undefined {
  if (!/(^|\.)binance\.com$/i.test(location.hostname)) return undefined;
  const chart = findActiveBinanceChart();
  if (!chart) return undefined;
  const chartRect = chart.getBoundingClientRect();
  const elements = new Set<HTMLElement>();

  // Binance renders the interval toolbar after the chart container. Search
  // exact interval values without walking every element/shadow root in its
  // very large trading DOM; that generic scan can miss the toolbar while the
  // page is still hydrating.
  for (const element of document.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)) {
    if (normalizeBinanceTimeframe(elementText(element)) === target
      || controlValues(element).some((value) => normalizeBinanceTimeframe(value) === target)) {
      elements.add(element);
    }
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (normalizeBinanceTimeframe(node.textContent) !== target) continue;
    if (node.parentElement) elements.add(node.parentElement);
  }

  const candidates: Array<{ control: HTMLElement; score: number }> = [];
  for (const element of elements) {
    if (!visible(element)) continue;
    const control = clickableControl(element);
    if (!control || !visible(control)) continue;
    const rect = control.getBoundingClientRect();
    if (rect.width > 180 || rect.height > 72
      || rect.bottom < chartRect.top - 180 || rect.top > chartRect.top + 200
      || rect.right < chartRect.left || rect.left > chartRect.right) continue;
    const identity = `${control.tagName} ${control.className} ${control.getAttribute('role') ?? ''} ${control.getAttribute('data-testid') ?? ''}`.toLowerCase();
    let score = 0;
    if (control.matches(CONTROL_SELECTOR)) score += 10;
    if (/time|period|interval|resolution|kline/.test(identity)) score += 5;
    if (control === element) score += 2;
    score -= Math.abs(rect.bottom - chartRect.top) / 100;
    candidates.push({ control, score });
  }
  return candidates.sort((a, b) => b.score - a.score)[0]?.control;
}

function exchangeToolbarMatchingControl(
  hostname: RegExp,
  target: SupportedCaptureTimeframe,
): HTMLElement | undefined {
  if (!hostname.test(location.hostname)) return undefined;
  const chart = findActiveBinanceChart();
  if (!chart) return undefined;
  const topLevelChartRect = chart.getBoundingClientRect();
  const candidates: Array<{ control: HTMLElement; score: number }> = [];
  const seen = new Set<HTMLElement>();
  for (const root of roots()) {
    const rootDocument = root instanceof Document ? root : root.ownerDocument;
    const isTopLevel = rootDocument === document;
    const chartRect = isTopLevel ? topLevelChartRect : {
      top: 0, bottom: 180, left: 0,
      right: rootDocument?.defaultView?.innerWidth ?? topLevelChartRect.width,
    };
    for (const element of root.querySelectorAll<HTMLElement>(`${CONTROL_SELECTOR}, span, li, div`)) {
      if (!visible(element) || element.children.length > 3) continue;
      if (!controlValues(element).some((value) => normalizeBinanceTimeframe(value) === target)) continue;
      const control = clickableControl(element);
      if (!control || seen.has(control) || !visible(control)) continue;
      const rect = control.getBoundingClientRect();
      if (rect.width > 180 || rect.height > 72
        || rect.bottom < chartRect.top - 180 || rect.top > chartRect.top + 520
        || rect.right < chartRect.left || rect.left > chartRect.right) continue;
      seen.add(control);
      const identity = `${control.tagName} ${control.className} ${control.getAttribute('role') ?? ''} ${control.getAttribute('data-testid') ?? ''}`.toLowerCase();
      let score = 0;
      if (control.matches(CONTROL_SELECTOR)) score += 12;
      if (control.matches('[role="menuitem"],[role="option"],[role="tab"]')) score += 8;
      if (control.hasAttribute('data-value') || control.hasAttribute('data-interval')
        || control.hasAttribute('data-timeframe') || control.hasAttribute('data-resolution')) score += 7;
      if (/time|period|interval|resolution|kline|chart/.test(identity)) score += 5;
      score -= Math.abs(rect.bottom - chartRect.top) / 100;
      candidates.push({ control, score });
    }
  }
  return candidates.sort((a, b) => b.score - a.score)[0]?.control;
}

function bitgetMatchingControl(target: SupportedCaptureTimeframe): HTMLElement | undefined {
  return exchangeToolbarMatchingControl(/(^|\.)bitget\.com$/i, target);
}

function mexcMatchingControl(target: SupportedCaptureTimeframe): HTMLElement | undefined {
  return exchangeToolbarMatchingControl(/(^|\.)mexc\.com$/i, target);
}

async function waitForBinanceControl(
  target: SupportedCaptureTimeframe,
  timeoutMs = 12000,
): Promise<HTMLElement | undefined> {
  const deadline = Date.now() + timeoutMs;
  do {
    const control = binanceMatchingControl(target);
    if (control) return control;
    await new Promise((resolve) => setTimeout(resolve, 350));
  } while (Date.now() < deadline);
  return undefined;
}

function coinbaseChartDocument(): Document | undefined {
  if (!/(^|\.)coinbase\.com$/i.test(location.hostname)) return undefined;
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[title="Financial Chart" i]')) {
    try {
      if (frame.contentDocument) return frame.contentDocument;
    } catch { /* cross-origin chart frame */ }
  }
  return undefined;
}

function coinbaseMatchingControl(target: SupportedCaptureTimeframe): HTMLElement | undefined {
  const root = coinbaseChartDocument();
  if (!root) return undefined;
  const viewportHeight = root.defaultView?.innerHeight ?? 0;
  const candidates: Array<{ control: HTMLElement; score: number }> = [];
  const seen = new Set<HTMLElement>();
  for (const element of root.querySelectorAll<HTMLElement>(`${CONTROL_SELECTOR}, span, li, div`)) {
    if (!visible(element) || element.children.length > 3) continue;
    if (!controlValues(element).some((value) => normalizeBinanceTimeframe(value) === target)) continue;
    const control = clickableControl(element);
    if (!control || seen.has(control) || !visible(control)) continue;
    const rect = control.getBoundingClientRect();
    // Financial Chart also renders 1H/1D/1M range shortcuts below its
    // viewport. Those change the visible range, not candle resolution.
    if (rect.top < 0 || rect.top > Math.min(420, viewportHeight * 0.65)
      || rect.width > 180 || rect.height > 72) continue;
    seen.add(control);
    const identity = `${control.tagName} ${control.getAttribute('role') ?? ''} ${control.className}`.toLowerCase();
    let score = 0;
    if (control.matches('button,[role="button"],[role="menuitem"],[role="option"]')) score += 10;
    if (/menu|option|interval|timeframe/.test(identity)) score += 6;
    score -= rect.top / 100;
    candidates.push({ control, score });
  }
  return candidates.sort((a, b) => b.score - a.score)[0]?.control;
}

function coinbaseIntervalMenuControl(currentTimeframe?: string): HTMLElement | undefined {
  const root = coinbaseChartDocument();
  if (!root || !currentTimeframe) return undefined;
  return [...root.querySelectorAll<HTMLElement>('button,[role="button"]')]
    .filter((element) => {
      if (!visible(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.top < 100 && rect.width <= 120 && rect.height <= 60
        && controlValues(element).some((value) => normalizeBinanceTimeframe(value) === currentTimeframe);
    })
    .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
}

async function waitForCoinbaseControl(
  target: SupportedCaptureTimeframe,
  currentTimeframe?: string,
  timeoutMs = 12000,
): Promise<HTMLElement | undefined> {
  const deadline = Date.now() + timeoutMs;
  let openedIntervalMenu = false;
  do {
    const control = coinbaseMatchingControl(target);
    if (control) return control;
    if (!openedIntervalMenu) {
      const menu = coinbaseIntervalMenuControl(currentTimeframe);
      if (menu) {
        menu.click();
        openedIntervalMenu = true;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, openedIntervalMenu ? 400 : 350));
  } while (Date.now() < deadline);
  return undefined;
}

async function waitForGenericControl(
  target: SupportedCaptureTimeframe,
  currentTimeframe?: string,
  timeoutMs = 12000,
): Promise<HTMLElement | undefined> {
  const deadline = Date.now() + timeoutMs;
  let openedIntervalMenu = false;
  let clickedHoveredMenu = false;
  let hoveredMenu: HTMLElement | undefined;
  let menuOpenedAt = 0;
  do {
    const control = bitgetMatchingControl(target) ?? mexcMatchingControl(target)
      ?? htxMatchingControl(target) ?? hyperliquidMatchingControl(target) ?? matchingControl(target);
    if (control) return control;
    if (!openedIntervalMenu) {
      const bitgetMenu = bitgetIntervalMenuControl();
      const menu = hyperliquidIntervalMenuControl() ?? bitgetMenu
        ?? intervalMenuControl() ?? selectedIntervalControl(currentTimeframe);
      if (menu) {
        if (bitgetMenu === menu) {
          const MouseEventConstructor = menu.ownerDocument.defaultView?.MouseEvent ?? MouseEvent;
          const PointerEventConstructor = menu.ownerDocument.defaultView?.PointerEvent;
          if (PointerEventConstructor) {
            menu.dispatchEvent(new PointerEventConstructor('pointerover', { bubbles: true, cancelable: true }));
            menu.dispatchEvent(new PointerEventConstructor('pointerenter', { bubbles: false, cancelable: true }));
          }
          menu.dispatchEvent(new MouseEventConstructor('mouseover', { bubbles: true, cancelable: true }));
          menu.dispatchEvent(new MouseEventConstructor('mouseenter', { bubbles: false, cancelable: true }));
          hoveredMenu = menu;
          menuOpenedAt = Date.now();
        } else {
          menu.click();
        }
        openedIntervalMenu = true;
      }
    } else if (hoveredMenu && !clickedHoveredMenu && Date.now() - menuOpenedAt >= 700) {
      // Some Bitget layouts open this menu on hover, while compact layouts
      // use click. Try click only after hover had time to reveal its options,
      // so a successful hover is not immediately toggled closed.
      hoveredMenu.click();
      clickedHoveredMenu = true;
    }
    await new Promise((resolve) => setTimeout(resolve, openedIntervalMenu ? 400 : 350));
  } while (Date.now() < deadline);
  return undefined;
}

function bitgetIntervalMenuControl(): HTMLElement | undefined {
  if (!/(^|\.)bitget\.com$/i.test(location.hostname)) return undefined;
  const chart = findActiveBinanceChart();
  if (!chart) return undefined;
  const chartRect = chart.getBoundingClientRect();
  // Verified on the live Bitget spot page: the visible row is Time, 1s, 5m,
  // 15m, 1h, 1D, then the first compact `.bit-dropdown-trigger` opens the
  // remaining intervals (including 4h). Later triggers are chart tools.
  return [...document.querySelectorAll<HTMLElement>('.bit-dropdown-trigger')]
    .filter((element) => {
      if (!visible(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width <= 80 && rect.height <= 52
        && rect.bottom >= chartRect.top - 140 && rect.top <= chartRect.top + 80
        && rect.right >= chartRect.left && rect.left <= chartRect.right;
    })
    .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
}

function hyperliquidIntervalMenuControl(): HTMLElement | undefined {
  if (location.hostname !== 'app.hyperliquid.xyz') return undefined;
  for (const root of roots()) {
    // Verified against the live Hyperliquid TradingView iframe. It contains
    // three responsive copies of this button; only the third is visible.
    for (const element of root.querySelectorAll<HTMLElement>('button[aria-label="Time Interval"]')) {
      if (visible(element)) return element;
    }
  }
  return undefined;
}

function intervalMenuControl(): HTMLElement | undefined {
  for (const root of roots()) {
    if (/(^|\.)tradingview\.com$/i.test(location.hostname)) {
      const activeInterval = [...root.querySelectorAll<HTMLElement>('button[aria-label]')]
        .filter((element) => {
          if (!visible(element)) return false;
          const rect = element.getBoundingClientRect();
          const label = element.getAttribute('aria-label')?.trim() ?? '';
          return rect.top < 80 && rect.width < 120
            && /^\d+\s+(?:minute|minutes|hour|hours|day|days|week|weeks|month|months)$/i.test(label);
        })
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
      if (activeInterval) return activeInterval;
    }
    const selectors = [
      '[aria-label="Change interval"]',
      '#header-toolbar-intervals',
      '#header_interval_dialog_button',
      '#header-interval-dialog-button',
      '#header-resolutions',
      '[data-name="header_interval_dialog_button"]',
      '[data-name="header-interval-dialog-button"]',
      '[data-name="header-resolutions"]',
      '[data-name="header-toolbar-intervals"]',
      '[data-name="header-toolbar-intervals-more"]',
      '[data-name="header-intervals"]',
      '[data-name*="intervals" i]',
      '[aria-label*="interval" i]',
      '[title*="interval" i]',
      '[aria-label*="timeframe" i]',
      '[title*="timeframe" i]',
      '[data-testid*="timeframe" i]',
      '[data-testid*="interval" i]',
      '[class*="timeframe" i]',
      '[class*="interval-select" i]',
    ];
    for (const selector of selectors) {
      // Embedded TradingView charts keep multiple responsive toolbar copies in
      // the DOM. Hyperliquid currently renders two hidden `Time Interval`
      // buttons before the visible one, so querySelector() always found a
      // hidden copy and never opened the menu containing 15m. Inspect every
      // match and choose the first visible interactive copy.
      for (const element of root.querySelectorAll<HTMLElement>(selector)) {
        if (!visible(element)) continue;
      // TradingView's `header-toolbar-intervals` node is a layout container;
      // clicking it does not open the resolution menu. Resolve the actual
      // interactive child before falling back to the matched node itself.
        const childControls = [...element.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)]
          .filter((candidate) => visible(candidate));
        const menuChild = childControls.find((candidate) => {
          const identity = `${candidate.id} ${candidate.getAttribute('data-name') ?? ''} ${candidate.getAttribute('aria-label') ?? ''} ${candidate.getAttribute('title') ?? ''} ${candidate.textContent ?? ''}`.toLowerCase();
          return /dialog|more|change interval|select interval|timeframe menu|interval menu/.test(identity);
        });
        if (menuChild) return menuChild;
        // In compact TradingView layouts the overflow trigger is the final
        // control in the intervals group and may expose no accessible label.
        if (childControls.length) return childControls.at(-1);
        const control = clickableControl(element);
        if (control) return control;
      }
    }
  }
  return undefined;
}

function tradingViewIntervalScroller(): HTMLElement | undefined {
  const candidates = new Map<HTMLElement, number>();
  const addCandidate = (element: HTMLElement, score: number) => {
    if (!visible(element) || element.scrollHeight <= element.clientHeight + 8) return;
    const rect = element.getBoundingClientRect();
    // The interval picker opens under the left side of the top toolbar. This
    // excludes the chart canvas, watchlist and ChartViz floating panel.
    if (rect.top > 600 || rect.left > Math.min(720, window.innerWidth * 0.65)
      || rect.width < 100 || rect.width > 720 || rect.height < 80) return;
    candidates.set(element, Math.max(candidates.get(element) ?? -Infinity, score));
  };

  for (const root of roots()) {
    for (const option of root.querySelectorAll<HTMLElement>('[role="row"], [role="option"], [role="menuitem"]')) {
      if (!visible(option)) continue;
      let ancestor = option.parentElement;
      for (let depth = 0; ancestor && depth < 8; depth += 1, ancestor = ancestor.parentElement) {
        const identity = `${ancestor.getAttribute('role') ?? ''} ${ancestor.getAttribute('data-name') ?? ''} ${ancestor.className}`.toLowerCase();
        addCandidate(ancestor, 100 - depth + (/interval|resolution|menu|list|scroll/.test(identity) ? 30 : 0));
      }
    }
    for (const element of root.querySelectorAll<HTMLElement>('div, [role="listbox"], [role="menu"], [role="grid"], [role="dialog"]')) {
      const style = elementStyle(element);
      if (!/(?:auto|scroll)/.test(style.overflowY)) continue;
      const identity = `${element.getAttribute('role') ?? ''} ${element.getAttribute('data-name') ?? ''} ${element.className}`.toLowerCase();
      addCandidate(element, /interval|resolution|menu|list|scroll/.test(identity) ? 80 : 10);
    }
  }

  return [...candidates.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

const TIMEFRAME_MINUTES: Record<SupportedCaptureTimeframe, number> = {
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
};

async function findTradingViewIntervalInMenu(
  target: SupportedCaptureTimeframe,
  currentTimeframe?: string,
): Promise<HTMLElement | undefined> {
  const menu = intervalMenuControl() ?? selectedIntervalControl(currentTimeframe);
  if (!menu) return undefined;
  menu.click();
  await new Promise((resolve) => setTimeout(resolve, 450));

  const currentMinutes = TIMEFRAME_MINUTES[currentTimeframe as SupportedCaptureTimeframe];
  const direction = currentMinutes && TIMEFRAME_MINUTES[target] < currentMinutes ? -1 : 1;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const control = matchingControl(target);
    if (control) return control;
    const scroller = tradingViewIntervalScroller();
    if (!scroller) return undefined;
    const previous = scroller.scrollTop;
    const step = Math.max(120, Math.round(scroller.clientHeight * 0.65));
    scroller.scrollTop = Math.max(0, Math.min(
      scroller.scrollHeight - scroller.clientHeight,
      previous + direction * step,
    ));
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 180));
    if (scroller.scrollTop === previous) break;
  }
  return matchingControl(target);
}

const TRADINGVIEW_INTERVAL_INPUT: Record<SupportedCaptureTimeframe, string> = {
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': '1D',
};

const VERGEX_INTERVAL_INPUT: Record<SupportedCaptureTimeframe, string> = {
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': '1D',
};

export function vergexIntervalForTimeframe(target: SupportedCaptureTimeframe): string {
  return VERGEX_INTERVAL_INPUT[target];
}

async function setVergexIntervalThroughPage(target: SupportedCaptureTimeframe): Promise<boolean> {
  const requestId = crypto.randomUUID();
  const result = new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('chartviz:vergex:set-timeframe:result', listener);
      resolve(false);
    }, 1500);
    const listener = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<{ requestId?: string; ok?: boolean }>;
      if (event.detail?.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener('chartviz:vergex:set-timeframe:result', listener);
      resolve(event.detail.ok === true);
    };
    window.addEventListener('chartviz:vergex:set-timeframe:result', listener);
  });
  window.dispatchEvent(new CustomEvent('chartviz:vergex:set-timeframe', {
    // VergeX persists TradingView resolution strings and normalizes them with
    // `.trim()`, so values such as 4h must be sent as "240", not number 240.
    detail: { requestId, interval: vergexIntervalForTimeframe(target) },
  }));
  return result;
}

function sendTradingViewIntervalShortcut(target: SupportedCaptureTimeframe): void {
  const input = TRADINGVIEW_INTERVAL_INPUT[target];
  for (const root of roots()) {
    if (!(root instanceof Document)) continue;
    const receiver = root.activeElement instanceof HTMLElement ? root.activeElement : root.body;
    receiver?.focus();
    for (const key of [...input, 'Enter']) {
      const code = key === 'Enter' ? 'Enter' : /^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`;
      const options: KeyboardEventInit = { key, code, bubbles: true, cancelable: true };
      receiver?.dispatchEvent(new KeyboardEvent('keydown', options));
      receiver?.dispatchEvent(new KeyboardEvent('keypress', options));
      receiver?.dispatchEvent(new KeyboardEvent('keyup', options));
    }
  }
}

function activateControl(control: HTMLElement): void {
  if (control instanceof HTMLOptionElement && control.parentElement instanceof HTMLSelectElement) {
    const select = control.parentElement;
    select.value = control.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  control.click();
}

function selectedIntervalControl(currentTimeframe?: string): HTMLElement | undefined {
  if (!currentTimeframe) return undefined;
  const labels = [currentTimeframe.toLowerCase(), ...(LABELS[currentTimeframe.toLowerCase()] ?? [])];
  for (const root of roots()) {
    for (const element of root.querySelectorAll<HTMLElement>('span, div, li, button')) {
      if (!visible(element) || element.children.length > 2) continue;
      // TradingView renders the active interval as compact text (`D`, `W`)
      // while exposing the real value only through accessibility metadata
      // (`aria-label="1 day"`). Match all control values, not only text.
      const values = controlValues(element);
      const matchesHyperliquid = location.hostname === 'app.hyperliquid.xyz'
        && hyperliquidControlMatchesTimeframe(currentTimeframe as SupportedCaptureTimeframe, values);
      if (!matchesHyperliquid && !values.some((value) => labelMatches(value, labels))) continue;
      const control = clickableControl(element);
      if (control) return control;
    }
  }
  return undefined;
}

async function waitForTimeframe(target: SupportedCaptureTimeframe, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let stableSamples = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    let matched = false;
    if (/(^|\.)tradingview\.com$/i.test(location.hostname)) {
      const visibleInterval = [...document.querySelectorAll<HTMLElement>('button[aria-label]')]
        .filter((element) => {
          if (!visible(element)) return false;
          const rect = element.getBoundingClientRect();
          const label = element.getAttribute('aria-label')?.trim() ?? '';
          return rect.top < 80 && rect.width < 120
            && /^\d+\s+(?:minute|minutes|hour|hours|day|days|week|weeks|month|months)$/i.test(label);
        })
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
      matched = normalizeTradingViewTimeframe(visibleInterval?.getAttribute('aria-label')) === target;
    }
    if (!matched) {
      const context = await collectActiveChartContext().catch(() => null);
      matched = context?.timeframe?.toLowerCase() === target;
    }
    stableSamples = matched ? stableSamples + 1 : 0;
    if (stableSamples >= 2) return true;
  }
  return false;
}

export async function setActiveChartTimeframe(target: SupportedCaptureTimeframe): Promise<void> {
  const current = await collectActiveChartContext();
  if (current.timeframe?.toLowerCase() === target) return;
  const isUpbit = /(^|\.)upbit\.com$/i.test(location.hostname);
  if (isUpbit && await requestUpbitFrameTimeframeSwitch(target)) {
    if (await waitForTimeframe(target, 10_000)) return;
  }
  if (location.hostname === 'vergex.trade' && await setVergexIntervalThroughPage(target)) {
    if (await waitForTimeframe(target)) return;
    throw new Error(`The chart did not switch to ${target}.`);
  }
  const isTradingView = /(^|\.)tradingview\.com$/i.test(location.hostname);
  const isBinance = /(^|\.)binance\.com$/i.test(location.hostname);
  const isCoinbase = /(^|\.)coinbase\.com$/i.test(location.hostname);
  const isMexc = /(^|\.)mexc\.com$/i.test(location.hostname);
  let control = isBinance
    ? await waitForBinanceControl(target)
    : isCoinbase
      ? await waitForCoinbaseControl(target, current.timeframe)
      : bitgetMatchingControl(target) ?? mexcMatchingControl(target)
        ?? htxMatchingControl(target) ?? hyperliquidMatchingControl(target) ?? matchingControl(target);
  if (!control && isTradingView) {
    control = await findTradingViewIntervalInMenu(target, current.timeframe);
  } else if (!control && !isBinance && !isCoinbase) {
    control = await waitForGenericControl(target, current.timeframe);
  }
  if (control) {
    activateControl(control);
    if (isMexc) {
      // The MEXC chart changes immediately, but its interval row exposes no
      // selected ARIA/data state. Keep the exact control we just activated as
      // a short-lived verification hint while the new candles finish loading.
      await new Promise((resolve) => setTimeout(resolve, 1400));
      rememberMexcTimeframe(target);
    }
  }
  else if (location.hostname === 'vergex.trade') sendTradingViewIntervalShortcut(target);
  // Do not use TradingView's synthetic keyboard shortcut as a fallback.
  // `1D` can be interpreted as `1` + Enter and switch the chart to 1m.
  else if (isTradingView) throw new Error(`The ${target} timeframe control was not found on this chart.`);
  else throw new Error(`The ${target} timeframe control was not found on this chart.`);
  if (await waitForTimeframe(target, control && isTradingView ? 3500 : 8000)) return;
  throw new Error(`The chart did not switch to ${target}.`);
}
