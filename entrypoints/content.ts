import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  ChartContextResponse,
  ContentMessage,
  PanelResponse,
  SetChartTimeframeMessage,
} from '../src/domain/messages';
import { collectActiveChartContext, waitForActiveChartReady } from '../src/sites/collect-context';
import { setActiveChartTimeframe } from '../src/sites/set-timeframe';
import { installUpbitFrameTimeframeReceiver } from '../src/sites/upbit/frame-timeframe';
import App, { type PanelBridge } from './floating-panel/App';
import ErrorBoundary from './floating-panel/ErrorBoundary';
import './floating-panel/style.css';

export default defineContentScript({
  matches: ['https://*.tradingview.com/chart/*', 'https://*.binance.com/*/trade/*', 'https://*.binance.com/*/futures/*', 'https://*.binance.com/*/stocks/*', 'https://web3.binance.com/*/token/*', 'https://*.okx.com/*', 'https://*.bybit.com/*', 'https://app.hyperliquid.xyz/*', 'https://*.coinbase.com/*', 'https://*.bitget.com/*', 'https://*.gate.com/*', 'https://*.gate.io/*', 'https://*.kucoin.com/*', 'https://*.mexc.com/*', 'https://*.htx.com/*', 'https://*.upbit.com/exchange*', 'https://stockpage.10jqka.com.cn/*', 'https://vergex.trade/chart*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    if (/(^|\.)upbit\.com$/i.test(location.hostname)) {
      installUpbitFrameTimeframeReceiver();
    }
    document.getElementById('chartviz-drawing-overlay')?.remove();
    const requestedLanguage = new URL(location.href).searchParams.get('chartvizLanguage');
    if (requestedLanguage === 'en' || requestedLanguage === 'zh-CN') {
      await browser.storage.local.set({ 'chartviz:language': requestedLanguage });
    }
    // Upbit blocks the extension-page iframe used by the regular floating
    // panel. Mount the same React application directly in WXT's isolated
    // content-script UI so it never depends on a cross-origin frame navigation.
    const panel = /(^|\.)upbit\.com$/i.test(location.hostname)
      ? await createDirectFloatingPanel(ctx)
      : createFloatingPanel();
    const shouldOpenPanel = new URL(location.href).searchParams.get('chartviz') === 'open';
    if (shouldOpenPanel) panel.setVisible(true);
    let lastPageUrl = location.href;
    window.setInterval(() => {
      if (location.href === lastPageUrl) return;
      lastPageUrl = location.href;
      panel.notifyContextChanged();
    }, 500);
    browser.runtime.onMessage.addListener(
      async (
        message: ContentMessage,
      ): Promise<ChartContextResponse | PanelResponse | undefined> => {
        if (message.type === 'chartviz/panel/toggle') {
          return Promise.resolve(panel.setVisible(!panel.isVisible()));
        }
        if (message.type === 'chartviz/panel/visibility') {
          // Background capture temporarily hides and restores the panel. That
          // visibility change is not a chart-context change and must not reset
          // an analysis that has just started.
          return Promise.resolve(panel.setVisible(message.visible, false));
        }
        if (message.type === 'chartviz/context/get') {
          try {
            return { ok: true, context: await collectActiveChartContext() };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : 'Unable to inspect chart.',
            };
          }
        }
        if (message.type === 'chartviz/chart/ready') {
          try {
            return { ok: true, context: await waitForActiveChartReady() };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : 'The chart is still loading.',
            };
          }
        }
        if (message.type === 'chartviz/chart/timeframe') {
          try {
            await setActiveChartTimeframe((message as SetChartTimeframeMessage).timeframe);
            return { ok: true, context: await collectActiveChartContext() };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : 'Unable to switch timeframe.' };
          }
        }
        return undefined;
      },
    );
  },
});

