import { z } from 'zod';
import type { AnalysisCapture } from '../analysis/runtime/analysis-runtime';
import type { OutputLanguage } from '../analysis/stages/shared-stage-types';
import type {
  ExtensionAccount,
  ExtensionAnalysisTask,
  ExtensionApiError,
  ExtensionCaptureSettings,
} from './contracts/extension-cloud-v1';
import {
  parseExtensionAccount,
  parseExtensionCapabilities,
  parseExtensionCaptureSettings,
} from './cloud-account-schema';
import { parseExtensionAnalysisTask } from './cloud-task-schema';

export const CLOUD_API_BASE_URL = 'https://www.chartviz.xyz/api' as const;

const cloudTokenPattern = /^cv_live_[A-Za-z0-9_-]{43,}$/;
const errorCodeSchema = z.enum([
  'authentication_required', 'invalid_token', 'token_revoked', 'token_expired',
  'insufficient_scope', 'free_trial_exhausted', 'subscription_required',
  'subscription_expired', 'quota_exhausted', 'multi_timeframe_requires_advance',
  'invalid_image', 'invalid_chart_image', 'unsupported_timeframe', 'task_not_found',
  'task_failed', 'task_cancelled', 'incompatible_api_version',
  'incompatible_report_schema', 'service_unavailable',
]);
const errorSchema = z.object({
  code: errorCodeSchema,
  params: z.record(z.string(), z.union([
    z.string(), z.number(), z.boolean(), z.null(),
  ])).default({}),
  pricingUrl: z.string().optional(),
});

export type CloudConnectionErrorCode = ExtensionApiError['code'];

export class CloudConnectionError extends Error {
  readonly code: CloudConnectionErrorCode;
  readonly params: ExtensionApiError['params'];
  readonly pricingUrl: string | null;

  constructor(
    code: CloudConnectionErrorCode,
    params: ExtensionApiError['params'] = {},
    pricingUrl: string | null = null,
  ) {
    super(code);
    this.name = 'CloudConnectionError';
    this.code = code;
    this.params = params;
    this.pricingUrl = pricingUrl;
  }
}

export type CloudClient = Readonly<{
  connect(token: string): Promise<ExtensionAccount>;
  account(token: string): Promise<ExtensionAccount>;
  captureSettings(token: string): Promise<ExtensionCaptureSettings>;
  createTask(token: string, input: CloudTaskCreateInput): Promise<ExtensionAnalysisTask>;
  task(token: string, requestId: string, signal?: AbortSignal): Promise<ExtensionAnalysisTask>;
  cancelTask(token: string, requestId: string): Promise<ExtensionAnalysisTask>;
}>;

export type CloudTaskCreateInput = Readonly<{
  captures: readonly AnalysisCapture[];
  outputLanguage: OutputLanguage;
}>;

function validateToken(token: string): void {
  if (!cloudTokenPattern.test(token)) throw new CloudConnectionError('invalid_token');
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new CloudConnectionError('service_unavailable');
  }
}

async function request(
  fetcher: typeof fetch,
  path: string,
  token?: string,
  options: Readonly<{
    method?: 'GET' | 'POST';
    body?: BodyInit;
    signal?: AbortSignal;
  }> = {},
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { headers };
  if (options.method && options.method !== 'GET') init.method = options.method;
  if (options.body !== undefined) init.body = options.body;
  if (options.signal !== undefined) init.signal = options.signal;
  let response: Response;
  try {
    response = await fetcher(`${CLOUD_API_BASE_URL}${path}`, init);
  } catch {
    throw new CloudConnectionError('service_unavailable');
  }
  const body = await responseBody(response);
  if (response.ok) return body;
  const parsed = errorSchema.safeParse(body);
  if (!parsed.success) throw new CloudConnectionError('service_unavailable');
  throw new CloudConnectionError(
    parsed.data.code,
    parsed.data.params,
    parsed.data.pricingUrl ?? null,
  );
}

function taskContractError(): CloudConnectionError {
  return new CloudConnectionError('incompatible_report_schema');
}

function imageBlob(capture: AnalysisCapture): Blob {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    capture.image.dataUrl,
  );
  const mediaType = match?.[1];
  const encoded = match?.[2];
  if (!mediaType || !encoded || mediaType !== capture.image.mediaType) {
    throw new CloudConnectionError('invalid_image');
  }
  try {
    const decoded = atob(encoded);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    return new Blob([bytes], { type: capture.image.mediaType });
  } catch {
    throw new CloudConnectionError('invalid_image');
  }
}

const timeframeDurations = Object.freeze({
  '1m': 1,
  '3m': 3,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '2h': 120,
  '4h': 240,
  '6h': 360,
  '8h': 480,
  '12h': 720,
  '1d': 1440,
  '3d': 4320,
  '1w': 10080,
  '1M': 43200,
} as const);

type NormalizedCaptureRole = 'context' | 'setup' | 'trigger' | 'setup_and_trigger' | null;

