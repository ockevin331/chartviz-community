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
    top: '16px',
    right: '16px',
    width: 'min(420px, calc(100vw - 32px))',
    height: 'min(720px, calc(100vh - 32px))',
    zIndex: '2147483647',
    borderRadius: '12px',
    boxShadow: '0 18px 60px rgba(0, 0, 0, 0.35)',
    overflow: 'hidden',
    background: '#0c1424',
  });

  const iframe = document.createElement('iframe');
  iframe.src = panelUrl;
  iframe.title = 'ChartViz Community';
  Object.assign(iframe.style, {
    width: '100%',
    height: '100%',
    border: '0',
    background: 'transparent',
  });

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close ChartViz');
  Object.assign(close.style, {
    position: 'absolute',
    top: '8px',
    right: '8px',
    width: '32px',
    height: '32px',
    zIndex: '1',
    border: '0',
    borderRadius: '999px',
    color: '#edf4ff',
    background: 'rgba(12, 20, 36, 0.82)',
    cursor: 'pointer',
    fontSize: '24px',
    lineHeight: '28px',
  });

  const panelOrigin = new URL(panelUrl).origin;
  let automaticRestoreTimer: number | undefined;
  const onPanelMessage = (event: MessageEvent) => {
    if (
      event.source !== iframe.contentWindow
      || event.origin !== panelOrigin
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
      const top = Math.min(Math.max(8, rect.top + event.data.dy), window.innerHeight - rect.height - 8);
      Object.assign(host.style, { left: `${left}px`, top: `${top}px`, right: 'auto' });
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
    }, panelOrigin);
  };

  const unmount = () => {
    if (automaticRestoreTimer !== undefined) {
      window.clearTimeout(automaticRestoreTimer);
    }
    window.removeEventListener('message', onPanelMessage);
    host.remove();
  };
  (host as HTMLDivElement & { __chartvizCleanup?: () => void }).__chartvizCleanup = unmount;
  close.addEventListener('click', unmount);
  window.addEventListener('message', onPanelMessage);
  host.append(iframe, close);
  document.documentElement.append(host);
}
