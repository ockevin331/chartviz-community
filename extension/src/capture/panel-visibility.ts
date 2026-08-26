export type PanelVisibility = {
  hidePanel(signal?: AbortSignal): Promise<void>;
  restorePanel(): Promise<void>;
};

export type PanelVisibilityOptions = {
  acknowledgementTimeoutMs?: number;
};

export function createPanelVisibility(
  panelWindow: Window = window,
  options: PanelVisibilityOptions = {},
): PanelVisibility {
  let nextRequestId = 1;
  const acknowledgementTimeoutMs = options.acknowledgementTimeoutMs ?? 1_000;

  function setVisible(visible: boolean, signal?: AbortSignal): Promise<void> {
    const requestId = nextRequestId;
    nextRequestId += 1;

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Cancelled', 'AbortError'));
        return;
      }

      let timeout: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        panelWindow.removeEventListener('message', onMessage);
        signal?.removeEventListener('abort', onAbort);
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
      };
      const settle = (error?: Error) => {
        cleanup();
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const onMessage = (event: MessageEvent) => {
        if (
          event.source === panelWindow.parent
          && event.data?.type === 'chartviz-panel-visibility-ack'
          && event.data.requestId === requestId
        ) {
          settle();
        }
      };
      const onAbort = () => settle(signal?.reason instanceof Error
        ? signal.reason
        : new DOMException('Cancelled', 'AbortError'));

      panelWindow.addEventListener('message', onMessage);
      signal?.addEventListener('abort', onAbort, { once: true });
      timeout = setTimeout(() => {
        settle(new Error('Panel visibility acknowledgement timed out'));
      }, acknowledgementTimeoutMs);
      panelWindow.parent.postMessage({
        type: 'chartviz-panel-visibility',
        requestId,
        visible,
      }, '*');
    });
  }

  return {
    hidePanel: (signal) => setVisible(false, signal),
    restorePanel: () => setVisible(true),
  };
}
