import { describe, expect, it, vi } from 'vitest';
import {
  CLOUD_API_BASE_URL,
  CloudConnectionError,
  createCloudClient,
} from '../src/cloud/cloud-client';
import type { AnalysisCapture } from '../src/analysis/runtime/analysis-runtime';
import { describeCloudCaptures } from '../src/cloud/cloud-capture-descriptors';
import taskFixture from '../contracts/extension-cloud/v1/fixtures/single-completed-task.json';

const capabilities = {
  edition: 'cloud',
  apiVersion: '1',
  reportSchemaVersion: 'extension-report-1.0',
  limits: { maxImages: 1, maxTimeframes: 1 },
  features: {
    multiTimeframe: false,
    cloudManagedModels: true,
    advancedAnnotations: true,
    taskCancellation: true,
    taskResume: true,
  },
};

const capture: AnalysisCapture = {
  image: {
    mediaType: 'image/png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    width: 1280,
    height: 720,
  },
  context: {
    instrument: 'BTC/USDT',
    timeframe: '15m',
    site: 'binance',
    exchange: 'Binance',
    pageType: 'spot-trade',
  },
};

function captureAt(timeframe: string, suffix: string): AnalysisCapture {
  return {
    image: {
      ...capture.image,
      dataUrl: `data:image/png;base64,${suffix}`,
    },
    context: { ...capture.context, timeframe },
  };
}

const account = {
  emailMasked: 'k***n@example.com',
  plan: 'advance',
  currentPeriodEnd: '2026-09-28T00:00:00+00:00',
  quota: { limit: null, used: 7, remaining: null, unlimited: true },
  selectedModel: { id: 'openai/gpt-5.4', name: 'GPT-5.4', quotaCost: 2 },
  entitlements: { multiTimeframe: true, maxCaptures: 3 },
};

