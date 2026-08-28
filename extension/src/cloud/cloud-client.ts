import { z } from 'zod';
import type { AnalysisCapture } from '../analysis/runtime/analysis-runtime';
import type { OutputLanguage } from '../analysis/stages/shared-stage-types';
import {
  CloudConnectionError,
  describeCloudCaptures,
} from './cloud-capture-descriptors';
export {
  CloudConnectionError,
  type CloudConnectionErrorCode,
} from './cloud-capture-descriptors';
import type {
  ExtensionAccount,
  ExtensionAnalysisTask,
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
const maxCaptureBytes = 10 * 1024 * 1024;
const errorCodeSchema = z.enum([
  'authentication_required', 'invalid_token', 'token_revoked', 'token_expired',
  'insufficient_scope', 'free_trial_exhausted', 'subscription_required',
  'subscription_expired', 'quota_exhausted', 'analysis_already_active',
  'multi_timeframe_requires_advance',
  'invalid_image', 'invalid_chart_image', 'unsupported_timeframe', 'task_not_found',
  'task_failed', 'task_cancelled', 'incompatible_api_version',
  'incompatible_report_schema', 'service_unavailable',
]);
const errorSchema = z.object({
  code: errorCodeSchema,
  message: z.string().nullable().optional(),
  params: z.record(z.string(), z.union([
    z.string(), z.number(), z.boolean(), z.null(),
  ])).default({}),
  pricingUrl: z.string().optional(),
});

export type DownloadedCapture = Readonly<{
  mediaType: 'image/png';
  bytes: ArrayBuffer;
}>;

export type CloudClient = Readonly<{
  connect(token: string): Promise<ExtensionAccount>;
  account(token: string): Promise<ExtensionAccount>;
  captureSettings(token: string): Promise<ExtensionCaptureSettings>;
  createTask(token: string, input: CloudTaskCreateInput): Promise<ExtensionAnalysisTask>;
  task(token: string, requestId: string, signal?: AbortSignal): Promise<ExtensionAnalysisTask>;
  cancelTask(token: string, requestId: string): Promise<ExtensionAnalysisTask>;
  capture(
    token: string,
    requestId: string,
    captureId: 'C01' | 'C02' | 'C03',
    signal?: AbortSignal,
  ): Promise<DownloadedCapture>;
}>;

export type CloudTaskCreateInput = Readonly<{
  captures: readonly AnalysisCapture[];
  outputLanguage: OutputLanguage;
}>;

function validateToken(token: string): void {
  if (!cloudTokenPattern.test(token)) throw new CloudConnectionError('invalid_token');
}

function validateRequestId(requestId: string): void {
  if (requestId.length < 1 || requestId.length > 80) {
    throw new CloudConnectionError('task_not_found');
  }
}

function validateCaptureId(captureId: string): asserts captureId is 'C01' | 'C02' | 'C03' {
  if (captureId !== 'C01' && captureId !== 'C02' && captureId !== 'C03') {
    throw new CloudConnectionError('task_not_found');
  }
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

async function captureRequest(
  fetcher: typeof fetch,
  token: string,
  requestId: string,
  captureId: 'C01' | 'C02' | 'C03',
  signal?: AbortSignal,
): Promise<DownloadedCapture> {
  let response: Response;
  try {
    response = await fetcher(
      `${CLOUD_API_BASE_URL}/v1/extension/analysis-tasks/${encodeURIComponent(requestId)}/captures/${captureId}`,
      {
        headers: { Accept: 'image/png', Authorization: `Bearer ${token}` },
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch {
    throw new CloudConnectionError('service_unavailable');
  }
  if (!response.ok) {
    const body = await responseBody(response);
    const parsed = errorSchema.safeParse(body);
    if (!parsed.success) throw new CloudConnectionError('service_unavailable');
    throw new CloudConnectionError(
      parsed.data.code,
      parsed.data.params,
      parsed.data.pricingUrl ?? null,
    );
  }
  if (response.headers.get('content-type') !== 'image/png') {
    throw new CloudConnectionError('invalid_image');
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && /^\d+$/.test(contentLength)) {
    try {
      if (BigInt(contentLength) > BigInt(maxCaptureBytes)) {
        throw new CloudConnectionError('invalid_image');
      }
    } catch (error) {
      if (error instanceof CloudConnectionError) throw error;
    }
  }
  if (!response.body) throw new CloudConnectionError('invalid_image');
  const bytes = await boundedCaptureBytes(response.body);
  const signature = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8));
  const expectedSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.length !== expectedSignature.length || expectedSignature.some((byte, index) => signature[index] !== byte)) {
    throw new CloudConnectionError('invalid_image');
  }
  return Object.freeze({ mediaType: 'image/png', bytes });
}

async function boundedCaptureBytes(body: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    throw new CloudConnectionError('service_unavailable');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength > maxCaptureBytes - total) {
        try {
          await reader.cancel();
        } catch {
          // Cancellation is best-effort after a rejected oversized or malformed chunk.
        }
        throw new CloudConnectionError('invalid_image');
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (error) {
    if (error instanceof CloudConnectionError) throw error;
    throw new CloudConnectionError('service_unavailable');
  } finally {
    reader.releaseLock();
  }
  if (total < 1) throw new CloudConnectionError('invalid_image');
  const combined = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return combined.buffer;
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

function taskForm(input: CloudTaskCreateInput): FormData {
  const descriptors = describeCloudCaptures(input.captures);
  const metadata = {
    outputLanguage: input.outputLanguage,
    captures: descriptors.map(({ exchange, ...descriptor }) => ({ ...descriptor, venue: exchange })),
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
    async capture(
      token: string,
      requestId: string,
      captureId: 'C01' | 'C02' | 'C03',
      signal?: AbortSignal,
    ): Promise<DownloadedCapture> {
      validateToken(token);
      validateRequestId(requestId);
      validateCaptureId(captureId);
      return captureRequest(fetcher, token, requestId, captureId, signal);
    },
  });
}