function normalizedRoles(timeframes: readonly string[]): readonly NormalizedCaptureRole[] {
  let rolesByDuration: readonly NormalizedCaptureRole[];
  if (timeframes.length === 1) rolesByDuration = [null];
  else if (timeframes.length === 2) rolesByDuration = ['context', 'setup_and_trigger'];
  else rolesByDuration = ['context', 'setup', 'trigger'];
  const orderedIndices = timeframes
    .map((_, index) => index)
    .sort((left, right) => (
      timeframeDurations[timeframes[right] as keyof typeof timeframeDurations]
      - timeframeDurations[timeframes[left] as keyof typeof timeframeDurations]
    ));
  const result: NormalizedCaptureRole[] = Array(timeframes.length).fill(null);
  orderedIndices.forEach((captureIndex, roleIndex) => {
    result[captureIndex] = rolesByDuration[roleIndex] ?? null;
  });
  return result;
}

function taskForm(input: CloudTaskCreateInput): FormData {
  if (input.captures.length < 1 || input.captures.length > 3) {
    throw new CloudConnectionError('invalid_image');
  }
  const timeframes = input.captures.map((capture) => capture.context.timeframe?.trim() ?? '');
  if (timeframes.some((timeframe) => !Object.hasOwn(timeframeDurations, timeframe))) {
    throw new CloudConnectionError('unsupported_timeframe');
  }
  if (new Set(timeframes).size !== timeframes.length) {
    throw new CloudConnectionError('unsupported_timeframe');
  }
  const roles = normalizedRoles(timeframes);
  const metadata = {
    outputLanguage: input.outputLanguage,
    captures: input.captures.map((capture, index) => ({
      captureId: `C${String(index + 1).padStart(2, '0')}`,
      timeframe: timeframes[index]!,
      role: roles[index]!,
      instrument: capture.context.instrument?.trim() || null,
      site: capture.context.site?.trim() || null,
      venue: capture.context.exchange?.trim() || null,
      pageType: capture.context.pageType ?? null,
      width: capture.image.width,
      height: capture.image.height,
    })),
  };
  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
    'metadata.json',
  );
  input.captures.forEach((capture, index) => {
    const extension = capture.image.mediaType === 'image/png' ? 'png' : 'jpg';
    form.append('images', imageBlob(capture), `chart-C${String(index + 1).padStart(2, '0')}.${extension}`);
  });
  return form;
}

function parseTask(value: unknown): ExtensionAnalysisTask {
  try {
    return parseExtensionAnalysisTask(value);
  } catch {
    throw taskContractError();
  }
}

function contractError(value: unknown): CloudConnectionError {
  if (value instanceof z.ZodError) {
    const paths = value.issues.map((issue) => issue.path.join('.'));
    if (paths.includes('apiVersion')) return new CloudConnectionError('incompatible_api_version');
    if (paths.includes('reportSchemaVersion')) {
      return new CloudConnectionError('incompatible_report_schema');
    }
  }
  return new CloudConnectionError('service_unavailable');
}

export function createCloudClient(fetcher: typeof fetch = fetch): CloudClient {
  async function account(token: string): Promise<ExtensionAccount> {
    validateToken(token);
    const body = await request(fetcher, '/v1/extension/account', token);
    try {
      return parseExtensionAccount(body);
    } catch (error) {
      throw contractError(error);
    }
  }

  return Object.freeze({
    async connect(token: string): Promise<ExtensionAccount> {
      validateToken(token);
      const body = await request(fetcher, '/v1/extension/capabilities');
      try {
        parseExtensionCapabilities(body);
      } catch (error) {
        throw contractError(error);
      }
      return account(token);
    },
    account,
    async captureSettings(token: string): Promise<ExtensionCaptureSettings> {
      validateToken(token);
      const body = await request(fetcher, '/v1/extension/capture-settings', token);
      try {
        return parseExtensionCaptureSettings(body);
      } catch (error) {
        throw contractError(error);
      }
    },
    async createTask(
      token: string,
      input: CloudTaskCreateInput,
    ): Promise<ExtensionAnalysisTask> {
      validateToken(token);
      const body = await request(
        fetcher,
        '/v1/extension/analysis-tasks',
        token,
        { method: 'POST', body: taskForm(input) },
      );
      return parseTask(body);
    },
    async task(
      token: string,
      requestId: string,
      signal?: AbortSignal,
    ): Promise<ExtensionAnalysisTask> {
      validateToken(token);
      const body = await request(
        fetcher,
        `/v1/extension/analysis-tasks/${encodeURIComponent(requestId)}`,
        token,
        { signal },
      );
      return parseTask(body);
    },
    async cancelTask(token: string, requestId: string): Promise<ExtensionAnalysisTask> {
      validateToken(token);
      const body = await request(
        fetcher,
        `/v1/extension/analysis-tasks/${encodeURIComponent(requestId)}/cancel`,
        token,
        { method: 'POST' },
      );
      return parseTask(body);
    },
  });
}
