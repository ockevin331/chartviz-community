import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { communityReportV3JsonSchema, parseCommunityReportV3, type CommunityReportV3 } from '../src/analysis/stages/community-report-v3';
import { ProviderError, type AnalysisErrorCode } from '../src/providers/provider-errors';
import { getProviderFailureDetail } from '../src/providers/provider-diagnostics';
import { OpenRouterProvider } from '../src/providers/openrouter-provider';
import type { ProviderConfig, StructuredGenerationRequest } from '../src/providers/provider-types';
import { communityReport } from './community-ui-fixtures';

const validReport = communityReport;

const config: ProviderConfig = {
  provider: 'openrouter',
  apiKey: 'unit-test-placeholder',
  model: ' openai/gpt-5.6-terra ',
  customModel: false,
};

const anthropicConfig: ProviderConfig = {
  provider: 'openrouter',
  apiKey: 'unit-test-placeholder',
  model: ' anthropic/claude-opus-5 ',
  customModel: false,
};

function request(signal = new AbortController().signal): StructuredGenerationRequest<CommunityReportV3> {
  return {
    image: { mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' },
    systemPrompt: 'Screenshot-only system prompt.',
    userPrompt: 'Analyze this screenshot.',
    schemaName: 'community_report',
    jsonSchema: communityReportV3JsonSchema,
    parse: parseCommunityReportV3,
    signal,
  };
}

function successfulResponse(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function envelopeResponse(envelope: unknown): Response {
  return new Response(JSON.stringify(envelope), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function fetchCallBody(fetchImpl: ReturnType<typeof vi.fn>): Record<string, any> {
  const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

function providerWithFetch(fetchImpl: ReturnType<typeof vi.fn>, timeoutMs?: number): OpenRouterProvider {
  vi.stubGlobal('fetch', fetchImpl);
  return new OpenRouterProvider(timeoutMs === undefined ? {} : { timeoutMs });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('OpenRouter analyze', () => {
  it('makes exactly one fixed-origin request with prompt before image and the shared strict schema', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      successfulResponse(JSON.stringify(validReport))
    ));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.generateStructured(config, request())).resolves.toEqual(validReport);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer unit-test-placeholder',
      'Content-Type': 'application/json',
      'X-OpenRouter-Metadata': 'enabled',
    });
    const body = fetchCallBody(fetchImpl);
    expect(body.model).toBe('openai/gpt-5.6-terra');
    expect(body.messages).toEqual([
      { role: 'system', content: 'Screenshot-only system prompt.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this screenshot.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ],
      },
    ]);
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'community_report', strict: true, schema: communityReportV3JsonSchema },
    });
    expect(body.provider).toEqual({ require_parameters: true });
    expect(JSON.stringify(body)).not.toContain(config.apiKey);
  });

  it('uses OpenRouter Chat Completions structured outputs for Anthropic without mutating the application schema', async () => {
    const applicationSchema = {
      type: 'object',
      properties: {
        score: { type: 'number', minimum: 0, maximum: 1, description: 'Visible confidence.' },
      },
      required: ['score'],
      additionalProperties: false,
    } satisfies Record<string, unknown>;
    const originalSchema = structuredClone(applicationSchema);
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      successfulResponse(JSON.stringify(validReport))
    ));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.generateStructured(anthropicConfig, {
      ...request(), jsonSchema: applicationSchema,
    })).resolves.toEqual(validReport);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer unit-test-placeholder',
      'Content-Type': 'application/json',
      'X-OpenRouter-Metadata': 'enabled',
    });
    expect(fetchCallBody(fetchImpl)).toEqual({
      model: 'anthropic/claude-opus-5',
      messages: [
        { role: 'system', content: 'Screenshot-only system prompt.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this screenshot.' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'community_report',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              score: {
                type: 'number',
                description: 'Visible confidence. Transport constraints: minimum=0; maximum=1.',
              },
            },
            required: ['score'],
            additionalProperties: false,
          },
        },
      },
      provider: { require_parameters: true },
    });
    expect(applicationSchema).toEqual(originalSchema);
  });

  it('extracts Anthropic Chat Completions output and emits safe trace data', async () => {
    const onTrace = vi.fn();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => envelopeResponse({
      id: 'gen-safe-123',
      model: 'anthropic/claude-opus-5',
      provider: 'Anthropic',
      choices: [{
        finish_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify(validReport) },
      }],
      usage: { prompt_tokens: 17, completion_tokens: 23, total_tokens: 40 },
      openrouter_metadata: {
        requested: 'anthropic/claude-opus-5',
        strategy: 'direct',
        summary: 'available=1, selected=Anthropic',
        attempt: 1,
        attempts: [{ provider: 'Anthropic', model: 'claude-opus-5', status: 200 }],
        pipeline: [{ type: 'response_healing', name: 'response-healing', data: { private: 'omitted' } }],
      },
    }));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.generateStructured(anthropicConfig, {
      ...request(), onTrace,
    })).resolves.toEqual(validReport);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onTrace).toHaveBeenCalledTimes(1);
    expect(onTrace).toHaveBeenCalledWith({
      generationId: 'gen-safe-123',
      returnedModel: 'anthropic/claude-opus-5',
      selectedProvider: 'Anthropic',
      finishReason: 'stop',
      usage: { inputTokens: 17, outputTokens: 23, totalTokens: 40 },
      routing: {
        requestedModel: 'anthropic/claude-opus-5',
        strategy: 'direct',
        summary: 'available=1, selected=Anthropic',
        attempt: 1,
        attempts: [{ provider: 'Anthropic', model: 'claude-opus-5', status: 200 }],
        pipeline: [{ type: 'response_healing', name: 'response-healing' }],
      },
    });
  });

  it('accepts one pure JSON code fence and still applies the strict report schema', async () => {
    const fetchImpl = vi.fn(async () => successfulResponse(`\n\`\`\`json\n${JSON.stringify(validReport)}\n\`\`\`\n`));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.generateStructured(config, request())).resolves.toEqual(validReport);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, 'provider_request_rejected'],
    [401, 'invalid_api_key'],
    [403, 'invalid_api_key'],
    [402, 'insufficient_balance'],
    [404, 'model_not_found'],
    [413, 'invalid_image'],
    [415, 'invalid_image'],
    [422, 'invalid_image'],
    [429, 'rate_limited'],
  ] satisfies Array<[number, AnalysisErrorCode]>)('maps HTTP %i to %s and only inspects a rejected-request body', async (status, code) => {
    const json = vi.fn(async () => ({ secret: 'must-not-be-read' }));
    const fetchImpl = vi.fn(async () => ({ ok: false, status, json }) as unknown as Response);
    const provider = providerWithFetch(fetchImpl);

    const operation = provider.generateStructured(config, request());

    await expect(operation).rejects.toMatchObject({ code, httpStatus: status, params: { provider: 'openrouter' } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    if (status === 400) expect(json).toHaveBeenCalledTimes(1);
    else expect(json).not.toHaveBeenCalled();
  });

  it('maps HTTP 400 to image incompatibility only when OpenRouter explicitly reports it', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 400,
        message: 'The selected model does not support image input.',
      },
    }), { status: 400, headers: { 'content-type': 'application/json' } }));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.generateStructured(config, request())).rejects.toMatchObject({
      code: 'model_not_multimodal',
      httpStatus: 400,
    });
  });

  it('preserves a safe OpenRouter rejection summary instead of claiming image incompatibility', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 400,
        message: 'Invalid response_format schema for this request.',
      },
    }), { status: 400, headers: { 'content-type': 'application/json' } }));
    const provider = providerWithFetch(fetchImpl);
    let caught: unknown;

    try {
      await provider.generateStructured(config, request());
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: 'provider_request_rejected', httpStatus: 400 });
    expect(getProviderFailureDetail(caught)).toMatchObject({
      stage: 'transport',
      issues: [{
        path: 'provider.http.error',
        code: 'request_rejected',
        valuePreview: 'Invalid response_format schema for this request.',
      }],
    });
  });

  it('extracts the upstream provider reason from OpenRouter metadata.raw', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 400,
        message: 'Provider returned error',
        metadata: {
          provider_name: 'Google AI Studio',
          raw: JSON.stringify({
            error: {
              code: 400,
              status: 'INVALID_ARGUMENT',
              message: 'Invalid JSON payload received: unsupported schema property.',
            },
          }),
        },
      },
    }), { status: 400, headers: { 'content-type': 'application/json' } }));
    const provider = providerWithFetch(fetchImpl);
    let caught: unknown;

    try {
      await provider.generateStructured(config, request());
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: 'provider_request_rejected', httpStatus: 400 });
    expect(getProviderFailureDetail(caught)).toMatchObject({
      stage: 'transport',
      issues: [{
        path: 'provider.http.error',
        code: 'request_rejected',
        valuePreview: 'Google AI Studio: Invalid JSON payload received: unsupported schema property.',
      }],
    });
  });

  it('rejects invalid config before fetch', async () => {
    const fetchImpl = vi.fn();
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.generateStructured({ ...config, apiKey: ' ' }, request())).rejects.toMatchObject({
      code: 'invalid_config', params: { field: 'apiKey' },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps supplied-signal abort to cancelled after exactly one fetch', async () => {
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('secret abort detail', 'AbortError')));
    }));
    const controller = new AbortController();
    const provider = providerWithFetch(fetchImpl);
    const operation = provider.generateStructured(config, request(controller.signal));

    controller.abort();

    await expect(operation).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing role', { content: JSON.stringify(validReport) }],
    ['user role', { role: 'user', content: JSON.stringify(validReport) }],
    ['system role', { role: 'system', content: JSON.stringify(validReport) }],
    ['tool role', { role: 'tool', content: JSON.stringify(validReport) }],
    ['developer role', { role: 'developer', content: JSON.stringify(validReport) }],
  ])('rejects a structured report with %s', async (_name, message) => {
    const fetchImpl = vi.fn(async () => envelopeResponse({ choices: [{ message }] }));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.generateStructured(config, request())).rejects.toMatchObject({ code: 'invalid_response' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects extra choices and redacts the rejected envelope', async () => {
    const upstreamContent = 'upstream-role-content-sentinel';
    const fetchImpl = vi.fn(async () => envelopeResponse({
      choices: [
        { message: { role: 'assistant', content: JSON.stringify(validReport) } },
        { message: { role: 'tool', content: upstreamContent } },
      ],
    }));
    const provider = providerWithFetch(fetchImpl);
    let caught: unknown;

    try {
      await provider.generateStructured(config, request());
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: 'invalid_response' });
    expect(`${String(caught)} ${JSON.stringify(caught)} ${(caught as Error).stack}`).not.toContain(upstreamContent);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps cancellation active while the successful response body is being read', async () => {
    const controller = new AbortController();
    const json = vi.fn(() => new Promise<unknown>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new DOMException('body detail', 'AbortError')));
    }));
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json }) as unknown as Response);
    const provider = providerWithFetch(fetchImpl);
    const operation = provider.generateStructured(config, request(controller.signal));

    await vi.waitFor(() => expect(json).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(operation).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps its deterministic timeout with transport diagnostics and no retry', async () => {
    vi.useFakeTimers();
    const timeoutFetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout detail', 'AbortError')));
    }));
    const provider = providerWithFetch(timeoutFetch, 25);
    const timedOperation = provider.generateStructured(config, request());
    let caught: unknown;
    const timeoutAssertion = timedOperation.catch((error) => { caught = error; });

    await vi.advanceTimersByTimeAsync(25);

    await timeoutAssertion;
    expect(caught).toMatchObject({ code: 'network_timeout' });
    expect(getProviderFailureDetail(caught)).toEqual({
      stage: 'transport',
      issues: [{ path: 'provider.transport', code: 'network_timeout' }],
    });
    expect(timeoutFetch).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a network failure from a timeout without retry', async () => {
    const networkFetch = vi.fn(async () => { throw new TypeError('upstream secret detail'); });
    const networkProvider = providerWithFetch(networkFetch);
    let caught: unknown;

    try { await networkProvider.generateStructured(config, request()); }
    catch (error) { caught = error; }

    expect(caught).toMatchObject({ code: 'network_error' });
    expect(getProviderFailureDetail(caught)).toEqual({
      stage: 'transport',
      issues: [{ path: 'provider.transport', code: 'network_error' }],
    });
    expect(networkFetch).toHaveBeenCalledTimes(1);
  });

  it('uses a 120 second default timeout for OpenRouter requests', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout detail', 'AbortError')));
    }));
    const provider = providerWithFetch(fetchImpl);
    const operation = provider.generateStructured(config, request());
    let settled = false;
    void operation.finally(() => { settled = true; }).catch(() => undefined);

    await vi.advanceTimersByTimeAsync(119_999);
    expect(settled).toBe(false);

    const timeoutAssertion = expect(operation).rejects.toMatchObject({ code: 'network_timeout' });
    await vi.advanceTimersByTimeAsync(1);

    await timeoutAssertion;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses a request-specific timeout without changing the provider default', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout detail', 'AbortError')));
    }));
    const provider = providerWithFetch(fetchImpl, 25);
    const overriddenRequest = { ...request(), timeoutMs: 40 } as StructuredGenerationRequest<CommunityReportV3> & { timeoutMs: number };
    const operation = provider.generateStructured(config, overriddenRequest);
    let settled = false;
    void operation.finally(() => { settled = true; }).catch(() => undefined);

    await vi.advanceTimersByTimeAsync(25);
    expect(settled).toBe(false);

    const timeoutAssertion = expect(operation).rejects.toMatchObject({ code: 'network_timeout' });
    await vi.advanceTimersByTimeAsync(15);

    await timeoutAssertion;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid outer JSON', () => new Response('{', { status: 200 })],
    ['missing assistant content', () => new Response(JSON.stringify({ choices: [] }), { status: 200 })],
    ['non-string assistant content', () => successfulResponse({ value: true })],
    ['prose around markdown-wrapped assistant JSON', () => successfulResponse(`Here is the result:\n\`\`\`json\n${JSON.stringify(validReport)}\n\`\`\``)],
    ['schema-invalid assistant JSON', () => successfulResponse(JSON.stringify({ ...validReport, schemaVersion: 'legacy' }))],
  ])('maps %s to invalid_response without repair or a second fetch', async (_name, response) => {
    const fetchImpl = vi.fn(async () => response());
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.generateStructured(config, request())).rejects.toMatchObject({ code: 'invalid_response' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('preserves a non-JSON HTTP response body as a local failure snapshot', async () => {
    const fetchImpl = vi.fn(async () => new Response('{', { status: 200 }));
    const provider = providerWithFetch(fetchImpl);
    let caught: unknown;

    try { await provider.generateStructured(config, request()); }
    catch (error) { caught = error; }

    expect(getProviderFailureDetail(caught)).toEqual({
      stage: 'json_parse',
      issues: [{ path: 'provider.http.body', code: 'invalid_json' }],
      providerOutput: '{',
    });
  });

  it('redacts provider body, headers, upstream errors, and keys from the exposed error', async () => {
    const secret = 'redaction-sentinel';
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      error: { message: `upstream ${secret}` },
    }), {
      status: 401,
      headers: { 'x-debug-secret': secret },
    }));
    const provider = providerWithFetch(fetchImpl);
    let caught: unknown;

    try {
      await provider.generateStructured({ ...config, apiKey: secret }, request());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProviderError);
    expect(`${String(caught)} ${JSON.stringify(caught)} ${(caught as Error).stack}`).not.toContain(secret);
    expect(Object.keys(caught as object).sort()).toEqual(['code', 'httpStatus', 'name', 'params']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchImpl.mock.calls[0]!;
    expect(String(calledUrl)).not.toContain(secret);
    expect(String(calledInit?.body)).not.toContain(secret);
  });
});