async function createDirectFloatingPanel(ctx: Parameters<typeof createShadowRootUi>[0]) {
  let container: HTMLElement | undefined;
  let reactRoot: Root | undefined;

  const movePanel = (dx: number, _dy: number) => {
    if (!container || !Number.isFinite(dx)) return;
    const rect = container.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left + dx), window.innerWidth - rect.width - 8);
    Object.assign(container.style, { left: `${left}px`, right: 'auto' });
  };

  const bridge: PanelBridge = {
    close: () => { if (container) container.style.display = 'none'; },
    drag: movePanel,
    preview: showImagePreview,
  };

  const ui = await createShadowRootUi(ctx, {
    name: 'chartviz-floating-panel-ui',
    position: 'overlay',
    zIndex: 2147483647,
    anchor: () => document.documentElement,
    mode: 'closed',
    isolateEvents: true,
    onMount(uiContainer, _shadow, shadowHost) {
      container = uiContainer;
      shadowHost.id = 'chartviz-floating-panel';
      shadowHost.style.setProperty('position', 'fixed', 'important');
      shadowHost.style.setProperty('top', '0', 'important');
      shadowHost.style.setProperty('left', '0', 'important');
      shadowHost.style.setProperty('z-index', '2147483647', 'important');
      shadowHost.style.setProperty('isolation', 'isolate', 'important');
      shadowHost.style.setProperty('pointer-events', 'none', 'important');
      Object.assign(uiContainer.style, {
        position: 'fixed', top: '0', right: '12px', left: 'auto', bottom: 'auto',
        display: 'none', width: '400px', maxWidth: 'calc(100vw - 24px)', height: '100vh',
        maxHeight: '100dvh', overflowY: 'auto', overflowX: 'hidden', color: '#e7e9ee',
        background: '#111318', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        boxSizing: 'border-box', boxShadow: '0 18px 60px rgba(0, 0, 0, .48)',
        zIndex: '2147483647', isolation: 'isolate', pointerEvents: 'auto',
      });
      reactRoot = createRoot(uiContainer);
      reactRoot.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(
            ErrorBoundary,
            null,
            React.createElement(App as React.ComponentType<{ panelBridge?: PanelBridge }>, { panelBridge: bridge }),
          ),
        ),
      );
      return reactRoot;
    },
    onRemove(root) { root?.unmount(); },
  });
  ui.mount();

  return {
    isVisible: () => container?.style.display !== 'none',
    notifyContextChanged: () => window.dispatchEvent(new CustomEvent('chartviz:context-changed')),
    setVisible(visible: boolean, notifyContextChanged = true): PanelResponse {
      if (container) container.style.display = visible ? 'block' : 'none';
      if (visible && notifyContextChanged) {
        window.dispatchEvent(new CustomEvent('chartviz:context-changed'));
      }
      return { ok: true, visible };
    },
  };
}

