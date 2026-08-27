import type { ChartContext } from './chart-context';
import type { ChartAvailabilityFailure } from '../sites/supported-sites';

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

export type ChartFailure = {
  ok: false;
  error: string;
  availability?: ChartAvailabilityFailure;
};

export type ChartContextResponse =
  | { ok: true; context: ChartContext }
  | ChartFailure;

export type PanelResponse =
  | { ok: true; visible: boolean }
  | { ok: false; error: string };

export type CaptureResponse =
  | { ok: true; context: ChartContext; previewDataUrl: string }
  | ChartFailure;
