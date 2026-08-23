import {
  analysisEnvelopeSchema,
  instrumentNewsSchema,
  type AnalysisEnvelope,
  type AnalysisReport,
  type ChartContext,
  type InstrumentNews,
} from '../domain/analysis';
import { authenticatedFetch } from './extension-auth';
import { canonicalAnalysisApiBaseUrl } from './base-url';
import type { AnalysisProgressEvent } from '../domain/analysis-progress';

type AnalysisMode = 'mock' | 'remote';

export type AnalysisTaskStatus =
  | 'pending'
  | 'processing'
  | 'awaiting_confirmation'
  | 'cancel_requested'
  | 'cancelled'
  | 'completed'
  | 'failed';

export class AnalysisApiError extends Error {
  constructor(message: string, public code?: string, public pricingUrl?: string) {
    super(message);
    this.name = 'AnalysisApiError';
  }
}

async function responseError(response: Response): Promise<AnalysisApiError> {
  let payload: { detail?: string | { code?: string; message?: string; pricingUrl?: string } } = {};
  try { payload = await response.json(); } catch { /* non-JSON upstream error */ }
  const detail = payload.detail;
  if (detail && typeof detail === 'object') {
    return new AnalysisApiError(detail.message || `Analysis request failed (${response.status}).`, detail.code, detail.pricingUrl);
  }
  return new AnalysisApiError(typeof detail === 'string' ? detail : `Analysis request failed (${response.status}).`);
}

function authenticationError(): AnalysisApiError {
  return new AnalysisApiError(
    'Your ChartViz authorization has expired. Sign in again.',
    'authentication_required',
  );
}

async function requireAuthenticatedResponse(
  input: RequestInfo | URL,
  init: RequestInit = {},
  authToken?: string,
  extensionIdentity?: { userId: string; version: string },
): Promise<Response> {
  const response = authToken
    ? await fetch(input, {
        ...init,
        credentials: 'omit',
        headers: (() => {
          const headers = new Headers(init.headers);
          headers.set('Authorization', `Bearer ${authToken}`);
          if (extensionIdentity) {
            headers.set('X-ChartViz-Expected-User-Id', extensionIdentity.userId);
            headers.set('X-ChartViz-Extension-Version', extensionIdentity.version);
          }
          return headers;
        })(),
      })
    : await authenticatedFetch(input, init);
  if (!response || response.status === 401) throw authenticationError();
  return response;
}

function analysisMode(): AnalysisMode {
  return import.meta.env.WXT_PUBLIC_ANALYSIS_MODE === 'remote' ? 'remote' : 'mock';
}

function apiBaseUrl(): string {
  return canonicalAnalysisApiBaseUrl(import.meta.env.WXT_PUBLIC_ANALYSIS_API_BASE_URL);
}