function createFloatingPanel() {
  const host = document.createElement('div');
  host.id = 'chartviz-floating-panel';
  Object.assign(host.style, {
    position: 'fixed', top: '0', right: '12px', width: '400px', maxWidth: 'calc(100vw - 24px)',
    height: '100vh', maxHeight: '100dvh', zIndex: '2147483647', display: 'none',
    borderRadius: '0', overflow: 'hidden', background: '#111318',
    boxShadow: '0 18px 60px rgba(0, 0, 0, .48)',
  });
  // Keep the embedded extension UI isolated from host-page CSS. Some trading
  // applications apply broad iframe rules while their workspace is mounted;
  // without this boundary the panel shell remains visible but its contents can
  // be hidden, leaving the user with an unexplained black rectangle.
  const shadow = host.attachShadow({ mode: 'closed' });
  const panelRoot = document.createElement('div');
  Object.assign(panelRoot.style, {
    position: 'relative', width: '100%', height: '100%', overflow: 'hidden',
    background: '#111318', color: '#f4f7fb', fontFamily: 'Inter, system-ui, sans-serif',
  });
  const frame = document.createElement('iframe');
  frame.src = browser.runtime.getURL('/floating-panel.html');
  frame.title = 'ChartViz';
  Object.assign(frame.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', border: '0',
    display: 'block', visibility: 'visible', opacity: '1', background: '#111318',
  });
  const startupStatus = document.createElement('div');
  startupStatus.setAttribute('role', 'status');
  Object.assign(startupStatus.style, {
    position: 'absolute', inset: '0', zIndex: '1', display: 'grid', placeItems: 'center',
    padding: '28px', textAlign: 'center', background: '#111318',
  });
  startupStatus.innerHTML = '<div><div style="font-size:20px;font-weight:750;letter-spacing:.01em">ChartViz</div><div style="margin-top:10px;color:#9ba6b6;font-size:13px">Loading chart workspace…</div></div>';
  panelRoot.append(frame, startupStatus);
  shadow.append(panelRoot);
  (document.body ?? document.documentElement).append(host);

  let panelReady = false;
  const startupTimeout = window.setTimeout(() => {
    if (panelReady) return;
    startupStatus.setAttribute('role', 'alert');
    startupStatus.innerHTML = '<div><div style="font-size:20px;font-weight:750">ChartViz</div><div style="margin-top:12px;color:#d4d9e1;font-size:13px;line-height:1.55">Panel failed to load. Reload the extension and this page.<br>面板加载失败，请重新加载插件和当前页面。</div></div>';
  }, 5000);

  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow) return;
    const data = event.data as { source?: string; type?: string; dx?: number; dy?: number } | null;
    if (data?.source !== 'chartviz') return;
    if (data.type === 'panel-ready') {
      panelReady = true;
      window.clearTimeout(startupTimeout);
      startupStatus.remove();
      return;
    }
    if (data.type === 'image-preview') {
      const previewData = (event.data as { dataUrl?: unknown }).dataUrl;
      if (typeof previewData === 'string' && previewData.startsWith('data:image/png;base64,')) {
        showImagePreview(previewData);
      }
      return;
    }
    if (data.type === 'panel-close') {
      host.style.display = 'none';
      return;
    }
    if (data.type !== 'panel-drag') return;
    if (!Number.isFinite(data.dx) || !Number.isFinite(data.dy)) return;
    const rect = host.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left + data.dx!), window.innerWidth - rect.width - 8);
    Object.assign(host.style, { left: `${left}px`, top: '0', right: 'auto' });
  });

  return {
    isVisible: () => host.style.display !== 'none',
    notifyContextChanged: () => {
      frame.contentWindow?.postMessage({ source: 'chartviz-page', type: 'context-changed' }, '*');
    },
    setVisible(visible: boolean, notifyContextChanged = true): PanelResponse {
      host.style.display = visible ? 'block' : 'none';
      if (visible && notifyContextChanged) {
        frame.contentWindow?.postMessage({ source: 'chartviz-page', type: 'context-changed' }, '*');
      }
      return { ok: true, visible };
    },
  };
}

function showImagePreview(dataUrl: string) {
  document.getElementById('chartviz-image-preview')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'chartviz-image-preview';
  Object.assign(overlay.style, {
    position: 'fixed', zIndex: '2147483647', inset: '0', display: 'grid',
    padding: '56px 28px 28px', placeItems: 'center', overflow: 'auto',
    background: 'rgba(3, 5, 10, .94)', cursor: 'zoom-out',
  });
  const image = document.createElement('img');
  image.src = dataUrl;
  image.alt = 'ChartViz annotated chart';
  Object.assign(image.style, {
    display: 'block', maxWidth: '96vw', maxHeight: 'calc(100vh - 84px)',
    objectFit: 'contain', cursor: 'default', boxShadow: '0 18px 70px rgba(0,0,0,.6)',
  });
  const close = document.createElement('button');
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close preview');
  Object.assign(close.style, {
    position: 'fixed', top: '14px', right: '20px', width: '38px', height: '38px',
    border: '1px solid #4b5260', borderRadius: '50%', color: '#fff',
    background: '#20242c', fontSize: '25px', cursor: 'pointer',
  });
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
  const dismiss = () => { overlay.remove(); window.removeEventListener('keydown', onKeyDown); };
  overlay.addEventListener('click', dismiss);
  image.addEventListener('click', (event) => event.stopPropagation());
  close.addEventListener('click', dismiss);
  window.addEventListener('keydown', onKeyDown);
  overlay.append(image, close);
  document.documentElement.append(overlay);
}
