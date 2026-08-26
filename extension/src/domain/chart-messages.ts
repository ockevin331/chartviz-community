import type { ChartContext } from './chart-context';

export type GetChartContextMessage = { type: 'chartviz/context/get' };
export type WaitForChartReadyMessage = { type: 'chartviz/chart/ready' };
export type ToggleFloatingPanelMessage = { type: 'chartviz/panel/toggle' };
export type SetFloatingPanelVisibilityMessage = {
  type: 'chartviz/panel/visibility';
  visible: boolean;
};

export type InspectActiveChartMessage = { type: 'chartviz/active-chart/inspect' };
export type CaptureActiveChartMessage = { type: 'chartviz/active-chart/capture' };

export type ContentMessage =
  | GetChartContextMessage
  | WaitForChartReadyMessage
  | ToggleFloatingPanelMessage
  | SetFloatingPanelVisibilityMessage;

export type BackgroundMessage = InspectActiveChartMessage | CaptureActiveChartMessage;

export type ChartContextResponse =
  | { ok: true; context: ChartContext }
  | { ok: false; error: string };

export type PanelResponse =
  | { ok: true; visible: boolean }
  | { ok: false; error: string };

export type CaptureResponse =
  | { ok: true; context: ChartContext; previewDataUrl: string }
  | { ok: false; error: string };
