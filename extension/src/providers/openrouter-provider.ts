import testCardDataUrl from '../../assets/provider-test-card.png?inline';
import { communityJsonSchema } from '../analysis/community-json-schema';
import type { CommunityReport } from '../analysis/community-report';
import { getModelsForProvider } from './model-catalog';
import { ProviderError, type AnalysisErrorCode } from './provider-errors';
import { normalizeProviderConfig, type ProviderConfig, type ValidationResult, type VisionProvider, type VisionRequest } from './provider-types';
import { assertOpenRouterConnectionResponse, parseOpenRouterCommunityResponse } from './response-parser';

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

export class OpenRouterProvider implements VisionProvider {
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

  async analyze(config: ProviderConfig, request: VisionRequest): Promise<CommunityReport> {
    const body = this.buildBody(
      config,
      request.prompt.system,
      [
        { type: 'text', text: request.prompt.user },
        { type: 'image_url', image_url: { url: request.image.dataUrl } },
      ],
      'community_report',
      communityJsonSchema,
    );
    const payload = await this.send(config, request.signal, body);
    return parseOpenRouterCommunityResponse(payload);
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
    return {
      model: config.model.trim(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName, strict: true, schema },
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
        throw new ProviderError(statusCode(response.status), {
          params: { provider: this.kind },
          httpStatus: response.status,
        });
      }

      try {
        return await response.json();
      } catch {
        if (suppliedSignal.aborted) {
          throw new ProviderError('cancelled', { params: { provider: this.kind } });
        }
        if (controller.signal.aborted) {
          throw new ProviderError('network_timeout', { params: { provider: this.kind } });
        }
        throw new ProviderError('invalid_response', { params: { provider: this.kind } });
      }
    } finally {
      clearTimeout(timer);
      suppliedSignal.removeEventListener('abort', cancel);
    }
  }
}

export const openRouterProvider = new OpenRouterProvider();
