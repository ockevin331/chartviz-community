export function mountFloatingPanel(panelUrl: string): void {
  const panelId = 'chartviz-community-panel';
  const existing = document.getElementById(panelId);
  if (existing) {
    const cleanup = (existing as HTMLElement & { __chartvizCleanup?: () => void }).__chartvizCleanup;
    cleanup?.();
    existing.remove();
  }

  const host = document.createElement('div');
  host.id = panelId;
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    right: '12px',
    width: '400px',
    maxWidth: 'calc(100vw - 24px)',
    height: '100vh',
    maxHeight: '100dvh',
    zIndex: '2147483647',
    borderRadius: '0',
    boxShadow: '0 18px 60px rgba(0, 0, 0, 0.35)',
    overflow: 'hidden',
    background: '#0c1424',
  });

  const iframe = document.createElement('iframe');
  iframe.src = panelUrl;
  iframe.title = 'ChartViz';
  iframe.setAttribute('allow', 'clipboard-write');
  const frameAttributeObserver = new MutationObserver(() => {
    if (iframe.hasAttribute('srcdoc')) iframe.removeAttribute('srcdoc');
  });
  frameAttributeObserver.observe(iframe, { attributes: true, attributeFilter: ['srcdoc'] });
  Object.assign(iframe.style, {
    width: '100%',
    height: '100%',
    border: '0',
    background: 'transparent',
  });

  const panelProtocol = new URL(panelUrl).protocol;
  const isPanelOrigin = (origin: string) => {
    try {
      return new URL(origin).protocol === panelProtocol;
    } catch {
      return false;
    }
  };
  let automaticRestoreTimer: number | undefined;
  let lightboxRestore: {
    top: string;
    right: string;
    bottom: string;
    left: string;
    width: string;
    maxWidth: string;
    height: string;
    maxHeight: string;
    boxShadow: string;
  } | null = null;
  const onPanelMessage = (event: MessageEvent) => {
    if (
      event.source !== iframe.contentWindow
      || !isPanelOrigin(event.origin)
    ) {
      return;
    }

    if (event.data?.source === 'chartviz' && event.data.type === 'panel-close') {
      unmount();
      return;
    }
    if (event.data?.source === 'chartviz' && event.data.type === 'panel-drag') {
      if (!Number.isFinite(event.data.dx) || !Number.isFinite(event.data.dy)) return;
      const rect = host.getBoundingClientRect();
      const left = Math.min(Math.max(8, rect.left + event.data.dx), window.innerWidth - rect.width - 8);
      Object.assign(host.style, { left: `${left}px`, top: '0', right: 'auto' });
      return;
    }
    if (event.data?.source === 'chartviz' && event.data.type === 'image-lightbox-open') {
      if (lightboxRestore === null) {
        lightboxRestore = {
          top: host.style.top,
          right: host.style.right,
          bottom: host.style.bottom,
          left: host.style.left,
          width: host.style.width,
          maxWidth: host.style.maxWidth,
          height: host.style.height,
          maxHeight: host.style.maxHeight,
          boxShadow: host.style.boxShadow,
        };
      }
      Object.assign(host.style, {
        inset: '0',
        width: '100vw',
        maxWidth: 'none',
        height: '100vh',
        maxHeight: 'none',
        boxShadow: 'none',
      });
      return;
    }
    if (event.data?.source === 'chartviz' && event.data.type === 'image-lightbox-close') {
      if (lightboxRestore === null) return;
      host.style.inset = '';
      Object.assign(host.style, lightboxRestore);
      lightboxRestore = null;
      return;
    }
    if (
      event.data?.type !== 'chartviz-panel-visibility'
      || typeof event.data.visible !== 'boolean'
      || !Number.isInteger(event.data.requestId)
    ) return;

    host.style.visibility = event.data.visible ? 'visible' : 'hidden';
    if (automaticRestoreTimer !== undefined) {
      window.clearTimeout(automaticRestoreTimer);
      automaticRestoreTimer = undefined;
    }
    if (!event.data.visible) {
      automaticRestoreTimer = window.setTimeout(() => {
        host.style.visibility = 'visible';
        automaticRestoreTimer = undefined;
      }, 3_000);
    }
    iframe.contentWindow?.postMessage({
      type: 'chartviz-panel-visibility-ack',
      requestId: event.data.requestId,
    }, event.origin);
  };

  const unmount = () => {
    if (automaticRestoreTimer !== undefined) {
      window.clearTimeout(automaticRestoreTimer);
    }
    frameAttributeObserver.disconnect();
    window.removeEventListener('message', onPanelMessage);
    host.remove();
  };
  (host as HTMLDivElement & { __chartvizCleanup?: () => void }).__chartvizCleanup = unmount;
  window.addEventListener('message', onPanelMessage);
  host.append(iframe);
  document.documentElement.append(host);
}
