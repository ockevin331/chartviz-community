import testCardDataUrl from '../../assets/provider-test-card.png?inline';
import { getModelsForProvider } from './model-catalog';
import { ProviderError, type AnalysisErrorCode } from './provider-errors';
import { attachProviderFailureDetail } from './provider-diagnostics';
import { normalizeProviderConfig, type ProviderConfig, type StructuredGenerationRequest, type StructuredVisionProvider, type ValidationResult } from './provider-types';
import { assertOpenRouterConnectionResponse, extractOpenRouterStructuredValue } from './response-parser';
import { parseStructuredResponse } from './structured-response';

const openRouterUrl = 'https://openrouter.ai/api/v1/chat/completions';
const defaultTimeoutMs = 45_000;

const connectionSchema = {
  type: 'object',
  properties: { seenImage: { type: 'boolean' } },
  required: ['seenImage'],
  additionalProperties: false,
} as const;

type OpenRouterProviderOptions = {
  timeoutMs?: number;
};

type RequestContent = Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
>;

const unsupportedGeminiSchemaKeywords = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'pattern',
]);

function geminiCompatibleSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(geminiCompatibleSchema);
  const record = objectRecord(value);
  if (!record) return value;
  const compatible: Record<string, unknown> = {};
  Object.entries(record).forEach(([key, entry]) => {
    if (unsupportedGeminiSchemaKeywords.has(key)) return;
    if (key === 'const') {
      compatible.enum = [geminiCompatibleSchema(entry)];
      return;
    }
    compatible[key] = geminiCompatibleSchema(entry);
  });
  return compatible;
}

function schemaForModel(model: string, schema: Record<string, unknown>): Record<string, unknown> {
  return /(?:^|\/)gemini-/i.test(model)
    ? geminiCompatibleSchema(schema) as Record<string, unknown>
    : schema;
}

function invalidField(config: ProviderConfig): 'apiKey' | 'model' {
  return typeof config.apiKey !== 'string' || config.apiKey.trim() === '' ? 'apiKey' : 'model';
}

function statusCode(status: number): AnalysisErrorCode {
  if (status === 401 || status === 403) return 'invalid_api_key';
  if (status === 402) return 'insufficient_balance';
  if (status === 404) return 'model_not_found';
  if (status === 400) return 'provider_request_rejected';
  if (status === 413 || status === 415 || status === 422) return 'invalid_image';
  if (status === 429) return 'rate_limited';
  return 'invalid_response';
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function errorMessage(payload: unknown): string | undefined {
  const root = objectRecord(payload);
  if (!root) return typeof payload === 'string' ? payload : undefined;
  const error = root.error;
  if (typeof error === 'string') return error;
  const nested = objectRecord(error);
  if (typeof nested?.message === 'string') return nested.message;
  return typeof root.message === 'string' ? root.message : undefined;
}

function rawProviderMessage(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return errorMessage(raw);
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    return errorMessage(JSON.parse(trimmed)) ?? trimmed;
  } catch {
    return trimmed;
  }
}

function openRouterErrorMessage(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const root = payload as Record<string, unknown>;
  const error = root.error;
  if (typeof error === 'string') return error;
  if (error !== null && typeof error === 'object' && !Array.isArray(error)) {
    const errorRecord = error as Record<string, unknown>;
    const message = typeof errorRecord.message === 'string' ? errorRecord.message : undefined;
    const metadata = objectRecord(errorRecord.metadata);
    const upstreamMessage = rawProviderMessage(metadata?.raw);
    if (upstreamMessage && (!message || /^provider returned error$/i.test(message.trim()))) {
      const providerName = typeof metadata?.provider_name === 'string'
        ? metadata.provider_name.trim()
        : '';
      return providerName ? `${providerName}: ${upstreamMessage}` : upstreamMessage;
    }
    if (message) return message;
  }
  return typeof root.message === 'string' ? root.message : undefined;
}

