import { describe, expect, it, vi } from 'vitest';
import {
  CLOUD_API_BASE_URL,
  CloudConnectionError,
  createCloudClient,
} from '../src/cloud/cloud-client';
import type { AnalysisCapture } from '../src/analysis/runtime/analysis-runtime';
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
      captures: [{
        captureId: 'C01', timeframe: '15m', role: null,
        instrument: 'BTC/USDT', site: 'binance', venue: 'Binance',
        pageType: 'spot-trade', width: 1280, height: 720,
      }],
    });
    expect(JSON.stringify(metadata)).not.toContain(capture.image.dataUrl);
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
});
