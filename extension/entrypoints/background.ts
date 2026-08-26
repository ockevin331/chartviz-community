import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { ChartContext } from '../src/domain/chart-context';
import type {
  BackgroundMessage,
  CaptureResponse,
  ChartContextResponse,
  ContentMessage,
  PanelResponse,
} from '../src/domain/chart-messages';
import { blobToDataUrl, cropScreenshot } from '../src/platform/capture/crop';
import { isSupportedChartHost, UNSUPPORTED_CHART_URL_ERROR } from '../src/sites/supported-sites';

export type ActiveTab = {
  id: number;
  windowId: number;
  url?: string;
};

export type BackgroundDependencies = {
  getActiveTab(): Promise<ActiveTab | null>;
  sendTabMessage(tabId: number, message: ContentMessage): Promise<unknown>;
  captureVisibleTab(windowId: number): Promise<string>;
  cropScreenshot(screenshotDataUrl: string, context: ChartContext): Promise<Blob>;
  blobToDataUrl(blob: Blob): Promise<string>;
  injectContentScript(tabId: number): Promise<void>;
  wait(milliseconds: number): Promise<void>;
};

function isExactBackgroundMessage(message: unknown): message is BackgroundMessage {
  if (!message || typeof message !== 'object') return false;
  const record = message as Record<string, unknown>;
  return Object.keys(record).length === 1
    && (record.type === 'chartviz/active-chart/inspect'
      || record.type === 'chartviz/active-chart/capture');
}

function publicError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function createBackgroundHandlers(dependencies: BackgroundDependencies) {
  async function activeTab(): Promise<ActiveTab> {
    const tab = await dependencies.getActiveTab();
    if (!tab || !Number.isInteger(tab.id) || !Number.isInteger(tab.windowId)) {
      throw new Error('No active browser tab is available.');
    }
    return tab;
  }

  async function supportedActiveTab(): Promise<ActiveTab> {
    const tab = await activeTab();
    if (!tab.url || !isSupportedChartHost(tab.url)) throw new Error(UNSUPPORTED_CHART_URL_ERROR);
    return tab;
  }

  async function readyActiveChart(tabId: number): Promise<ChartContextResponse> {
    try {
      const response = await dependencies.sendTabMessage(tabId, { type: 'chartviz/chart/ready' });
      if (response && typeof response === 'object' && 'ok' in response) {
        return response as ChartContextResponse;
      }
      return { ok: false, error: 'ChartViz did not receive a chart readiness response.' };
    } catch (error) {
      return {
        ok: false,
        error: publicError(error, 'ChartViz is not connected to this page.'),
      };
    }
  }

  async function inspectActiveChart(): Promise<ChartContextResponse> {
    try {
      const tab = await supportedActiveTab();
      return await readyActiveChart(tab.id);
    } catch (error) {
      return { ok: false, error: publicError(error, 'Unable to inspect the active chart.') };
    }
  }

  async function captureActiveChart(): Promise<CaptureResponse> {
    try {
      const tab = await supportedActiveTab();
      const ready = await readyActiveChart(tab.id);
      if (!ready.ok) return ready;

      await dependencies.sendTabMessage(tab.id, {
        type: 'chartviz/panel/visibility',
        visible: false,
      });
      await dependencies.wait(80);

      let croppedImage: Blob;
      try {
        const screenshot = await dependencies.captureVisibleTab(tab.windowId);
        croppedImage = await dependencies.cropScreenshot(screenshot, ready.context);
      } finally {
        await dependencies.sendTabMessage(tab.id, {
          type: 'chartviz/panel/visibility',
          visible: true,
        }).catch(() => undefined);
      }

      return {
        ok: true,
        context: ready.context,
        previewDataUrl: await dependencies.blobToDataUrl(croppedImage),
      };
    } catch (error) {
      return { ok: false, error: publicError(error, 'Visible chart capture failed.') };
    }
  }

  return {
    onMessage(message: unknown): Promise<ChartContextResponse | CaptureResponse> | undefined {
      if (!isExactBackgroundMessage(message)) return undefined;
      return message.type === 'chartviz/active-chart/inspect'
        ? inspectActiveChart()
        : captureActiveChart();
    },
    async onActionClicked(tab: { id?: number }): Promise<void> {
      if (!Number.isInteger(tab.id) || typeof tab.id !== 'number') return;
      const toggle = { type: 'chartviz/panel/toggle' } as const;
      try {
        const response = await dependencies.sendTabMessage(tab.id, toggle) as PanelResponse | null | undefined;
        if (response) return;
      } catch {
        // A tab opened before installation has no receiver until the script is injected.
      }
      try {
        await dependencies.injectContentScript(tab.id);
        await dependencies.sendTabMessage(tab.id, toggle);
      } catch {
        // Restricted browser pages cannot host extension content scripts.
      }
    },
  };
}

export default defineBackground(() => {
  const handlers = createBackgroundHandlers({
    async getActiveTab() {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      return typeof tab?.id === 'number' && typeof tab.windowId === 'number'
        ? { id: tab.id, windowId: tab.windowId, url: tab.url }
        : null;
    },
    sendTabMessage: (tabId, message) => browser.tabs.sendMessage(tabId, message),
    captureVisibleTab: (windowId) => browser.tabs.captureVisibleTab(windowId, { format: 'png' }),
    cropScreenshot,
    blobToDataUrl,
    injectContentScript: async (tabId) => {
      await browser.scripting.executeScript({
        target: { tabId },
        files: ['/content-scripts/content.js'],
      });
    },
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  });

  browser.runtime.onMessage.addListener(handlers.onMessage);
  browser.action.onClicked.addListener(handlers.onActionClicked);
});
