import { z } from 'zod';

import type { ExtensionEdition } from '../config/edition';

export const backendCapabilitiesSchema = z.object({
  edition: z.enum(['cloud', 'community']),
  apiVersion: z.literal('1'),
  reportSchemaVersion: z.literal('1.3'),
  limits: z.object({
    maxImages: z.number().int().positive(),
    maxTimeframes: z.number().int().positive(),
  }),
  features: z.object({
    multiTimeframe: z.boolean(),
    marketDataFusion: z.boolean(),
    advancedAnnotations: z.boolean(),
    cloudAuthentication: z.boolean(),
    billing: z.boolean(),
  }),
});

export type BackendCapabilities = z.infer<typeof backendCapabilitiesSchema>;

export class BackendCapabilityError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'BackendCapabilityError';
  }
}

function recordValue(payload: unknown, key: string): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  return (payload as Record<string, unknown>)[key];
}

export function parseCompatibleCapabilities(
  payload: unknown,
  expectedEdition: ExtensionEdition,
): BackendCapabilities {
  const apiVersion = recordValue(payload, 'apiVersion');
  if (typeof apiVersion === 'string' && apiVersion !== '1') {
    throw new BackendCapabilityError('incompatible_api_version');
  }

  const reportSchemaVersion = recordValue(payload, 'reportSchemaVersion');
  if (typeof reportSchemaVersion === 'string' && reportSchemaVersion !== '1.3') {
    throw new BackendCapabilityError('incompatible_report_schema');
  }

  const edition = recordValue(payload, 'edition');
  if ((edition === 'cloud' || edition === 'community') && edition !== expectedEdition) {
    throw new BackendCapabilityError('unexpected_backend_edition');
  }

  const parsed = backendCapabilitiesSchema.safeParse(payload);
  if (!parsed.success) {
    throw new BackendCapabilityError('invalid_capability_response');
  }
  return parsed.data;
}
