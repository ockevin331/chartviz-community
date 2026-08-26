import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountFloatingPanel } from '../src/capture/mount-floating-panel';
import { createPanelVisibility } from '../src/capture/panel-visibility';

function createPanelWindow(acknowledge = false) {
  const listeners = new Set<(event: MessageEvent) => void>();
  const parent = {
    postMessage: vi.fn((message: { requestId: number }) => {
      if (acknowledge) {
        listeners.forEach((listener) => listener({
          data: { type: 'chartviz-panel-visibility-ack', requestId: message.requestId },
          source: parent,
        } as unknown as MessageEvent));
      }
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
  return { listeners, panelWindow, parent };
}

async function observeSettlement(promise: Promise<void>) {
  const state: { settled: boolean; error?: unknown } = { settled: false };
  void promise.then(
    () => { state.settled = true; },
    (error: unknown) => {
      state.settled = true;
      state.error = error;
    },
  );
  await Promise.resolve();
  return state;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('panel visibility lifecycle', () => {
  it.each([
    ['hide', (visibility: ReturnType<typeof createPanelVisibility>) => visibility.hidePanel()],
    ['restore', (visibility: ReturnType<typeof createPanelVisibility>) => visibility.restorePanel()],
  ])('settles a lost %s acknowledgement within the configured timeout and cleans up', async (_name, request) => {
    vi.useFakeTimers();
    const { listeners, panelWindow } = createPanelWindow();
    const visibility = createPanelVisibility(panelWindow, { acknowledgementTimeoutMs: 100 });
    const state = await observeSettlement(request(visibility));

    await vi.advanceTimersByTimeAsync(100);

    expect(state.settled).toBe(true);
    expect(state.error).toMatchObject({ message: 'Panel visibility acknowledgement timed out' });
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a pending hide request with AbortSignal and cleans up its timeout/listener', async () => {
    vi.useFakeTimers();
    const { listeners, panelWindow } = createPanelWindow();
    const visibility = createPanelVisibility(panelWindow, { acknowledgementTimeoutMs: 100 });
    const controller = new AbortController();
    const state = await observeSettlement(visibility.hidePanel(controller.signal));

    controller.abort(new DOMException('Capture cancelled', 'AbortError'));
    await Promise.resolve();

    expect(state.settled).toBe(true);
    expect(state.error).toMatchObject({ name: 'AbortError' });
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('acknowledges a request before timeout and removes all pending work', async () => {
    vi.useFakeTimers();
    const { listeners, panelWindow } = createPanelWindow(true);
    const visibility = createPanelVisibility(panelWindow, { acknowledgementTimeoutMs: 100 });

    await expect(visibility.hidePanel(new AbortController().signal)).resolves.toBeUndefined();

    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('automatically restores a hidden host if no restore message arrives', async () => {
    vi.useFakeTimers();
    const elements = new Map<string, FakeElement>();
    let messageListener: ((event: MessageEvent) => void) | undefined;

    class FakeElement {
      id = '';
      style: Record<string, string> = {};
      children: FakeElement[] = [];
      contentWindow: { postMessage: ReturnType<typeof vi.fn> } | null = null;
      src = '';
      title = '';
      type = '';
      textContent = '';

      constructor(readonly tagName: string) {
        if (tagName === 'iframe') {
          this.contentWindow = { postMessage: vi.fn() };
        }
      }

      append(...children: FakeElement[]) {
        this.children.push(...children);
        children.forEach((child) => {
          if (child.id) elements.set(child.id, child);
        });
      }

      addEventListener() {}
      remove() { if (this.id) elements.delete(this.id); }
      setAttribute() {}
    }

    const root = new FakeElement('html');
    vi.stubGlobal('document', {
      createElement: (tagName: string) => new FakeElement(tagName),
      documentElement: root,
      getElementById: (id: string) => elements.get(id) ?? null,
    });
    vi.stubGlobal('window', {
      addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
        if (type === 'message') messageListener = listener;
      },
      clearTimeout,
      removeEventListener: vi.fn(),
      setTimeout,
    });
    const panelUrl = 'chrome-extension://fixture/panel.html';
    mountFloatingPanel(panelUrl);
    const host = elements.get('chartviz-community-panel');
    const iframe = host?.children[0];

    messageListener?.({
      data: { type: 'chartviz-panel-visibility', requestId: 1, visible: false },
      origin: new URL(panelUrl).origin,
      source: iframe?.contentWindow,
    } as unknown as MessageEvent);
    expect(host?.style.visibility).toBe('hidden');

    await vi.advanceTimersByTimeAsync(10_000);

    expect(host?.style.visibility).toBe('visible');
  });
});
