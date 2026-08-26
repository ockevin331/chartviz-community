import {
  normalizeUpbitLegendTimeframe,
  normalizeUpbitTimeframe,
} from './timeframe';

const UPBIT_FRAME_MESSAGE_SOURCE = 'chartviz-upbit-frame';
const UPBIT_TOP_MESSAGE_SOURCE = 'chartviz-upbit-top';
const FRAME_TIMEFRAME_TTL_MS = 15_000;

const UPBIT_FRAME_INTERVAL_VALUES: Record<string, string[]> = {
  '5m': ['5', '5m'],
  '15m': ['15', '15m'],
  '1h': ['60', '1h', '60m'],
  '4h': ['240', '4h', '240m'],
  '1d': ['1D', 'D', '1d'],
};

export type UpbitFrameTimeframeEvidence = 'toolbar' | 'legend' | 'selected-control';

export interface UpbitFrameTimeframeSignal {
  timeframe: string;
  evidence: UpbitFrameTimeframeEvidence;
  confidence: number;
}

export interface UpbitFrameTimeframeCandidate extends UpbitFrameTimeframeSignal {
  receivedAt: number;
  frameElement?: HTMLIFrameElement;
  frameArea: number;
  documentVisible: boolean;
}

const frameTimeframeCandidates = new Map<MessageEventSource, UpbitFrameTimeframeCandidate>();
let lastSelectedFrameTimeframe: string | undefined;

function elementValues(element: HTMLElement): Array<string | null> {
  return [
    element.innerText,
    element.textContent,
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('value'),
    element.getAttribute('data-value'),
    element.getAttribute('data-interval'),
    element.getAttribute('data-timeframe'),
    element.getAttribute('data-resolution'),
    element.getAttribute('data-period'),
  ];
}

export function detectUpbitFrameTimeframe(root: ParentNode = document): string | undefined {
  return detectUpbitFrameTimeframeSignal(root)?.timeframe;
}

