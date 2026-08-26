import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { mountFloatingPanel } from '../src/capture/mount-floating-panel';
import type { CaptureReply } from '../src/capture/tradingview-capture';

type ScriptInjection = {
  target: { tabId: number };
  func: typeof mountFloatingPanel;
  args: [string];
};

export type BackgroundDependencies = {
  captureVisibleTab(): Promise<string>;
  executeScript(injection: ScriptInjection): Promise<unknown>;
  getPanelUrl(): string;
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
  return {
    async onMessage(message: unknown): Promise<CaptureReply | undefined> {
      if (!isCaptureCommand(message)) {
        return undefined;
      }
      try {
        return { ok: true, dataUrl: await dependencies.captureVisibleTab() };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Visible-tab capture failed',
        };
      }
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
    captureVisibleTab: () => browser.tabs.captureVisibleTab({ format: 'png' }),
    executeScript: (injection) => browser.scripting.executeScript(injection),
    getPanelUrl: () => browser.runtime.getURL('/panel.html'),
  });

  browser.runtime.onMessage.addListener(handlers.onMessage);
  browser.action.onClicked.addListener(handlers.onActionClicked);
});