export async function getCloudBackendCapabilities(): Promise<unknown> {
  const response = await fetch(`${apiBaseUrl()}/v1/capabilities`, {
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

function mockReport(context: ChartContext): AnalysisReport {
  const chartDescription = [context.exchange, context.symbol, context.timeframe]
    .filter(Boolean)
    .join(' · ');

  return {
    schemaVersion: '1.3',
    analysisContext: {
      instrument: context.symbol ?? null,
      venue: context.exchange ?? null,
      capturedAt: null,
      timeframes: context.timeframe ? [{ timeframe: context.timeframe, role: 'setup' }] : [],
      latestCandleClosed: null,
      dataSources: ['screenshot'],
      limitations: ['Mock mode does not call a multimodal model.'],
    },
    evidence: [],
    marketState: {
      regime: 'insufficient', directionalBias: 'unclear', structure: 'unclear',
      currentLocation: null, supportingEvidenceRefs: [], opposingEvidenceRefs: [], confidence: 0,
    },
    zones: [],
    setupEvaluation: {
      playbook: 'none', state: 'preparing', direction: null, location: null,
      premise: null,
      entry: null, trigger: null, confirmation: null, triggerCandleClosed: null,
      structuralStop: null, targets: [], effectiveRToT1: null,
      actionability: 'NO_TRADE', vetoes: ['model_analysis_unavailable'],
      pendingConditions: [], whatChangesDecision: ['Configure the remote analysis service.'],
      evidenceRefs: [], opposingEvidenceRefs: [],
    },
    imageQuality: {
      quality: 'high',
      limitations: ['Mock mode does not call a multimodal model.'],
      confidence: 1,
    },
    marketReading: {
      trend: 'unclear',
      structure: 'unclear',
      evidence: [
        {
          claim: `Captured ${chartDescription || 'the active chart'}.`,
          visualEvidence: 'The TradingView chart region was located and cropped.',
          confidence: 1,
        },
      ],
      confidence: 0,
    },
    bullishEvidence: [],
    bearishEvidence: [],
    conflicts: ['No model analysis is performed in mock mode.'],
    dominantBias: 'unclear',
    overallConfidence: 0,
    decision: {
      direction: 'wait', status: 'waiting_trigger',
      summary: 'Configure the remote analysis service before making a chart assessment.',
      primaryRisk: 'No market interpretation has been performed.',
    },
    insights: [], keyLevels: [], patterns: [], conclusions: [], segments: [],
    indicatorReadings: [], volumeAnalysis: null, positioningEvidence: [],
    timeframeAnalyses: context.timeframe ? [{ timeframe: context.timeframe, trend: 'unclear', structure: 'unclear', summary: 'No remote model analysis was performed.', evidence: ['Mock mode only captured the chart.'], decision: 'wait', confidence: 0 }] : [],
    tradeSignals: [],
    scenarios: {
      long: {
        trigger: 'Requires a remote multimodal analysis service.',
        confirmation: 'Requires a remote multimodal analysis service.',
        invalidation: 'Not available in mock mode.',
        targetLogic: 'Not available in mock mode.',
        mainRisk: 'No market interpretation has been performed.',
      },
      short: {
        trigger: 'Requires a remote multimodal analysis service.',
        confirmation: 'Requires a remote multimodal analysis service.',
        invalidation: 'Not available in mock mode.',
        targetLogic: 'Not available in mock mode.',
        mainRisk: 'No market interpretation has been performed.',
      },
      wait: {
        conditions: 'Wait until the remote analysis service is configured.',
        resolution: 'Set analysis mode to remote and configure the API URL.',
      },
    },
    drawings: [],
    riskNotice:
      'Chart analysis is incomplete or stale and is for research, not personalized investment advice.',
  };
}

export async function analyzeChart(
  images: Array<{ timeframe: string; image: Blob }>,
  context: ChartContext,
): Promise<AnalysisEnvelope> {
  if (analysisMode() === 'mock') {
    return {
      requestId: crypto.randomUUID(),
      context,
      report: mockReport(context),
    };
  }

  const formData = new FormData();
  images.forEach(({ timeframe, image }, index) => formData.append('images', image, `chart-${timeframe || index + 1}.png`));
  formData.append(
    'metadata',
    new Blob([JSON.stringify({ schemaVersion: '1.3', context, timeframes: images.map((item) => item.timeframe) })], {
      type: 'application/json',
    }),
  );

  const response = await requireAuthenticatedResponse(`${apiBaseUrl()}/v1/chart-analyses`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) throw await responseError(response);

  return analysisEnvelopeSchema.parse(await response.json());
}

export async function createChartAnalysisTask(
  images: Array<{ timeframe: string; image: Blob }>,
  context: ChartContext,
  authToken?: string,
  extensionIdentity?: { userId: string; version: string },
) {
  const formData = new FormData();
  images.forEach(({ timeframe, image }, index) => formData.append('images', image, `chart-${timeframe || index + 1}.png`));
  formData.append('metadata', new Blob([JSON.stringify({ schemaVersion: '1.3', context, timeframes: images.map(item => item.timeframe) })], { type: 'application/json' }));
  const response = await requireAuthenticatedResponse(
    `${apiBaseUrl()}/v1/analysis-tasks`,
    { method: 'POST', body: formData },
    authToken,
    extensionIdentity,
  );
  if (!response.ok) throw await responseError(response);
  return await response.json() as {
    requestId: string;
    status: AnalysisTaskStatus;
    context: ChartContext;
  };
}

export async function getChartAnalysisTask(
  requestId: string,
  authToken?: string,
  extensionIdentity?: { userId: string; version: string },
) {
  const response = await requireAuthenticatedResponse(
    `${apiBaseUrl()}/v1/analysis-tasks/${encodeURIComponent(requestId)}`,
    {},
    authToken,
    extensionIdentity,
  );
  if (!response.ok) throw await responseError(response);
  return await response.json() as { requestId: string; status: AnalysisTaskStatus; context: ChartContext; report?: AnalysisReport; error?: string; progressEvents?: AnalysisProgressEvent[] };
}

export async function cancelChartAnalysisTask(
  requestId: string,
  authToken?: string,
  extensionIdentity?: { userId: string; version: string },
) {
  const response = await requireAuthenticatedResponse(
    `${apiBaseUrl()}/v1/analysis-tasks/${encodeURIComponent(requestId)}/cancel`,
    { method: 'POST' },
    authToken,
    extensionIdentity,
  );
  if (!response.ok) throw await responseError(response);
  return await response.json() as { requestId: string; status: 'cancel_requested' | 'cancelled' | 'completed' | 'failed'; context: ChartContext; report?: AnalysisReport; error?: string; progressEvents?: AnalysisProgressEvent[] };
}

export async function searchInstrumentNews(
  symbol: string,
  exchange: string | undefined,
  language: 'en' | 'zh-CN',
): Promise<InstrumentNews> {
  const response = await requireAuthenticatedResponse(`${apiBaseUrl()}/v1/instrument-news`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, exchange, language }),
  });
  if (!response.ok) throw new Error(`News API returned HTTP ${response.status}.`);
  return instrumentNewsSchema.parse(await response.json());
}
