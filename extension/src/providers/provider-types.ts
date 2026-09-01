import type { ProviderTrace } from './openrouter-trace';

export type ProviderKind = 'openrouter' | 'openai';

export type ProviderConfig = {
  provider: ProviderKind;
  apiKey: string;
  model: string;
  customModel: false;
};

export type SupportedImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp';

export type ProviderImage = {
  mediaType: SupportedImageMediaType;
  dataUrl: string;
};

export type StructuredGenerationRequest<T> = {
  systemPrompt: string;
  userPrompt: string;
  image?: ProviderImage;
  timeoutMs?: number;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  parse(value: unknown): T;
  signal: AbortSignal;
  onTrace?(trace: ProviderTrace): void;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; field: 'apiKey' | 'model'; code: 'invalid_config' };

interface ProviderTransport {
  readonly kind: ProviderKind;
  validateConfig(config: ProviderConfig): ValidationResult;
  testConnection(config: ProviderConfig, signal: AbortSignal): Promise<void>;
}

export interface StructuredVisionProvider extends ProviderTransport {
  generateStructured<T>(config: ProviderConfig, request: StructuredGenerationRequest<T>): Promise<T>;
}

const providerKinds = new Set<ProviderKind>(['openrouter', 'openai']);
const configKeys = ['apiKey', 'customModel', 'model', 'provider'];

export function normalizeProviderConfig(value: unknown): ProviderConfig | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join('\0') !== configKeys.join('\0')) return null;
  if (typeof record.provider !== 'string' || !providerKinds.has(record.provider as ProviderKind)) return null;
  if (typeof record.apiKey !== 'string' || typeof record.model !== 'string' || record.customModel !== false) {
    return null;
  }

  const apiKey = record.apiKey.trim();
  const model = record.model.trim();
  if (apiKey === '' || model === '') return null;
  return {
    provider: record.provider as ProviderKind,
    apiKey,
    model,
    customModel: false,
  };
}
