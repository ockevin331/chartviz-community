import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { mountFloatingPanel } from '../src/capture/mount-floating-panel';
import {
  isTradingViewChartUrl,
  type CaptureReply,
} from '../src/capture/tradingview-capture';

type ScriptInjection = {
  target: { tabId: number };
  func: typeof mountFloatingPanel;
  args: [string];
};

export type BackgroundDependencies = {
  captureVisibleTab(windowId: number): Promise<string>;
  executeScript(injection: ScriptInjection): Promise<unknown>;
  getPanelUrl(): string;
};

type CaptureSender = {
  tab?: {
    id?: number;
    windowId?: number;
    url?: string;
  };
};

function isCaptureCommand(message: unknown): message is { type: 'capture-visible-tab' } {
  if (!message || typeof message !== 'object') {
    return false;
  }
  const record = message as Record<string, unknown>;
  return record.type === 'capture-visible-tab'
    && Object.keys(record).length === 1;
}

export function createBackgroundHandlers(dependencies: BackgroundDependencies) {
  async function captureFromSender(sender: CaptureSender | undefined): Promise<CaptureReply> {
    const tab = sender?.tab;
    if (
      !tab
      || !Number.isInteger(tab.id)
      || !Number.isInteger(tab.windowId)
      || typeof tab.windowId !== 'number'
      || typeof tab.url !== 'string'
      || !isTradingViewChartUrl(tab.url)
    ) {
      return {
        ok: false,
        error: 'Capture is available only from a TradingView chart tab',
      };
    }

    try {
      return { ok: true, dataUrl: await dependencies.captureVisibleTab(tab.windowId) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Visible-tab capture failed',
      };
    }
  }

  return {
    onMessage(
      message: unknown,
      sender?: CaptureSender,
    ): Promise<CaptureReply> | undefined {
      if (!isCaptureCommand(message)) {
        return undefined;
      }
      return captureFromSender(sender);
    },
    async onActionClicked(tab: { id?: number }): Promise<void> {
      if (typeof tab.id !== 'number') {
        return;
      }
      await dependencies.executeScript({
        target: { tabId: tab.id },
        func: mountFloatingPanel,
        args: [dependencies.getPanelUrl()],
      });
    },
  };
}

export default defineBackground(() => {
  const handlers = createBackgroundHandlers({
    captureVisibleTab: (windowId) => browser.tabs.captureVisibleTab(windowId, { format: 'png' }),
    executeScript: (injection) => browser.scripting.executeScript(injection),
    getPanelUrl: () => browser.runtime.getURL('/panel.html'),
  });

  browser.runtime.onMessage.addListener(handlers.onMessage);
  browser.action.onClicked.addListener(handlers.onActionClicked);
});
