import { z } from 'zod';
import type { ExtensionAccount, ExtensionApiError } from './contracts/extension-cloud-v1';
import {
  parseExtensionAccount,
  parseExtensionCapabilities,
} from './cloud-account-schema';

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
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetcher(`${CLOUD_API_BASE_URL}${path}`, { headers });
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
  });
}