function isVisibleElement(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

export function detectUpbitFrameTimeframeSignal(
  root: ParentNode = document,
): UpbitFrameTimeframeSignal | undefined {
  // Prefer TradingView's current-interval toolbar control. Indicator legends
  // can contain standalone values such as 15 or 30, so scanning every legend
  // item before this control can mistake an indicator period for a timeframe.
  const activeIntervalElements = root.querySelectorAll<HTMLElement>([
    '[data-name="header-toolbar-intervals"] [aria-pressed="true"]',
    '[data-name="header-toolbar-intervals"] [aria-selected="true"]',
    '[data-name="header-toolbar-intervals"] [data-active="true"]',
    '[data-name="header-toolbar-intervals"] [data-state="active"]',
    '[data-name="header-toolbar-intervals"] [data-state="selected"]',
    '[data-name*="interval" i][aria-pressed="true"]',
    '[data-name*="interval" i][aria-selected="true"]',
    '[aria-label*="interval" i][aria-pressed="true"]',
    '[aria-label*="time frame" i][aria-pressed="true"]',
    '[aria-label*="시간 간격"][aria-pressed="true"]',
    '[aria-label*="주기"][aria-pressed="true"]',
  ].join(','));
  for (const element of activeIntervalElements) {
    if (!isVisibleElement(element)) continue;
    for (const value of elementValues(element)) {
      const timeframe = normalizeUpbitTimeframe(value)
        ?? normalizeUpbitLegendTimeframe(value);
      if (timeframe) return { timeframe, evidence: 'toolbar', confidence: 100 };
    }
  }

  // Some TradingView builds expose the active value on the group itself. It
  // is safe only when the group contains one unique timeframe; a favorites
  // toolbar such as "5m 15m 1h" must never be interpreted as its first child.
  for (const element of root.querySelectorAll<HTMLElement>('[data-name="header-toolbar-intervals"]')) {
    if (!isVisibleElement(element)) continue;
    for (const value of elementValues(element)) {
      const timeframe = normalizeUpbitTimeframe(value)
        ?? normalizeUpbitLegendTimeframe(value);
      if (timeframe) return { timeframe, evidence: 'toolbar', confidence: 95 };
    }
  }

  // Only inspect the main series title. `legend-series-item` and generic pane
  // legends also include indicator parameters, which are not chart intervals.
  const legendElements = root.querySelectorAll<HTMLElement>('[data-name="legend-source-title"]');
  for (const element of legendElements) {
    if (!isVisibleElement(element)) continue;
    for (const value of elementValues(element)) {
      const timeframe = normalizeUpbitLegendTimeframe(value);
      if (timeframe) return { timeframe, evidence: 'legend', confidence: 90 };
    }
  }

  const selectedElements = root.querySelectorAll<HTMLElement>(
    '[aria-selected="true"],[aria-pressed="true"],[data-active="true"],[data-state="active"],[data-state="selected"]',
  );
  for (const element of selectedElements) {
    if (!isVisibleElement(element)) continue;
    for (const value of elementValues(element)) {
      const timeframe = normalizeUpbitTimeframe(value);
      if (timeframe) return { timeframe, evidence: 'selected-control', confidence: 80 };
    }
  }
  return undefined;
}

export function publishUpbitFrameTimeframe(signal: UpbitFrameTimeframeSignal) {
  window.top?.postMessage({
    source: UPBIT_FRAME_MESSAGE_SOURCE,
    type: 'timeframe',
    ...signal,
    documentVisible: document.visibilityState === 'visible',
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
  }, '*');
}

function normalizedFrameControlTimeframe(element: HTMLElement): string | undefined {
  for (const value of elementValues(element)) {
    const timeframe = normalizeUpbitTimeframe(value)
      ?? normalizeUpbitLegendTimeframe(value);
    if (timeframe) return timeframe;
  }
  return undefined;
}

function upbitFrameIntervalControl(target: string): HTMLElement | undefined {
  const values = UPBIT_FRAME_INTERVAL_VALUES[target] ?? [];
  const candidates = [...document.querySelectorAll<HTMLElement>([
    'button', '[role="button"]', '[role="tab"]', '[role="row"]',
    '[role="option"]', '[role="menuitem"]', '[data-value]',
    '[data-interval]', '[data-timeframe]', '[data-resolution]',
  ].join(','))].filter(isVisibleElement).filter((element) => {
    if (normalizedFrameControlTimeframe(element) !== target) return false;
    const rect = element.getBoundingClientRect();
    const role = element.getAttribute('role');
    const inIntervalToolbar = Boolean(element.closest('[data-name="header-toolbar-intervals"]'));
    const intervalIdentity = `${element.getAttribute('data-name') ?? ''} ${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''}`.toLowerCase();
    const attributes = [
      element.getAttribute('value'), element.getAttribute('data-value'),
      element.getAttribute('data-interval'), element.getAttribute('data-timeframe'),
      element.getAttribute('data-resolution'),
    ].filter((value): value is string => Boolean(value)).map(value => value.trim());
    return inIntervalToolbar
      || ['row', 'option', 'menuitem'].includes(role ?? '')
      || (/interval|timeframe|resolution/.test(intervalIdentity)
        && attributes.some(value => values.includes(value)))
      || (rect.top < 140 && rect.width <= 140 && rect.height <= 72);
  });
  return candidates.sort((left, right) => {
    const leftMenuItem = ['row', 'option', 'menuitem'].includes(left.getAttribute('role') ?? '') ? 1 : 0;
    const rightMenuItem = ['row', 'option', 'menuitem'].includes(right.getAttribute('role') ?? '') ? 1 : 0;
    return rightMenuItem - leftMenuItem
      || left.getBoundingClientRect().top - right.getBoundingClientRect().top;
  })[0];
}

function upbitFrameIntervalMenu(): HTMLElement | undefined {
  const selectors = [
    '[aria-label="Change interval"]',
    '[data-name="header-toolbar-intervals"]',
    '[data-name="header-toolbar-intervals-more"]',
    '[data-name*="intervals" i]',
    '[aria-label*="interval" i]',
    '[aria-label*="timeframe" i]',
  ];
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element || !isVisibleElement(element)) continue;
    if (element.matches('button,[role="button"]')) return element;
    const child = [...element.querySelectorAll<HTMLElement>('button,[role="button"]')]
      .filter(isVisibleElement).at(-1);
    if (child) return child;
  }
  return undefined;
}

