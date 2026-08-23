import type { AnalysisEnvelope, ChartContext, InstrumentNews } from './analysis';
import type { AnalysisProgressEvent } from './analysis-progress';
import type { BackendCapabilities } from '../api/backend-capabilities';
import type { CommunityConnectionView } from '../api/community-connection';

export type SupportedCaptureTimeframe = '5m' | '15m' | '1h' | '4h' | '1d';

export type GetChartContextMessage = {
  type: 'chartviz/context/get';
};

export type InspectActiveChartMessage = {
  type: 'chartviz/active-chart/inspect';
};

export type CaptureActiveChartMessage = {
  type: 'chartviz/active-chart/capture';
  timeframes?: SupportedCaptureTimeframe[];
};

export type RequestCapturePermissionMessage = {
  type: 'chartviz/capture-permission/request';
};

export type SetChartTimeframeMessage = { type: 'chartviz/chart/timeframe'; timeframe: SupportedCaptureTimeframe };

export type WaitForChartReadyMessage = { type: 'chartviz/chart/ready' };

export type AnalyzeCapturedChartMessage = {
  type: 'chartviz/captured-chart/analyze';
  authToken?: string;
  authUserId?: string;
  extensionVersion?: string;
  context: ChartContext;
  previewDataUrl: string;
  captures?: Array<{ timeframe: string; context: ChartContext; previewDataUrl: string }>;
};

export type GetAnalysisTaskMessage = {
  type: 'chartviz/analysis-task/get';
  authToken?: string;
  authUserId?: string;
  extensionVersion?: string;
  requestId: string;
};

export type CancelAnalysisTaskMessage = {
  type: 'chartviz/analysis-task/cancel';
  authToken?: string;
  authUserId?: string;
  extensionVersion?: string;
  requestId: string;
};

export type SearchInstrumentNewsMessage = {
  type: 'chartviz/instrument-news/search';
  symbol: string;
  exchange?: string;
  language: 'en' | 'zh-CN';
};

export type ExtensionApiFetchMessage = {
  type: 'chartviz/extension-api/fetch';
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  responseType?: 'text' | 'base64';
};

export type ToggleFloatingPanelMessage = {
  type: 'chartviz/panel/toggle';
};

export type SetFloatingPanelVisibilityMessage = {
  type: 'chartviz/panel/visibility';
  visible: boolean;
};

export type CloseFloatingPanelMessage = {
  type: 'chartviz/active-panel/close';
};

export type GetCommunityConnectionMessage = {
  type: 'chartviz/community-connection/get';
};

export type TestCommunityConnectionMessage = {
  type: 'chartviz/community-connection/test-and-save';
  baseUrl: string;
  token?: string;
  reuseStoredToken?: boolean;
};

export type DisconnectCommunityConnectionMessage = {
  type: 'chartviz/community-connection/disconnect';
};

export type GetBackendCapabilitiesMessage = {
  type: 'chartviz/backend/capabilities';
};

export type CommunityConnectionResponse =
  | { ok: true; connection: CommunityConnectionView }
  | { ok: false; code: string; message: string; connection?: CommunityConnectionView };

export type BackendCapabilitiesResponse =
  | { ok: true; capabilities: BackendCapabilities }
  | { ok: false; code: string; message: string };

export type PanelResponse = { ok: true; visible: boolean } | { ok: false; error: string };

export type ContentMessage =
  | GetChartContextMessage
  | WaitForChartReadyMessage
  | SetChartTimeframeMessage
  | ToggleFloatingPanelMessage
  | SetFloatingPanelVisibilityMessage;

export type ChartContextResponse =
  | { ok: true; context: ChartContext }
  | { ok: false; error: string };

export type CaptureResponse =
  | {
      ok: true;
      context: ChartContext;
      previewDataUrl: string;
      captures?: Array<{ timeframe: string; context: ChartContext; previewDataUrl: string }>;
    }
  | { ok: false; error: string };

export type CapturePermissionResponse =
  | { ok: true; granted: boolean }
  | { ok: false; error: string };

export type AnalyzeResponse =
  | {
      ok: true;
      task: { requestId: string; status: string; context: ChartContext };
    }
  | { ok: false; error: string; code?: string; pricingUrl?: string };

export type AnalysisTaskResponse =
  | {
      ok: true;
      task: {
        requestId: string;
        status: 'pending' | 'processing' | 'awaiting_confirmation' | 'cancel_requested' | 'cancelled' | 'completed' | 'failed';
        context: ChartContext;
        report?: AnalysisEnvelope['report'];
        error?: string;
        progressEvents?: AnalysisProgressEvent[];
      };
    }
  | { ok: false; error: string; code?: string; pricingUrl?: string };

export type NewsResponse =
  | { ok: true; news: InstrumentNews }
  | { ok: false; error: string };

export type ExtensionApiFetchResponse =
  | {
      ok: true;
      status: number;
      statusText: string;
      headers: Array<[string, string]>;
      body: string;
      encoding?: 'text' | 'base64';
    }
  | { ok: false; error: string };

export type BackgroundMessage =
  | InspectActiveChartMessage
  | RequestCapturePermissionMessage
  | CaptureActiveChartMessage
  | AnalyzeCapturedChartMessage
  | GetAnalysisTaskMessage
  | CancelAnalysisTaskMessage
  | SearchInstrumentNewsMessage
  | ExtensionApiFetchMessage
  | CloseFloatingPanelMessage
  | GetCommunityConnectionMessage
  | TestCommunityConnectionMessage
  | DisconnectCommunityConnectionMessage
  | GetBackendCapabilitiesMessage;

export type BackgroundResponse =
  | ChartContextResponse
  | CapturePermissionResponse
  | CaptureResponse
  | AnalyzeResponse
  | AnalysisTaskResponse
  | NewsResponse
  | ExtensionApiFetchResponse
  | PanelResponse
  | CommunityConnectionResponse
  | BackendCapabilitiesResponse;
