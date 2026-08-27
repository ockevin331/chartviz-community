import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { ChartContext } from '../src/domain/chart-context';
import type {
  BackgroundMessage,
  CaptureResponse,
  ChartFailure,
  ChartContextResponse,
  ContentMessage,
  PanelResponse,
  SupportedCaptureTimeframe,
} from '../src/domain/chart-messages';
import { blobToDataUrl, cropScreenshot } from '../src/platform/capture/crop';
import {
  classifyChartAvailability,
  findSupportedSiteByChartUrl,
  type ChartAvailabilityFailure,
} from '../src/sites/supported-sites';

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
  const keys = Object.keys(record).sort().join('\0');
  if (record.type === 'chartviz/active-chart/inspect') return keys === 'type';
  if (record.type !== 'chartviz/active-chart/capture') return false;
  return keys === 'type' || (keys === 'timeframes\0type' && Array.isArray(record.timeframes));
}

const SUPPORTED_CAPTURE_TIMEFRAMES = new Set<SupportedCaptureTimeframe>(['5m', '15m', '1h', '4h', '1d']);

function validatedTimeframes(
  values: readonly unknown[] | undefined,
): SupportedCaptureTimeframe[] | ChartFailure | null {
  if (values === undefined) return null;
  if (values.length < 1 || values.length > 3) {
    return { ok: false, error: 'Choose between one and three timeframes.' };
  }
  if (!values.every((value): value is SupportedCaptureTimeframe =>
    typeof value === 'string' && SUPPORTED_CAPTURE_TIMEFRAMES.has(value as SupportedCaptureTimeframe))) {
    return { ok: false, error: 'One or more requested timeframes are not supported.' };
  }
  if (new Set(values).size !== values.length) {
    return { ok: false, error: 'Each requested timeframe must be different.' };
  }
  return [...values];
}

function publicError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function availabilityMessage(failure: ChartAvailabilityFailure): string {
  return failure.code === 'unsupported_site'
    ? 'This site is not supported.'
    : 'This page is not a supported chart URL.';
}

export function createBackgroundHandlers(dependencies: BackgroundDependencies) {
  async function activeTab(): Promise<ActiveTab> {
    const tab = await dependencies.getActiveTab();
    if (!tab || !Number.isInteger(tab.id) || !Number.isInteger(tab.windowId)) {
      throw new Error('No active browser tab is available.');
    }
    return tab;
  }

  async function supportedActiveTab(): Promise<ActiveTab | ChartFailure> {
    const tab = await activeTab();
    const availability = classifyChartAvailability(tab.url ?? '');
    return availability
      ? { ok: false, error: availabilityMessage(availability), availability }
      : tab;
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
      if ('ok' in tab) return tab;
      return await readyActiveChart(tab.id);
    } catch (error) {
      return { ok: false, error: publicError(error, 'Unable to inspect the active chart.') };
    }
  }

  async function captureVisibleChart(tab: ActiveTab, context: ChartContext): Promise<Extract<CaptureResponse, { ok: true }>> {
    await dependencies.sendTabMessage(tab.id, {
      type: 'chartviz/panel/visibility',
      visible: false,
    });
    await dependencies.wait(80);

    let croppedImage: Blob;
    try {
      const screenshot = await dependencies.captureVisibleTab(tab.windowId);
      croppedImage = await dependencies.cropScreenshot(screenshot, context);
    } finally {
      await dependencies.sendTabMessage(tab.id, {
        type: 'chartviz/panel/visibility',
        visible: true,
      }).catch(() => undefined);
    }

    return {
      ok: true,
      context,
      previewDataUrl: await dependencies.blobToDataUrl(croppedImage),
    };
  }

  async function captureActiveChart(requested?: readonly unknown[]): Promise<CaptureResponse> {
    const timeframes = validatedTimeframes(requested);
    if (timeframes && 'ok' in timeframes) return timeframes;
    try {
      const tab = await supportedActiveTab();
      if ('ok' in tab) return tab;
      const ready = await readyActiveChart(tab.id);
      if (!ready.ok) return ready;
      if (!timeframes) return await captureVisibleChart(tab, ready.context);

      if (findSupportedSiteByChartUrl(tab.url ?? '')?.multiTimeframe !== true) {
        return { ok: false, error: 'Multi-timeframe capture is not supported on this site.' };
      }

      const originalTimeframe = ready.context.timeframe?.toLowerCase();
      const original = SUPPORTED_CAPTURE_TIMEFRAMES.has(originalTimeframe as SupportedCaptureTimeframe)
        ? originalTimeframe as SupportedCaptureTimeframe
        : null;
      let currentTimeframe = original;
      const captures: NonNullable<Extract<CaptureResponse, { ok: true }>['captures']> = [];
      try {
        for (const timeframe of timeframes) {
          currentTimeframe = timeframe;
          const switched = await dependencies.sendTabMessage(tab.id, {
            type: 'chartviz/chart/timeframe',
            timeframe,
          }) as ChartContextResponse | null | undefined;
          if (!switched?.ok) {
            return { ok: false, error: switched?.error ?? `Unable to switch to ${timeframe}.` };
          }
          const settled = await readyActiveChart(tab.id);
          if (!settled.ok) return settled;
          if (settled.context.timeframe?.toLowerCase() !== timeframe) {
            return { ok: false, error: `The chart did not finish loading the ${timeframe} timeframe.` };
          }
          const captured = await captureVisibleChart(tab, settled.context);
          captures.push({
            timeframe,
            context: captured.context,
            previewDataUrl: captured.previewDataUrl,
          });
        }
        const first = captures[0]!;
        return {
          ok: true,
          context: first.context,
          previewDataUrl: first.previewDataUrl,
          captures,
        };
      } finally {
        if (original && original !== currentTimeframe) {
          await dependencies.sendTabMessage(tab.id, {
            type: 'chartviz/chart/timeframe',
            timeframe: original,
          }).catch(() => undefined);
        }
      }
    } catch (error) {
      return { ok: false, error: publicError(error, 'Visible chart capture failed.') };
    }
  }

  return {
    onMessage(message: unknown): Promise<ChartContextResponse | CaptureResponse> | undefined {
      if (!isExactBackgroundMessage(message)) return undefined;
      return message.type === 'chartviz/active-chart/inspect'
        ? inspectActiveChart()
        : captureActiveChart(message.timeframes);
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