async function switchUpbitFrameTimeframe(target: string): Promise<boolean> {
  if (!UPBIT_FRAME_INTERVAL_VALUES[target]) return false;
  if (detectUpbitFrameTimeframe() === target) return true;
  let control = upbitFrameIntervalControl(target);
  if (!control) {
    upbitFrameIntervalMenu()?.click();
    await new Promise(resolve => setTimeout(resolve, 400));
    control = upbitFrameIntervalControl(target);
  }
  if (!control) return false;
  control.click();
  const deadline = Date.now() + 8_000;
  let stableSamples = 0;
  do {
    await new Promise(resolve => setTimeout(resolve, 250));
    stableSamples = detectUpbitFrameTimeframe() === target ? stableSamples + 1 : 0;
    if (stableSamples >= 2) return true;
  } while (Date.now() < deadline);
  return false;
}

export function installUpbitFrameTimeframeSwitchHandler() {
  window.addEventListener('message', async (event: MessageEvent<unknown>) => {
    if (event.source !== window.parent && event.source !== window.top) return;
    if (!event.data || typeof event.data !== 'object') return;
    const data = event.data as {
      source?: unknown;
      type?: unknown;
      requestId?: unknown;
      timeframe?: unknown;
    };
    if (data.source !== UPBIT_TOP_MESSAGE_SOURCE || data.type !== 'set-timeframe'
      || typeof data.requestId !== 'string' || typeof data.timeframe !== 'string') return;

    // Forward through any same- or cross-origin wrapper frames so the command
    // reaches the frame that actually owns the TradingView controls.
    for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe')) {
      frame.contentWindow?.postMessage(data, '*');
    }
    const ok = await switchUpbitFrameTimeframe(data.timeframe);
    window.top?.postMessage({
      source: UPBIT_FRAME_MESSAGE_SOURCE,
      type: 'set-timeframe-result',
      requestId: data.requestId,
      timeframe: data.timeframe,
      ok,
    }, '*');
  });
}

export async function requestUpbitFrameTimeframeSwitch(
  target: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  const requestId = crypto.randomUUID();
  return new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', listener);
      resolve(false);
    }, timeoutMs);
    const listener = (event: MessageEvent<unknown>) => {
      if (event.origin && event.origin !== 'null') {
        try {
          if (!/(^|\.)(?:upbit|tradingview)\.com$/i.test(new URL(event.origin).hostname)) return;
        } catch {
          return;
        }
      }
      if (!event.data || typeof event.data !== 'object') return;
      const data = event.data as {
        source?: unknown;
        type?: unknown;
        requestId?: unknown;
        ok?: unknown;
      };
      if (data.source !== UPBIT_FRAME_MESSAGE_SOURCE
        || data.type !== 'set-timeframe-result' || data.requestId !== requestId
        || data.ok !== true) return;
      window.clearTimeout(timeout);
      window.removeEventListener('message', listener);
      resolve(true);
    };
    window.addEventListener('message', listener);
    const message = {
      source: UPBIT_TOP_MESSAGE_SOURCE,
      type: 'set-timeframe',
      requestId,
      timeframe: target,
    };
    for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe')) {
      frame.contentWindow?.postMessage(message, '*');
    }
  });
}

