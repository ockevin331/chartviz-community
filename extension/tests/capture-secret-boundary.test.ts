import { describe, expect, it, vi } from 'vitest';
import { createBackgroundHandlers } from '../entrypoints/background';
import { mountFloatingPanel } from '../src/capture/mount-floating-panel';
import { createPanelVisibility } from '../src/capture/panel-visibility';

const tradingViewSender = {
  tab: {
    id: 42,
    windowId: 17,
    url: 'https://www.tradingview.com/chart/ABC123/',
  },
};

describe('capture background boundary', () => {
  it('returns a Promise only for the exact capture command and captures its sender window', async () => {
    const captureVisibleTab = vi.fn(async () => 'data:image/png;base64,Y2FwdHVyZWQ=');
    const handlers = createBackgroundHandlers({
      captureVisibleTab,
      executeScript: vi.fn(async () => undefined),
      getPanelUrl: () => 'chrome-extension://fixture/panel.html',
    });

    const reply = handlers.onMessage({ type: 'capture-visible-tab' }, tradingViewSender);

    expect(reply).toBeInstanceOf(Promise);
    await expect(reply).resolves.toEqual({
      ok: true,
      dataUrl: 'data:image/png;base64,Y2FwdHVyZWQ=',
    });
    expect(captureVisibleTab).toHaveBeenCalledExactlyOnceWith(17);
  });

  it('returns undefined synchronously for non-capture messages', () => {
    const captureVisibleTab = vi.fn(async () => 'data:image/png;base64,Y2FwdHVyZWQ=');
    const handlers = createBackgroundHandlers({
      captureVisibleTab,
      executeScript: vi.fn(async () => undefined),
      getPanelUrl: () => 'chrome-extension://fixture/panel.html',
    });

    const reply = handlers.onMessage({ type: 'other-extension-message' }, tradingViewSender);

    expect(reply).toBeUndefined();
    expect(captureVisibleTab).not.toHaveBeenCalled();
  });

  it.each(['provider', 'apiKey', 'key', 'prompt', 'model', 'response'])(
    'rejects a capture message carrying forbidden %s data',
    async (field) => {
      const captureVisibleTab = vi.fn(async () => 'data:image/png;base64,Y2FwdHVyZWQ=');
      const handlers = createBackgroundHandlers({
        captureVisibleTab,
        executeScript: vi.fn(async () => undefined),
        getPanelUrl: () => 'chrome-extension://fixture/panel.html',
      });

      const reply = handlers.onMessage(
        { type: 'capture-visible-tab', [field]: 'secret' },
        tradingViewSender,
      );

      expect(reply).toBeUndefined();
      expect(captureVisibleTab).not.toHaveBeenCalled();
    },
  );

  it('returns a bounded failure reply instead of throwing capture errors', async () => {
    const handlers = createBackgroundHandlers({
      captureVisibleTab: vi.fn(async () => { throw new Error('capture denied'); }),
      executeScript: vi.fn(async () => undefined),
      getPanelUrl: () => 'chrome-extension://fixture/panel.html',
    });

    await expect(handlers.onMessage({ type: 'capture-visible-tab' }, tradingViewSender)).resolves.toEqual({
      ok: false,
      error: 'capture denied',
    });
  });

  it.each([
    ['missing sender', undefined],
    ['missing tab', {}],
    ['missing tab id', { tab: { windowId: 17, url: tradingViewSender.tab.url } }],
    ['missing window id', { tab: { id: 42, url: tradingViewSender.tab.url } }],
    ['non-integer window id', { tab: { id: 42, windowId: 1.5, url: tradingViewSender.tab.url } }],
    ['non-TradingView URL', { tab: { id: 42, windowId: 17, url: 'https://example.com/chart/ABC/' } }],
    ['non-chart TradingView URL', { tab: { id: 42, windowId: 17, url: 'https://www.tradingview.com/markets/' } }],
  ])('rejects a capture command from an invalid sender: %s', async (_label, sender) => {
    const captureVisibleTab = vi.fn(async () => 'data:image/png;base64,Y2FwdHVyZWQ=');
    const handlers = createBackgroundHandlers({
      captureVisibleTab,
      executeScript: vi.fn(async () => undefined),
      getPanelUrl: () => 'chrome-extension://fixture/panel.html',
    });

    await expect(handlers.onMessage({ type: 'capture-visible-tab' }, sender)).resolves.toEqual({
      ok: false,
      error: 'Capture is available only from a TradingView chart tab',
    });
    expect(captureVisibleTab).not.toHaveBeenCalled();
  });

  it('injects the self-contained floating panel on an action click with an active tab', async () => {
    const executeScript = vi.fn(async () => undefined);
    const handlers = createBackgroundHandlers({
      captureVisibleTab: vi.fn(async () => ''),
      executeScript,
      getPanelUrl: () => 'chrome-extension://fixture/panel.html',
    });

    await handlers.onActionClicked({ id: 42 });

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      func: mountFloatingPanel,
      args: ['chrome-extension://fixture/panel.html'],
    });
  });

  it('does not inject without an active tab id', async () => {
    const executeScript = vi.fn(async () => undefined);
    const handlers = createBackgroundHandlers({
      captureVisibleTab: vi.fn(async () => ''),
      executeScript,
      getPanelUrl: () => 'chrome-extension://fixture/panel.html',
    });

    await handlers.onActionClicked({});

    expect(executeScript).not.toHaveBeenCalled();
  });

  it('mounts an extension-origin iframe with a working close control', () => {
    const elements = new Map<string, FakeElement>();
    class FakeElement {
      id = '';
      style: Record<string, string> = {};
      children: FakeElement[] = [];
      listeners = new Map<string, () => void>();
      parent: FakeElement | null = null;
      src = '';
      title = '';
      type = '';
      textContent = '';

      append(...children: FakeElement[]) {
        children.forEach((child) => {
          child.parent = this;
          this.children.push(child);
          if (child.id) elements.set(child.id, child);
        });
      }

      addEventListener(type: string, listener: () => void) {
        this.listeners.set(type, listener);
      }

      remove() {
        if (this.id) elements.delete(this.id);
        if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
      }

      setAttribute() {}
    }

    const root = new FakeElement();
    const documentFixture = {
      createElement: () => new FakeElement(),
      documentElement: root,
      getElementById: (id: string) => elements.get(id) ?? null,
    };
    const addWindowListener = vi.fn();
    const removeWindowListener = vi.fn();
    vi.stubGlobal('document', documentFixture);
    vi.stubGlobal('window', {
      addEventListener: addWindowListener,
      removeEventListener: removeWindowListener,
    });

    try {
      mountFloatingPanel('chrome-extension://fixture/panel.html');

      const host = elements.get('chartviz-community-panel');
      expect(host).toBeDefined();
      expect(host?.children[0]).toMatchObject({
        src: 'chrome-extension://fixture/panel.html',
        title: 'ChartViz Community',
      });
      host?.children[1]?.listeners.get('click')?.();
      expect(elements.has('chartviz-community-panel')).toBe(false);
      expect(removeWindowListener).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('waits for the page host to acknowledge hide and restore requests', async () => {
    const listeners = new Set<(event: MessageEvent) => void>();
    const parent = {
      postMessage: vi.fn((message: { requestId: number }) => {
        listeners.forEach((listener) => listener({
          data: { type: 'chartviz-panel-visibility-ack', requestId: message.requestId },
          source: parent,
        } as unknown as MessageEvent));
      }),
    };
    const panelWindow = {
      parent,
      addEventListener: (_type: string, listener: (event: MessageEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => {
        listeners.delete(listener);
      },
    } as unknown as Window;
    const visibility = createPanelVisibility(panelWindow);

    await visibility.hidePanel();
    await visibility.restorePanel();

    expect(parent.postMessage).toHaveBeenNthCalledWith(1, {
      type: 'chartviz-panel-visibility',
      requestId: 1,
      visible: false,
    }, '*');
    expect(parent.postMessage).toHaveBeenNthCalledWith(2, {
      type: 'chartviz-panel-visibility',
      requestId: 2,
      visible: true,
    }, '*');
    expect(listeners.size).toBe(0);
  });
});