const captureSettings = {
  timeframes: [
    { role: 'context', timeframe: '1d' },
    { role: 'setup', timeframe: '4h' },
    { role: 'trigger', timeframe: '5m' },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const maxCaptureBytes = 10 * 1024 * 1024;

function pngResponse(bytes: Uint8Array = pngBytes, contentType = 'image/png'): Response {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(body.buffer, { status: 200, headers: { 'Content-Type': contentType } });
}

function chunkedPng(totalBytes: number): readonly Uint8Array[] {
  const chunks: Uint8Array[] = [pngBytes.subarray(0, 8)];
  const reusableChunk = new Uint8Array(64 * 1024);
  let remaining = totalBytes - 8;
  while (remaining > 0) {
    const size = Math.min(remaining, reusableChunk.byteLength);
    chunks.push(size === reusableChunk.byteLength ? reusableChunk : new Uint8Array(size));
    remaining -= size;
  }
  return chunks;
}

function chunkedResponse(
  chunks: readonly Uint8Array[],
  options: Readonly<{ contentLength?: string; contentType?: string }> = {},
): Readonly<{ response: Response; cancel: ReturnType<typeof vi.fn> }> {
  let index = 0;
  const cancel = vi.fn();
  const releaseLock = vi.fn();
  const headers = new Headers({ 'Content-Type': options.contentType ?? 'image/png' });
  if (options.contentLength !== undefined) headers.set('Content-Length', options.contentLength);
  const reader = {
    read: vi.fn(async () => {
      const chunk = chunks[index++];
      return chunk === undefined ? { done: true, value: undefined } : { done: false, value: chunk };
    }),
    cancel,
    releaseLock,
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
  return {
    response: {
      ok: true,
      headers,
      body: { getReader: () => reader },
    } as unknown as Response,
    cancel,
  };
}

describe('fixed-origin ChartViz Cloud client', () => {
  it('validates capabilities before requesting the authenticated account', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse(capabilities))
      .mockResolvedValueOnce(jsonResponse(account));
    const client = createCloudClient(fetcher);
    const token = `cv_live_${'x'.repeat(43)}`;

    await expect(client.connect(token)).resolves.toEqual(account);

    expect(fetcher).toHaveBeenNthCalledWith(1,
      `${CLOUD_API_BASE_URL}/v1/extension/capabilities`,
      { headers: { Accept: 'application/json' } },
    );
    expect(fetcher).toHaveBeenNthCalledWith(2,
      `${CLOUD_API_BASE_URL}/v1/extension/account`,
      { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
    );
    expect(JSON.stringify(fetcher.mock.calls.map(([url]) => url))).not.toContain(token);
  });

  it('refreshes an account without calling any analysis endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(account));
    const client = createCloudClient(fetcher);

    await expect(client.account(`cv_live_${'y'.repeat(43)}`)).resolves.toEqual(account);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${CLOUD_API_BASE_URL}/v1/extension/account`);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('analysis-tasks');
  });

  it('reads strict website-managed capture settings with the Cloud token', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(captureSettings));
    const token = `cv_live_${'m'.repeat(43)}`;

    await expect(createCloudClient(fetcher).captureSettings(token)).resolves.toEqual(captureSettings);

    expect(fetcher).toHaveBeenCalledWith(
      `${CLOUD_API_BASE_URL}/v1/extension/capture-settings`,
      { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
    );
  });

  it.each([
    [{ ...capabilities, apiVersion: '2' }, 'incompatible_api_version'],
    [{ ...capabilities, reportSchemaVersion: 'extension-report-2.0' }, 'incompatible_report_schema'],
    [{ ...capabilities, extra: true }, 'service_unavailable'],
  ])('rejects incompatible or malformed capabilities', async (payload, code) => {
    const client = createCloudClient(vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(client.connect(`cv_live_${'x'.repeat(43)}`)).rejects.toMatchObject({ code });
  });

  it('rejects malformed account fields instead of trusting the service response', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse(capabilities))
      .mockResolvedValueOnce(jsonResponse({ ...account, plan: 'enterprise' }));

    await expect(createCloudClient(fetcher).connect(`cv_live_${'x'.repeat(43)}`))
      .rejects.toMatchObject({ code: 'service_unavailable' });
  });

  it('maps stable API errors without including token or response body in the error message', async () => {
    const token = `cv_live_${'sensitive'.repeat(6)}`;
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      code: 'token_revoked',
      params: { reason: 'manual' },
      debug: `do not expose ${token}`,
    }, 401));

    const operation = createCloudClient(fetcher).account(token);

    await expect(operation).rejects.toEqual(expect.objectContaining({
      code: 'token_revoked', params: { reason: 'manual' },
    }));
    await expect(operation).rejects.toBeInstanceOf(CloudConnectionError);
    await expect(operation).rejects.not.toThrow(token);
  });

  it('rejects a non-Cloud token before making a network request', async () => {
    const fetcher = vi.fn();

    await expect(createCloudClient(fetcher).connect('website-session'))
      .rejects.toMatchObject({ code: 'invalid_token' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('creates one task with multipart image data and strict metadata', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      requestId: 'c_20260828_new',
      status: 'pending',
      progressEvents: [{ code: 'preparing', createdAt: '2026-08-28T00:00:00Z' }],
      report: null,
      error: null,
    }, 202));
    const token = `cv_live_${'c'.repeat(43)}`;

    const task = await createCloudClient(fetcher).createTask(token, {
      captures: [capture],
      outputLanguage: 'en',
    });

    expect(task.status).toBe('pending');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${CLOUD_API_BASE_URL}/v1/extension/analysis-tasks`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    });
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.getAll('images')).toHaveLength(1);
    expect(form.get('images')).toBeInstanceOf(Blob);
    const metadata = JSON.parse(await (form.get('metadata') as Blob).text());
    expect(metadata).toEqual({
      outputLanguage: 'en',
      captures: describeCloudCaptures([capture]).map(({ exchange, ...descriptor }) => ({
        ...descriptor, venue: exchange,
      })),
    });
    expect(JSON.stringify(metadata)).not.toContain(capture.image.dataUrl);
  });

  it('uploads three images in capture order with duration-normalized roles', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      requestId: 'c_20260828_multi', status: 'pending', progressEvents: [],
      report: null, error: null,
    }, 202));
    const captures = [
      captureAt('4h', 'AAAA'),
      captureAt('1h', 'BBBB'),
      captureAt('15m', 'CCCC'),
    ];

    await createCloudClient(fetcher).createTask(`cv_live_${'m'.repeat(43)}`, {
      captures,
      outputLanguage: 'en',
    });

    const form = (fetcher.mock.calls[0]?.[1] as RequestInit).body as FormData;
    const metadata = JSON.parse(await (form.get('metadata') as Blob).text());
    expect(form.getAll('images')).toHaveLength(3);
    expect(await Promise.all(form.getAll('images').map(async (part) =>
      Array.from(new Uint8Array(await (part as Blob).arrayBuffer()))
    ))).toEqual([
      [0, 0, 0],
      [4, 16, 65],
      [8, 32, 130],
    ]);
    expect(metadata.captures.map((item: Record<string, unknown>) => ({
      captureId: item.captureId,
      timeframe: item.timeframe,
      role: item.role,
    }))).toEqual([
      { captureId: 'C01', timeframe: '4h', role: 'context' },
      { captureId: 'C02', timeframe: '1h', role: 'setup' },
      { captureId: 'C03', timeframe: '15m', role: 'trigger' },
    ]);
  });

  it('normalizes two captures by canonical duration without reordering multipart images', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      requestId: 'c_20260828_two', status: 'pending', progressEvents: [],
      report: null, error: null,
    }, 202));

    await createCloudClient(fetcher).createTask(`cv_live_${'n'.repeat(43)}`, {
      captures: [captureAt('15m', 'AAAA'), captureAt('4h', 'BBBB')],
      outputLanguage: 'zh-CN',
    });

    const form = (fetcher.mock.calls[0]?.[1] as RequestInit).body as FormData;
    const metadata = JSON.parse(await (form.get('metadata') as Blob).text());
    expect(metadata.captures.map((item: Record<string, unknown>) => ({
      captureId: item.captureId, timeframe: item.timeframe, role: item.role,
    }))).toEqual([
      { captureId: 'C01', timeframe: '15m', role: 'setup_and_trigger' },
      { captureId: 'C02', timeframe: '4h', role: 'context' },
    ]);
  });

  it.each([
    { captures: [], code: 'invalid_image' },
    { captures: [captureAt('4h', 'AAAA'), captureAt('4h', 'BBBB')], code: 'unsupported_timeframe' },
    { captures: [captureAt('45m', 'AAAA')], code: 'unsupported_timeframe' },
    { captures: [captureAt('toString', 'AAAA')], code: 'unsupported_timeframe' },
    { captures: [{ ...capture, context: { ...capture.context, timeframe: '  ' } }], code: 'unsupported_timeframe' },
    {
      captures: [
        captureAt('1d', 'AAAA'), captureAt('4h', 'BBBB'),
        captureAt('1h', 'CCCC'), captureAt('15m', 'DDDD'),
      ],
      code: 'invalid_image',
    },
  ])('rejects invalid capture sets locally before a request', async ({ captures, code }) => {
    const fetcher = vi.fn();

    await expect(createCloudClient(fetcher).createTask(`cv_live_${'v'.repeat(43)}`, {
      captures,
      outputLanguage: 'en',
    })).rejects.toMatchObject({ code });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads and cancels the exact scoped task path', async () => {
    const fetcher = vi.fn().mockImplementation(async () => jsonResponse(taskFixture));
    const client = createCloudClient(fetcher);
    const token = `cv_live_${'r'.repeat(43)}`;

    await client.task(token, 'c_20260828_123');
    await client.cancelTask(token, 'c_20260828_123');

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `${CLOUD_API_BASE_URL}/v1/extension/analysis-tasks/c_20260828_123`,
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      `${CLOUD_API_BASE_URL}/v1/extension/analysis-tasks/c_20260828_123/cancel`,
    );
    expect((fetcher.mock.calls[1]?.[1] as RequestInit).method).toBe('POST');
  });

  it('maps malformed tasks to an incompatible report schema without leaking payloads', async () => {
    const token = `cv_live_${'z'.repeat(43)}`;
    const secretImage = 'data:image/png;base64,SECRET';
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      ...taskFixture,
      report: { ...taskFixture.report, internalPrompt: secretImage },
    }));

    const operation = createCloudClient(fetcher).task(token, 'c_20260828_123');

    await expect(operation).rejects.toMatchObject({ code: 'incompatible_report_schema' });
    await expect(operation).rejects.not.toThrow(token);
    await expect(operation).rejects.not.toThrow(secretImage);
  });

  it('downloads an authenticated PNG capture using the fixed Cloud origin and abort signal', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockResolvedValue(pngResponse());
    const token = `cv_live_${'d'.repeat(43)}`;

    await expect(createCloudClient(fetcher).capture(
      token, 'c_20260828_capture', 'C02', controller.signal,
    )).resolves.toEqual({ mediaType: 'image/png', bytes: pngBytes.buffer });

    expect(fetcher).toHaveBeenCalledWith(
      `${CLOUD_API_BASE_URL}/v1/extension/analysis-tasks/c_20260828_capture/captures/C02`,
      {
        headers: { Accept: 'image/png', Authorization: `Bearer ${token}` },
        signal: controller.signal,
      },
    );
  });

  it.each([
    ['wrong content type', pngResponse(pngBytes, 'image/jpeg')],
    ['parameterized PNG content type', pngResponse(pngBytes, 'image/png; charset=binary')],
    ['missing PNG body', new Response(null, {
      status: 200, headers: { 'Content-Type': 'image/png' },
    })],
    ['empty PNG response', pngResponse(new Uint8Array())],
    ['bad PNG signature', pngResponse(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))],
  ])('classifies a deterministic %s as an invalid image', async (_name, response) => {
    await expect(createCloudClient(vi.fn().mockResolvedValue(response)).capture(
      `cv_live_${'b'.repeat(43)}`, 'c_20260828_capture', 'C01',
    )).rejects.toMatchObject({ code: 'invalid_image' });
  });

  it('rejects an oversized declared Content-Length before reading the body', async () => {
    const getReader = vi.fn();
    const arrayBuffer = vi.fn();
    const response = {
      ok: true,
      headers: new Headers({
        'Content-Type': 'image/png',
        'Content-Length': String(maxCaptureBytes + 1),
      }),
      body: { getReader },
      arrayBuffer,
    } as unknown as Response;

    await expect(createCloudClient(vi.fn().mockResolvedValue(response)).capture(
      `cv_live_${'l'.repeat(43)}`, 'c_20260828_capture', 'C01',
    )).rejects.toMatchObject({ code: 'invalid_image' });

    expect(getReader).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it.each([
    ['absent', undefined],
    ['invalid', 'ten megabytes'],
    ['lying-small', '9'],
  ])('uses actual bytes when Content-Length is %s', async (_name, contentLength) => {
    const streamed = chunkedResponse(chunkedPng(maxCaptureBytes + 1), { contentLength });

    await expect(createCloudClient(vi.fn().mockResolvedValue(streamed.response)).capture(
      `cv_live_${'a'.repeat(43)}`, 'c_20260828_capture', 'C01',
    )).rejects.toMatchObject({ code: 'invalid_image' });

    expect(streamed.cancel).toHaveBeenCalledTimes(1);
  });

  it('accepts an exact 10 MiB PNG streamed in chunks', async () => {
    const streamed = chunkedResponse(chunkedPng(maxCaptureBytes), {
      contentLength: String(maxCaptureBytes),
    });

    await expect(createCloudClient(vi.fn().mockResolvedValue(streamed.response)).capture(
      `cv_live_${'m'.repeat(43)}`, 'c_20260828_capture', 'C01',
    )).resolves.toMatchObject({ mediaType: 'image/png', bytes: expect.any(ArrayBuffer) });

    expect(streamed.cancel).not.toHaveBeenCalled();
  });

  it.each([
    ['an aborted fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'))],
    ['a stream read error', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.error(new Error('stream failure')); },
    }), { status: 200, headers: { 'Content-Type': 'image/png' } }))],
  ])('sanitizes %s', async (_name, fetcher) => {
    await expect(createCloudClient(fetcher).capture(
      `cv_live_${'s'.repeat(43)}`, 'c_20260828_capture', 'C01',
    )).rejects.toMatchObject({ code: 'service_unavailable' });
  });

  it('preserves service unavailable for an HTTP 5xx capture response', async () => {
    await expect(createCloudClient(vi.fn().mockResolvedValue(jsonResponse({
      code: 'service_unavailable', params: {},
    }, 503))).capture(`cv_live_${'s'.repeat(43)}`, 'c_20260828_capture', 'C01'))
      .rejects.toMatchObject({ code: 'service_unavailable' });
  });

  it('parses the stable JSON error envelope from a failed capture download', async () => {
    await expect(createCloudClient(vi.fn().mockResolvedValue(jsonResponse({
      code: 'task_not_found', params: {},
    }, 404))).capture(`cv_live_${'e'.repeat(43)}`, 'c_20260828_capture', 'C01'))
      .rejects.toMatchObject({ code: 'task_not_found' });
  });

  it.each([
    ['token', 'website-session', 'c_20260828_capture', 'C01'],
    ['request ID', `cv_live_${'i'.repeat(43)}`, '', 'C01'],
    ['capture ID', `cv_live_${'i'.repeat(43)}`, 'c_20260828_capture', 'C99'],
  ])('rejects an invalid %s before downloading', async (_name, token, requestId, captureId) => {
    const fetcher = vi.fn();

    await expect(createCloudClient(fetcher).capture(token, requestId, captureId as 'C01')).rejects
      .toMatchObject({ code: _name === 'token' ? 'invalid_token' : 'task_not_found' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
