export type PanelVisibility = {
  hidePanel(): Promise<void>;
  restorePanel(): Promise<void>;
};

export function createPanelVisibility(panelWindow: Window = window): PanelVisibility {
  let nextRequestId = 1;

  function setVisible(visible: boolean): Promise<void> {
    const requestId = nextRequestId;
    nextRequestId += 1;

    return new Promise((resolve) => {
      const onMessage = (event: MessageEvent) => {
        if (
          event.source === panelWindow.parent
          && event.data?.type === 'chartviz-panel-visibility-ack'
          && event.data.requestId === requestId
        ) {
          panelWindow.removeEventListener('message', onMessage);
          resolve();
        }
      };
      panelWindow.addEventListener('message', onMessage);
      panelWindow.parent.postMessage({
        type: 'chartviz-panel-visibility',
        requestId,
        visible,
      }, '*');
    });
  }

  return {
    hidePanel: () => setVisible(false),
    restorePanel: () => setVisible(true),
  };
}
