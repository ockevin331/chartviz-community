import { z } from 'zod';

import { AnalysisApiError } from './analysis-client';
import type { BackendAnalysisTask } from './backend-runtime';
import type { VerifiedCommunityConnection } from './community-connection';
import {
  analysisReportSchema,
  chartContextSchema,
  type ChartContext,
} from '../domain/analysis';

const communityTaskSchema = z.object({
  requestId: z.string().min(1),
  status: z.enum([
    'pending',
    'processing',
    'cancel_requested',
    'cancelled',
    'completed',
    'failed',
  ]),
  context: chartContextSchema,
  report: z.unknown().nullable().optional(),
  error: z.string().nullable().optional(),
  progressEvents: z.array(z.object({
    code: z.enum(['preparing', 'reading_chart', 'preparing_result']),
    createdAt: z.string().min(1),
  })).optional(),
});

const SAFE_ERROR_MESSAGES: Record<string, string> = {
  CV_IMAGE_INVALID: 'Invalid chart image.',
  CV_CONTEXT_INVALID: 'Invalid analysis context.',
  CV_CANCELLED: 'Analysis cancelled.',
  CV_PROVIDER_TIMEOUT: 'The analysis provider timed out.',
  CV_PROVIDER_ERROR: 'The analysis provider is unavailable.',
  CV_RESPONSE_INVALID: 'The analysis provider returned an invalid result.',
  CV_INTERNAL_ERROR: 'The Community backend could not complete the analysis.',
};

async function communityResponseError(response: Response): Promise<AnalysisApiError> {
  if (response.status === 401 || response.status === 403) {
    return new AnalysisApiError('The Community backend rejected the token.', 'community_token_rejected');
  }

  let code: string | undefined;
  try {
    const payload = await response.json() as { detail?: unknown };
    if (typeof payload.detail === 'object' && payload.detail !== null) {
      const candidate = (payload.detail as { code?: unknown }).code;
      if (typeof candidate === 'string') code = candidate;
    }
  } catch {
    // Keep upstream response bodies out of extension errors.
  }
  const safeMessage = code ? SAFE_ERROR_MESSAGES[code] : undefined;
  return new AnalysisApiError(
    safeMessage ?? `Community analysis request failed (${response.status}).`,
    code,
  );
}

function parseTask(payload: unknown): BackendAnalysisTask {
  try {
    const task = communityTaskSchema.parse(payload);
    const report = task.status === 'completed'
      ? analysisReportSchema.parse(task.report)
      : undefined;
    return {
      requestId: task.requestId,
      status: task.status,
      context: task.context,
      report,
      error: task.error ?? undefined,
      progressEvents: task.progressEvents ?? [],
    };
  } catch {
    throw new AnalysisApiError(
      'The Community backend returned an incompatible analysis task.',
      'invalid_analysis_response',
    );
  }
}

export class CommunityAnalysisClient {
  constructor(
    private readonly connection: VerifiedCommunityConnection,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<BackendAnalysisTask> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${this.connection.token}`);
    const response = await this.fetcher(`${this.connection.baseUrl}${path}`, {
      ...init,
      credentials: 'omit',
      headers,
    });
    if (!response.ok) throw await communityResponseError(response);
    return parseTask(await response.json());
  }

  async createAnalysis(
    images: Array<{ timeframe: string; image: Blob }>,
    context: ChartContext,
  ): Promise<BackendAnalysisTask> {
    if (images.length !== 1) {
      throw new AnalysisApiError(
        'Community Edition accepts exactly one chart image.',
        'community_single_image_required',
      );
    }
    const capture = images[0]!;
    const formData = new FormData();
    formData.append('image', capture.image, `chart-${capture.timeframe || 'current'}.png`);
    formData.append('context', JSON.stringify({
      ...context,
      language: context.outputLanguage ?? 'en',
      timeframe: capture.timeframe || context.timeframe,
    }));
    return this.request('/v1/analyses', { method: 'POST', body: formData });
  }

  async getAnalysis(requestId: string): Promise<BackendAnalysisTask> {
    return this.request(`/v1/analyses/${encodeURIComponent(requestId)}`);
  }

  async cancelAnalysis(requestId: string): Promise<BackendAnalysisTask> {
    return this.request(`/v1/analyses/${encodeURIComponent(requestId)}`, { method: 'DELETE' });
  }
}