function visibleFrameArea(frame: HTMLIFrameElement): number {
  const rect = frame.getBoundingClientRect();
  const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
  const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
  if (width === 0 || height === 0) return 0;
  const style = getComputedStyle(frame);
  return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0'
    ? 0 : width * height;
}

function directFrameForSource(source: MessageEventSource | null): HTMLIFrameElement | undefined {
  if (!source) return undefined;
  return [...document.querySelectorAll<HTMLIFrameElement>('iframe')]
    .find(frame => frame.contentWindow === source);
}

export function chooseUpbitFrameTimeframe(
  candidates: UpbitFrameTimeframeCandidate[],
  now = Date.now(),
): string | undefined {
  return candidates
    .filter(candidate => now - candidate.receivedAt <= FRAME_TIMEFRAME_TTL_MS)
    .filter(candidate => candidate.documentVisible)
    .filter(candidate => !candidate.frameElement
      || (candidate.frameElement.isConnected && visibleFrameArea(candidate.frameElement) > 0))
    .sort((left, right) => {
      const leftDirect = left.frameElement ? 1 : 0;
      const rightDirect = right.frameElement ? 1 : 0;
      return rightDirect - leftDirect
        || right.frameArea - left.frameArea
        || right.confidence - left.confidence
        || right.receivedAt - left.receivedAt;
    })[0]?.timeframe;
}

export function installUpbitFrameTimeframeReceiver() {
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source === window) return;
    if (event.origin && event.origin !== 'null') {
      try {
        if (!/(^|\.)(?:upbit|tradingview)\.com$/i.test(new URL(event.origin).hostname)) return;
      } catch {
        return;
      }
    }
    if (!event.data || typeof event.data !== 'object') return;
    const data = event.data as {
      source?: unknown;
      type?: unknown;
      timeframe?: unknown;
      evidence?: unknown;
      confidence?: unknown;
      documentVisible?: unknown;
      viewportWidth?: unknown;
      viewportHeight?: unknown;
    };
    if (data.source !== UPBIT_FRAME_MESSAGE_SOURCE
      || (data.type !== undefined && data.type !== 'timeframe')
      || typeof data.timeframe !== 'string') return;
    const timeframe = normalizeUpbitTimeframe(data.timeframe);
    if (!timeframe) return;
    if (!event.source) return;
    const frameElement = directFrameForSource(event.source);
    const frameArea = frameElement
      ? visibleFrameArea(frameElement)
      : Math.max(0, Number(data.viewportWidth) || 0) * Math.max(0, Number(data.viewportHeight) || 0);
    // Ignore direct child frames that are hidden or retained as an inactive
    // chart. They may keep broadcasting an old interval after chart switches.
    if (frameElement && frameArea === 0) return;
    const evidence: UpbitFrameTimeframeEvidence = data.evidence === 'toolbar'
      || data.evidence === 'legend' || data.evidence === 'selected-control'
      ? data.evidence : 'selected-control';
    const confidence = Number.isFinite(data.confidence)
      ? Math.max(0, Math.min(100, Number(data.confidence))) : 50;
    frameTimeframeCandidates.set(event.source, {
      timeframe,
      evidence,
      confidence,
      receivedAt: Date.now(),
      frameElement,
      frameArea,
      documentVisible: data.documentVisible !== false,
    });
    const selected = currentUpbitFrameTimeframe();
    if (selected !== lastSelectedFrameTimeframe) {
      lastSelectedFrameTimeframe = selected;
      window.dispatchEvent(new CustomEvent('chartviz:context-changed'));
    }
  });
}

export function currentUpbitFrameTimeframe(): string | undefined {
  const now = Date.now();
  for (const [source, candidate] of frameTimeframeCandidates) {
    if (now - candidate.receivedAt > FRAME_TIMEFRAME_TTL_MS
      || (candidate.frameElement && !candidate.frameElement.isConnected)) {
      frameTimeframeCandidates.delete(source);
    }
  }
  return chooseUpbitFrameTimeframe([...frameTimeframeCandidates.values()], now);
}