function explicitlyRejectsImageInput(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  const mentionsImage = /\b(?:image|vision|multimodal)\b/.test(normalized);
  const rejectsCapability = /\b(?:unsupported|not supported|does not support|doesn't support|not multimodal|text[- ]only)\b/.test(normalized);
  return mentionsImage && rejectsCapability;
}

async function openRouterRejection(response: Response): Promise<ProviderError> {
  let message: string | undefined;
  try {
    message = openRouterErrorMessage(await response.json());
  } catch {
    // The status still provides a deterministic fallback when the error body is unavailable.
  }
  const error = new ProviderError(
    explicitlyRejectsImageInput(message) ? 'model_not_multimodal' : 'provider_request_rejected',
    { params: { provider: 'openrouter' }, httpStatus: response.status },
  );
  if (!message) return error;
  return attachProviderFailureDetail(error, {
    stage: 'transport',
    issues: [{ path: 'provider.http.error', code: 'request_rejected', valuePreview: message }],
  });
}

export class OpenRouterProvider implements StructuredVisionProvider {
  readonly kind = 'openrouter' as const;
  private readonly timeoutMs: number;

  constructor(options: OpenRouterProviderOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  }

  validateConfig(config: ProviderConfig): ValidationResult {
    const normalized = normalizeProviderConfig(config);
    if (normalized === null) {
      return { ok: false, field: invalidField(config), code: 'invalid_config' };
    }
    if (normalized.provider !== this.kind) {
      return { ok: false, field: 'model', code: 'invalid_config' };
    }
    if (!normalized.customModel
      && !getModelsForProvider(this.kind).some(({ id }) => id === normalized.model)) {
      return { ok: false, field: 'model', code: 'invalid_config' };
    }
    return { ok: true };
  }

  async generateStructured<T>(config: ProviderConfig, request: StructuredGenerationRequest<T>): Promise<T> {
    const userContent: RequestContent = [{ type: 'text', text: request.userPrompt }];
    if (request.image) {
      userContent.push({ type: 'image_url', image_url: { url: request.image.dataUrl } });
    }
    const body = this.buildBody(
      config,
      request.systemPrompt,
      userContent,
      request.schemaName,
      request.jsonSchema,
    );
    const payload = await this.send(config, request.signal, body);
    return parseStructuredResponse(this.kind, extractOpenRouterStructuredValue(payload), request.parse);
  }

  async testConnection(config: ProviderConfig, signal: AbortSignal): Promise<void> {
    const body = this.buildBody(
      config,
      'Verify only whether the supplied test-card image is visible.',
      [
        { type: 'text', text: 'Return seenImage true only when the bundled ChartViz test card is visible.' },
        { type: 'image_url', image_url: { url: testCardDataUrl } },
      ],
      'connection_test',
      connectionSchema,
    );
    const payload = await this.send(config, signal, body);
    assertOpenRouterConnectionResponse(payload);
  }

  private buildBody(
    config: ProviderConfig,
    systemPrompt: string,
    userContent: RequestContent,
    schemaName: string,
    schema: Record<string, unknown>,
  ): Record<string, unknown> {
    const validation = this.validateConfig(config);
    if (!validation.ok) {
      throw new ProviderError('invalid_config', { params: { field: validation.field } });
    }
    const model = config.model.trim();
    return {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName, strict: true, schema: schemaForModel(model, schema) },
      },
      provider: { require_parameters: true },
    };
  }

  private async send(
    config: ProviderConfig,
    suppliedSignal: AbortSignal,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    if (suppliedSignal.aborted) {
      throw new ProviderError('cancelled', { params: { provider: this.kind } });
    }

    const controller = new AbortController();
    const cancel = () => controller.abort();
    suppliedSignal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      let response: Response;
      try {
        response = await globalThis.fetch(openRouterUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey.trim()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch {
        if (suppliedSignal.aborted) {
          throw new ProviderError('cancelled', { params: { provider: this.kind } });
        }
        throw new ProviderError('network_timeout', { params: { provider: this.kind } });
      }

      if (!response.ok) {
        if (response.status === 400) throw await openRouterRejection(response);
        throw new ProviderError(statusCode(response.status), {
          params: { provider: this.kind },
          httpStatus: response.status,
        });
      }

      const rawBody = typeof response.clone === 'function'
        ? response.clone().text().catch(() => undefined)
        : Promise.resolve(undefined);
      try {
        return await response.json();
      } catch {
        if (suppliedSignal.aborted) {
          throw new ProviderError('cancelled', { params: { provider: this.kind } });
        }
        if (controller.signal.aborted) {
          throw new ProviderError('network_timeout', { params: { provider: this.kind } });
        }
        const providerOutput = await rawBody;
        throw attachProviderFailureDetail(
          new ProviderError('invalid_response', { params: { provider: this.kind } }),
          {
            stage: 'json_parse',
            issues: [{ path: 'provider.http.body', code: 'invalid_json' }],
            ...(providerOutput === undefined ? {} : { providerOutput }),
          },
        );
      }
    } finally {
      clearTimeout(timer);
      suppliedSignal.removeEventListener('abort', cancel);
    }
  }
}

export const openRouterProvider = new OpenRouterProvider();
