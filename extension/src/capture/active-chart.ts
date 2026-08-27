import { browser } from 'wxt/browser';
import type { ChartContext } from '../domain/chart-context';
import type { CaptureResponse, ChartContextResponse } from '../domain/chart-messages';
import type { ChartAvailabilityFailure } from '../sites/supported-sites';
import type { ProcessedImage } from './image-types';
import { processImage } from './process-image';

export type CapturedChart = {
  image: ProcessedImage;
  context: ChartContext;
};

export type ActiveChartClient = {
  inspect(): Promise<ChartContext>;
  capture(signal: AbortSignal): Promise<CapturedChart>;
};

type ActiveChartDependencies = {
  sendMessage(message: { type: 'chartviz/active-chart/inspect' | 'chartviz/active-chart/capture' }): Promise<unknown>;
  dataUrlToBlob(dataUrl: string): Blob;
  processImage(blob: Blob): Promise<ProcessedImage>;
};

export class ChartAvailabilityError extends Error {
  override readonly name = 'ChartAvailabilityError';

  constructor(
    message: string,
    readonly availability: ChartAvailabilityFailure,
  ) {
    super(message);
  }
}

export function isChartAvailabilityError(error: unknown): error is ChartAvailabilityError {
  return error instanceof ChartAvailabilityError;
}

function isChartAvailabilityFailure(value: unknown): value is ChartAvailabilityFailure {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.code === 'unsupported_site') {
    return typeof candidate.onChartVizSite === 'boolean';
  }
  return candidate.code === 'unsupported_url'
    && typeof candidate.site === 'string'
    && typeof candidate.siteName === 'string'
    && typeof candidate.exampleUrl === 'string';
}

function responseError(response: unknown, fallback: string): Error {
  if (response && typeof response === 'object' && 'error' in response && typeof response.error === 'string') {
    if ('availability' in response && isChartAvailabilityFailure(response.availability)) {
      return new ChartAvailabilityError(response.error, response.availability);
    }
    return new Error(response.error);
  }
  return new Error(fallback);
}

function isChartContext(value: unknown): value is ChartContext {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ChartContext>;
  return typeof candidate.site === 'string'
    && typeof candidate.pageType === 'string'
    && typeof candidate.url === 'string'
    && Boolean(candidate.chart)
    && Boolean(candidate.viewport);
}

function assertContextResponse(response: unknown): ChartContext {
  const candidate = response as Partial<ChartContextResponse> | null;
  if (candidate?.ok === true && 'context' in candidate && isChartContext(candidate.context)) return candidate.context;
  throw responseError(response, 'Unable to detect the active chart.');
}

function assertCaptureResponse(response: unknown): Extract<CaptureResponse, { ok: true }> {
  const candidate = response as Partial<Extract<CaptureResponse, { ok: true }>> | null;
  if (candidate?.ok === true
    && isChartContext(candidate.context)
    && typeof candidate.previewDataUrl === 'string'
    && /^data:image\/(?:png|jpeg);base64,/i.test(candidate.previewDataUrl)) {
    return candidate as Extract<CaptureResponse, { ok: true }>;
  }
  throw responseError(response, 'Unable to capture the active chart.');
}

function browserDataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error('The captured chart image is invalid.');
  const bytes = Uint8Array.from(atob(match[2]!), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: match[1]!.toLowerCase() });
}

const defaultDependencies: ActiveChartDependencies = {
  sendMessage: (message) => browser.runtime.sendMessage(message),
  dataUrlToBlob: browserDataUrlToBlob,
  processImage,
};

export function createActiveChartClient(overrides: Partial<ActiveChartDependencies> = {}): ActiveChartClient {
  const dependencies = { ...defaultDependencies, ...overrides };
  return {
    async inspect() {
      const response = await dependencies.sendMessage({ type: 'chartviz/active-chart/inspect' });
      return assertContextResponse(response);
    },
    async capture(signal) {
      signal.throwIfAborted();
      const response = await dependencies.sendMessage({ type: 'chartviz/active-chart/capture' });
      signal.throwIfAborted();
      const captured = assertCaptureResponse(response);
      const blob = dependencies.dataUrlToBlob(captured.previewDataUrl);
      signal.throwIfAborted();
      const image = await dependencies.processImage(blob);
      signal.throwIfAborted();
      return { image, context: captured.context };
    },
  };
}

export const activeChartClient = createActiveChartClient();
