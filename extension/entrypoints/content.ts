import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { mountFloatingPanel } from '../src/capture/mount-floating-panel';
import type { ChartContext } from '../src/domain/chart-context';
import type {
  ChartContextResponse,
  PanelResponse,
  SupportedCaptureTimeframe,
} from '../src/domain/chart-messages';
import { collectActiveChartContext, waitForActiveChartReady } from '../src/sites/collect-context';
import { setActiveChartTimeframe } from '../src/sites/set-timeframe';
import { supportedContentMatches } from '../src/sites/supported-sites';
import { installUpbitFrameTimeframeReceiver } from '../src/sites/upbit/frame-timeframe';

const PANEL_ID = 'chartviz-community-panel';

export type ContentPanel = {
  isVisible(): boolean;
  setVisible(visible: boolean): PanelResponse;
  notifyContextChanged(): void;
};

export type ContentHandlerDependencies = {
  panel: ContentPanel;
  collectContext(): Promise<ChartContext>;
  waitForReady(): Promise<ChartContext>;
  setTimeframe?(timeframe: SupportedCaptureTimeframe): Promise<void>;
};

export type PanelLaunchRequest = Readonly<{
  open: boolean;
  language: 'en' | 'zh-CN' | null;
}>;

export function parsePanelLaunchRequest(value: string): PanelLaunchRequest {
  try {
    const url = new URL(value);
    const requestedLanguage = url.searchParams.get('chartvizLanguage');
    return {
      open: url.searchParams.get('chartviz') === 'open',
      language: requestedLanguage === 'en' || requestedLanguage === 'zh-CN'
        ? requestedLanguage
        : null,
    };
  } catch {
    return { open: false, language: null };
  }
}

function isSupportedCaptureTimeframe(value: unknown): value is SupportedCaptureTimeframe {
  return value === '5m' || value === '15m' || value === '1h' || value === '4h' || value === '1d';
}

function publicError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function createContentMessageHandler(dependencies: ContentHandlerDependencies) {
  return function onMessage(
    message: unknown,
  ): Promise<ChartContextResponse | PanelResponse> | undefined {
    if (!message || typeof message !== 'object') return undefined;
    const record = message as Record<string, unknown>;
    if (record.type === 'chartviz/context/get' && Object.keys(record).length === 1) {
      return dependencies.collectContext()
        .then((context) => ({ ok: true, context }) as const)
        .catch((error) => ({ ok: false, error: publicError(error, 'Unable to inspect chart.') }) as const);
    }
    if (record.type === 'chartviz/chart/ready' && Object.keys(record).length === 1) {
      return dependencies.waitForReady()
        .then((context) => ({ ok: true, context }) as const)
        .catch((error) => ({ ok: false, error: publicError(error, 'The chart is still loading.') }) as const);
    }
    if (
      record.type === 'chartviz/chart/timeframe'
      && isSupportedCaptureTimeframe(record.timeframe)
      && Object.keys(record).sort().join('\0') === 'timeframe\0type'
    ) {
      const setTimeframe = dependencies.setTimeframe ?? setActiveChartTimeframe;
      return setTimeframe(record.timeframe)
        .then(() => dependencies.collectContext())
        .then((context) => ({ ok: true, context }) as const)
        .catch((error) => ({ ok: false, error: publicError(error, 'Unable to switch timeframe.') }) as const);
    }
    if (record.type === 'chartviz/panel/toggle' && Object.keys(record).length === 1) {
      return Promise.resolve(dependencies.panel.setVisible(!dependencies.panel.isVisible()));
    }
    if (
      record.type === 'chartviz/panel/visibility'
      && typeof record.visible === 'boolean'
      && Object.keys(record).sort().join('\0') === 'type\0visible'
    ) {
      return Promise.resolve(dependencies.panel.setVisible(record.visible));
    }
    return undefined;
  };
}

export function createContentPanel(panelUrl: string): ContentPanel {
  let ownedPanel: HTMLElement | null = null;

  function element(): HTMLElement | null {
    if (ownedPanel?.isConnected) return ownedPanel;
    ownedPanel = null;
    return null;
  }
  function ensure(): HTMLElement {
    const existing = element();
    if (existing) return existing;
    const stale = document.getElementById(PANEL_ID) as (HTMLElement & { __chartvizCleanup?: () => void }) | null;
    stale?.__chartvizCleanup?.();
    stale?.remove();
    mountFloatingPanel(panelUrl);
    const mounted = element();
    if (mounted) return mounted;
    ownedPanel = document.getElementById(PANEL_ID);
    if (!ownedPanel) throw new Error('Unable to mount the ChartViz panel.');
    return ownedPanel;
  }
  return {
    isVisible() {
      const panel = element();
      return Boolean(panel && panel.style.display !== 'none' && panel.style.visibility !== 'hidden');
    },
    setVisible(visible) {
      const panel = visible ? ensure() : element();
      if (panel) {
        panel.style.display = visible ? 'block' : 'none';
        panel.style.visibility = 'visible';
      }
      return { ok: true, visible };
    },
    notifyContextChanged() {
      const frame = element()?.querySelector<HTMLIFrameElement>('iframe');
      frame?.contentWindow?.postMessage({ source: 'chartviz-page', type: 'context-changed' }, '*');
    },
  };
}

export default defineContentScript({
  matches: [...supportedContentMatches],
  async main() {
    if (/(^|\.)upbit\.com$/i.test(location.hostname)) {
      installUpbitFrameTimeframeReceiver();
    }
    const launchRequest = parsePanelLaunchRequest(location.href);
    if (launchRequest.language) {
      await browser.storage.local.set({ 'chartviz:language': launchRequest.language });
    }
    const panel = createContentPanel(browser.runtime.getURL('/panel.html'));
    if (launchRequest.open) panel.setVisible(true);
    const onMessage = createContentMessageHandler({
      panel,
      collectContext: collectActiveChartContext,
      waitForReady: waitForActiveChartReady,
    });
    browser.runtime.onMessage.addListener(onMessage);

    let pageUrl = location.href;
    window.setInterval(() => {
      if (location.href === pageUrl) return;
      pageUrl = location.href;
      panel.notifyContextChanged();
    }, 500);
  },
});
