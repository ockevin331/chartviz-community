import testCardDataUrl from '../../assets/provider-test-card.png?inline';
import { getModelsForProvider } from './model-catalog';
import { ProviderError, type AnalysisErrorCode } from './provider-errors';
import { attachProviderFailureDetail } from './provider-diagnostics';
import { normalizeProviderConfig, type ProviderConfig, type ProviderImage, type StructuredGenerationRequest, type StructuredVisionProvider, type ValidationResult } from './provider-types';
import { assertOpenAiConnectionResponse, extractOpenAiStructuredValue } from './response-parser';
import { parseStructuredResponse } from './structured-response';

const openAiUrl = 'https://api.openai.com/v1/responses';
const defaultTimeoutMs = 45_000;

const connectionSchema = {
  type: 'object',
  properties: { seenImage: { type: 'boolean' } },
  required: ['seenImage'],
  additionalProperties: false,
} as const;

type OpenAiProviderOptions = {
  timeoutMs?: number;
};

function invalidField(config: ProviderConfig): 'apiKey' | 'model' {
  return typeof config.apiKey !== 'string' || config.apiKey.trim() === '' ? 'apiKey' : 'model';
}

function statusCode(status: number): AnalysisErrorCode {
  if (status === 401 || status === 403) return 'invalid_api_key';
  if (status === 402) return 'insufficient_balance';
  if (status === 404) return 'model_not_found';
  if (status === 400) return 'model_not_multimodal';
  if (status === 413 || status === 415 || status === 422) return 'invalid_image';
  if (status === 429) return 'rate_limited';
  return 'invalid_response';
}

function validImageDataUrl(image: ProviderImage): boolean {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
  const encoded = match?.[2];
  return match !== null
    && match[1] === image.mediaType
    && encoded !== undefined
    && encoded.length % 4 === 0;
}

export class OpenAiProvider implements StructuredVisionProvider {
  readonly kind = 'openai' as const;
  private readonly timeoutMs: number;

  constructor(options: OpenAiProviderOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  }

  validateConfig(config: ProviderConfig): ValidationResult {
    const normalized = normalizeProviderConfig(config);
    if (normalized === null) return { ok: false, field: invalidField(config), code: 'invalid_config' };
    if (normalized.provider !== this.kind) return { ok: false, field: 'model', code: 'invalid_config' };
    if (!getModelsForProvider(this.kind).some(({ id }) => id === normalized.model)) {
      return { ok: false, field: 'model', code: 'invalid_config' };
    }
    return { ok: true };
  }

  async generateStructured<T>(config: ProviderConfig, request: StructuredGenerationRequest<T>): Promise<T> {
    if (request.image && !validImageDataUrl(request.image)) {
      throw new ProviderError('invalid_image', { params: { provider: this.kind } });
    }
    const body = this.buildBody(
      config,
      request.systemPrompt,
      request.userPrompt,
      request.image?.dataUrl,
      request.schemaName,
      request.jsonSchema,
    );
    const payload = await this.send(config, request.signal, body);
    return parseStructuredResponse(this.kind, extractOpenAiStructuredValue(payload), request.parse);
  }

  async testConnection(config: ProviderConfig, signal: AbortSignal): Promise<void> {
    const body = this.buildBody(
      config,
      'Verify only whether the supplied test-card image is visible.',
      'Return seenImage true only when the bundled ChartViz test card is visible.',
      testCardDataUrl,
      'connection_test',
      connectionSchema,
    );
    assertOpenAiConnectionResponse(await this.send(config, signal, body));
  }

  private buildBody(
    config: ProviderConfig,
    instructions: string,
    prompt: string,
    imageUrl: string | undefined,
    schemaName: string,
    schema: Record<string, unknown>,
  ): Record<string, unknown> {
    const validation = this.validateConfig(config);
    if (!validation.ok) {
      throw new ProviderError('invalid_config', { params: { field: validation.field } });
    }
    const content: Array<Record<string, unknown>> = [{ type: 'input_text', text: prompt }];
    if (imageUrl !== undefined) content.push({ type: 'input_image', image_url: imageUrl });
    return {
      model: config.model.trim(),
      instructions,
      input: [{
        role: 'user',
        content,
      }],
      text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } },
      store: false,
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
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let response: Response;
      try {
        response = await globalThis.fetch(openAiUrl, {
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

export const openAiProvider = new OpenAiProvider();