describe('OpenRouter connection test card', () => {
  it('uses the shared Chat Completions contract for Claude connection tests', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      successfulResponse('{"seenImage":true}')
    ));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.testConnection(
      anthropicConfig,
      new AbortController().signal,
    )).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = fetchCallBody(fetchImpl);
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: 'Verify only whether the supplied test-card image is visible.',
    });
    expect(body.messages[1].content[0]).toMatchObject({ type: 'text' });
    expect(body.messages[1].content[1]).toMatchObject({
      type: 'image_url',
      image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
    });
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'connection_test',
        strict: true,
        schema: {
          type: 'object',
          properties: { seenImage: { type: 'boolean' } },
          required: ['seenImage'],
          additionalProperties: false,
        },
      },
    });
    expect(body.provider).toEqual({ require_parameters: true });
  });

  it('bundles the exact 64x64 icon-derived PNG and requests seenImage true with one call', async () => {
    const asset = readFileSync(fileURLToPath(new URL('../assets/provider-test-card.png', import.meta.url)));
    expect(asset.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(asset.readUInt32BE(16)).toBe(64);
    expect(asset.readUInt32BE(20)).toBe(64);
    expect(createHash('sha256').update(asset).digest('hex')).toBe('3ac9d5233f78c41cf5b9cfb4d0e314836708af268706de6435fd663da8371d08');

    const fetchImpl = vi.fn(async () => successfulResponse('{"seenImage":true}'));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.testConnection(config, new AbortController().signal)).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = fetchCallBody(fetchImpl);
    expect(body.messages[1].content[0]).toMatchObject({ type: 'text' });
    expect(body.messages[1].content[1].type).toBe('image_url');
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
    const sentAsset = Buffer.from(body.messages[1].content[1].image_url.url.split(',')[1], 'base64');
    expect(createHash('sha256').update(sentAsset).digest('hex')).toBe('3ac9d5233f78c41cf5b9cfb4d0e314836708af268706de6435fd663da8371d08');
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'connection_test',
        strict: true,
        schema: {
          type: 'object',
          properties: { seenImage: { type: 'boolean' } },
          required: ['seenImage'],
          additionalProperties: false,
        },
      },
    });
    expect(body.provider).toEqual({ require_parameters: true });
  });

  it('rejects false or extra connection fields without repair or retry', async () => {
    for (const content of ['{"seenImage":false}', '{"seenImage":true,"extra":1}']) {
      const fetchImpl = vi.fn(async () => successfulResponse(content));
      const provider = providerWithFetch(fetchImpl);

      await expect(provider.testConnection(config, new AbortController().signal)).rejects.toMatchObject({
        code: 'invalid_response',
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    ['missing role', [{ message: { content: '{"seenImage":true}' } }]],
    ['user role', [{ message: { role: 'user', content: '{"seenImage":true}' } }]],
    ['extra choice', [
      { message: { role: 'assistant', content: '{"seenImage":true}' } },
      { message: { role: 'assistant', content: '{"seenImage":true}' } },
    ]],
  ])('rejects connection content with %s through the shared envelope parser', async (_name, choices) => {
    const fetchImpl = vi.fn(async () => envelopeResponse({ choices }));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.testConnection(config, new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_response',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
