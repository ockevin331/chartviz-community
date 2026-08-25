import testCardDataUrl from '../../assets/provider-test-card.png?inline';
import { communityJsonSchema } from '../analysis/community-json-schema';
import type { CommunityReport } from '../analysis/community-report';
import { getModelsForProvider } from './model-catalog';
import { ProviderError, type AnalysisErrorCode } from './provider-errors';
import { normalizeProviderConfig, type ProviderConfig, type ValidationResult, type VisionProvider, type VisionRequest } from './provider-types';
import { assertGeminiConnectionResponse, parseGeminiCommunityResponse } from './response-parser';

const defaultTimeoutMs = 45_000;

const connectionSchema = {
  type: 'object',
  properties: { seenImage: { type: 'boolean' } },
  required: ['seenImage'],
  additionalProperties: false,
} as const;

type GeminiProviderOptions = {
  timeoutMs?: number;
};

type InlineImage = {
  mimeType: VisionRequest['image']['mediaType'];
  data: string;
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

function parseInlineImage(image: VisionRequest['image']): InlineImage {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
  const encoded = match?.[2];
  if (match === null || match[1] !== image.mediaType || encoded === undefined || encoded.length % 4 !== 0) {
    throw new ProviderError('invalid_image', { params: { provider: 'gemini' } });
  }
  return { mimeType: image.mediaType, data: encoded };
}

export class GeminiProvider implements VisionProvider {
  readonly kind = 'gemini' as const;
  private readonly timeoutMs: number;

  constructor(options: GeminiProviderOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  }

  validateConfig(config: ProviderConfig): ValidationResult {
    const normalized = normalizeProviderConfig(config);
    if (normalized === null) return { ok: false, field: invalidField(config), code: 'invalid_config' };
    if (normalized.provider !== this.kind) return { ok: false, field: 'model', code: 'invalid_config' };
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
      request.prompt.user,
      parseInlineImage(request.image),
      communityJsonSchema,
    );
    const normalizedConfig = { ...config, model: config.model.trim() };
    return parseGeminiCommunityResponse(await this.send(normalizedConfig, request.signal, body));
  }

  async testConnection(config: ProviderConfig, signal: AbortSignal): Promise<void> {
    const body = this.buildBody(
      config,
      'Verify only whether the supplied test-card image is visible.',
      'Return seenImage true only when the bundled ChartViz test card is visible.',
      parseInlineImage({ mediaType: 'image/png', dataUrl: testCardDataUrl }),
      connectionSchema,
    );
    const normalizedConfig = { ...config, model: config.model.trim() };
    assertGeminiConnectionResponse(await this.send(normalizedConfig, signal, body));
  }

  private buildBody(
    config: ProviderConfig,
    systemPrompt: string,
    userPrompt: string,
    image: InlineImage,
    schema: Record<string, unknown>,
  ): Record<string, unknown> {
    const validation = this.validateConfig(config);
    if (!validation.ok) {
      throw new ProviderError('invalid_config', { params: { field: validation.field } });
    }
    return {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{
        role: 'user',
        parts: [
          { text: userPrompt },
          { inlineData: image },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        candidateCount: 1,
      },
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
        response = await globalThis.fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': config.apiKey.trim(),
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );
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

export const geminiProvider = new GeminiProvider();
