import { describe, expect, it, vi } from 'vitest';
import {
  CLOUD_API_BASE_URL,
  CloudConnectionError,
  createCloudClient,
} from '../src/cloud/cloud-client';

const capabilities = {
  edition: 'cloud',
  apiVersion: '1',
  reportSchemaVersion: 'extension-report-1.0',
  limits: { maxImages: 3, maxTimeframes: 3 },
  features: {
    multiTimeframe: true,
    cloudManagedModels: true,
    advancedAnnotations: true,
    taskCancellation: true,
    taskResume: true,
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
});
