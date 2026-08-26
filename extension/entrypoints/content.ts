import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { mountFloatingPanel } from '../src/capture/mount-floating-panel';
import type { ChartContext } from '../src/domain/chart-context';
import type {
  ChartContextResponse,
  PanelResponse,
} from '../src/domain/chart-messages';
import { collectActiveChartContext, waitForActiveChartReady } from '../src/sites/collect-context';
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
};

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
  function element(): HTMLElement | null {
    return document.getElementById(PANEL_ID);
  }
  function ensure(): HTMLElement {
    const existing = element();
    if (existing) return existing;
    mountFloatingPanel(panelUrl);
    const mounted = element();
    if (!mounted) throw new Error('Unable to mount the ChartViz panel.');
    return mounted;
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
    const panel = createContentPanel(browser.runtime.getURL('/panel.html'));
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
