import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { communityReportV3JsonSchema, parseCommunityReportV3, type CommunityReportV3 } from '../src/analysis/stages/community-report-v3';
import { ProviderError, type AnalysisErrorCode } from '../src/providers/provider-errors';
import { getProviderFailureDetail } from '../src/providers/provider-diagnostics';
import { OpenAiProvider } from '../src/providers/openai-provider';
import type { ProviderConfig, ProviderImage, StructuredGenerationRequest } from '../src/providers/provider-types';
import { communityReport } from './community-ui-fixtures';

const validReport = communityReport;

const config: ProviderConfig = {
  provider: 'openai',
  apiKey: 'unit-test-placeholder',
  model: ' custom/gpt-vision ',
  customModel: true,
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

function responseEnvelope(text: string, output: unknown[] = []): Record<string, any> {
  return {
    status: 'completed',
    output: [
      ...output,
      {
        id: 'msg_1',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    ],
  };
}

function successfulResponse(text: string, output: unknown[] = []): Response {
  return new Response(JSON.stringify(responseEnvelope(text, output)), { status: 200 });
}

function envelopeResponse(envelope: unknown): Response {
  return new Response(JSON.stringify(envelope), { status: 200 });
}

function fetchCallBody(fetchImpl: ReturnType<typeof vi.fn>): Record<string, any> {
  const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

function providerWithFetch(fetchImpl: ReturnType<typeof vi.fn>, timeoutMs?: number): OpenAiProvider {
  vi.stubGlobal('fetch', fetchImpl);
  return new OpenAiProvider(timeoutMs === undefined ? {} : { timeoutMs });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('OpenAI Responses analyze', () => {
  it('makes one fixed Responses request with instructions, prompt before image, store false, and strict shared schema', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => successfulResponse(
      JSON.stringify(validReport),
      [{ id: 'rs_1', type: 'reasoning', summary: [] }],
    ));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.generateStructured(config, request())).resolves.toEqual(validReport);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer unit-test-placeholder',
      'Content-Type': 'application/json',
    });
    const body = fetchCallBody(fetchImpl);
    expect(body).toEqual({
      model: 'custom/gpt-vision',
      instructions: 'Screenshot-only system prompt.',
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: 'Analyze this screenshot.' },
          { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
        ],
      }],
      text: {
        format: { type: 'json_schema', name: 'community_report', schema: communityReportV3JsonSchema, strict: true },
      },
      store: false,
    });
    expect(JSON.stringify(body)).not.toContain(config.apiKey);
  });

  it.each([
    [400, 'model_not_multimodal'],
    [401, 'invalid_api_key'],
    [403, 'invalid_api_key'],
    [402, 'insufficient_balance'],
    [404, 'model_not_found'],
    [413, 'invalid_image'],
    [415, 'invalid_image'],
    [422, 'invalid_image'],
    [429, 'rate_limited'],
    [500, 'invalid_response'],
  ] satisfies Array<[number, AnalysisErrorCode]>)('maps HTTP %i to %s without reading the body', async (status, code) => {
    const json = vi.fn(async () => ({ secret: 'must-not-be-read' }));
    const fetchImpl = vi.fn(async () => ({ ok: false, status, json }) as unknown as Response);
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.generateStructured(config, request())).rejects.toMatchObject({
      code, httpStatus: status, params: { provider: 'openai' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
  });

  it('rejects invalid and provider-mismatched config before fetch', async () => {
    const fetchImpl = vi.fn();
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.generateStructured({ ...config, apiKey: ' ' }, request())).rejects.toMatchObject({
      code: 'invalid_config', params: { field: 'apiKey' },
    });
    await expect(provider.generateStructured({ ...config, provider: 'gemini' }, request())).rejects.toMatchObject({
      code: 'invalid_config', params: { field: 'model' },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['MIME mismatch', { mediaType: 'image/png', dataUrl: 'data:image/jpeg;base64,AAAA' }],
    ['non-Base64 URL', { mediaType: 'image/png', dataUrl: 'data:image/png,AAAA' }],
    ['invalid Base64', { mediaType: 'image/png', dataUrl: 'data:image/png;base64,not_base64' }],
    ['empty Base64', { mediaType: 'image/png', dataUrl: 'data:image/png;base64,' }],
  ] satisfies Array<[string, ProviderImage]>)('rejects an invalid image data URL: %s', async (_name, image) => {
    const fetchImpl = vi.fn();
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.generateStructured(config, { ...request(), image })).rejects.toMatchObject({
      code: 'invalid_image', params: { provider: 'openai' },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps supplied abort, deterministic timeout, and network rejection without retry', async () => {
    const controller = new AbortController();
    const abortFetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('abort secret', 'AbortError')));
    }));
    const abortProvider = providerWithFetch(abortFetch);
    const abortOperation = abortProvider.generateStructured(config, request(controller.signal));
    controller.abort();
    await expect(abortOperation).rejects.toMatchObject({ code: 'cancelled' });
    expect(abortFetch).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    const timeoutFetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout secret', 'AbortError')));
    }));
    const timeoutProvider = providerWithFetch(timeoutFetch, 25);
    const timeoutOperation = timeoutProvider.generateStructured(config, request());
    const timeoutAssertion = expect(timeoutOperation).rejects.toMatchObject({ code: 'network_timeout' });
    await vi.advanceTimersByTimeAsync(25);
    await timeoutAssertion;
    expect(timeoutFetch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();

    const networkFetch = vi.fn(async () => { throw new TypeError('network secret'); });
    const networkProvider = providerWithFetch(networkFetch);
    await expect(networkProvider.generateStructured(config, request())).rejects.toMatchObject({ code: 'network_timeout' });
    expect(networkFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps abort and timeout active while reading a successful response body', async () => {
    const controller = new AbortController();
    const abortJson = vi.fn(() => new Promise<unknown>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new DOMException('body secret', 'AbortError')));
    }));
    const abortFetch = vi.fn(async () => ({ ok: true, status: 200, json: abortJson }) as unknown as Response);
    const abortProvider = providerWithFetch(abortFetch);
    const abortOperation = abortProvider.generateStructured(config, request(controller.signal));
    await vi.waitFor(() => expect(abortJson).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(abortOperation).rejects.toMatchObject({ code: 'cancelled' });
    expect(abortFetch).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const timeoutJson = vi.fn(() => new Promise<unknown>((_resolve, reject) => {
      requestSignal?.addEventListener('abort', () => reject(new DOMException('body timeout secret', 'AbortError')));
    }));
    const timeoutFetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return { ok: true, status: 200, json: timeoutJson } as unknown as Response;
    });
    const timeoutProvider = providerWithFetch(timeoutFetch, 25);
    const timeoutOperation = timeoutProvider.generateStructured(config, request());
    const timeoutAssertion = expect(timeoutOperation).rejects.toMatchObject({ code: 'network_timeout' });
    await vi.advanceTimersByTimeAsync(25);
    await timeoutAssertion;
    expect(timeoutFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid outer JSON', () => new Response('{', { status: 200 })],
    ['SDK convenience only', () => envelopeResponse({ status: 'completed', output_text: JSON.stringify(validReport), output: [] })],
    ['missing response status', () => envelopeResponse({ output: (responseEnvelope(JSON.stringify(validReport)) as any).output })],
    ['incomplete response', () => envelopeResponse({ ...responseEnvelope(JSON.stringify(validReport)), status: 'incomplete' })],
    ['completed response with error', () => envelopeResponse({ ...responseEnvelope(JSON.stringify(validReport)), error: { message: 'ambiguous' } })],
    ['missing output', () => envelopeResponse({ status: 'completed' })],
    ['extra assistant message', () => envelopeResponse({
      status: 'completed',
      output: [
        ...(responseEnvelope(JSON.stringify(validReport)) as any).output,
        ...(responseEnvelope(JSON.stringify(validReport)) as any).output,
      ],
    })],
    ['tool output item', () => envelopeResponse(responseEnvelope(JSON.stringify(validReport), [{ type: 'function_call', name: 'tool' }]))],
    ['unknown reasoning field', () => envelopeResponse(responseEnvelope(JSON.stringify(validReport), [{ type: 'reasoning', summary: [], tool_call: 'ambiguous' }]))],
    ['message missing role', () => envelopeResponse({
      status: 'completed', output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(validReport) }] }],
    })],
    ['user message', () => envelopeResponse({
      status: 'completed', output: [{ type: 'message', status: 'completed', role: 'user', content: [{ type: 'output_text', text: JSON.stringify(validReport) }] }],
    })],
    ['incomplete message', () => envelopeResponse({
      status: 'completed', output: [{ type: 'message', status: 'in_progress', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(validReport) }] }],
    })],
    ['message with tool metadata', () => envelopeResponse({
      status: 'completed', output: [{
        type: 'message', status: 'completed', role: 'assistant', tool_calls: [{ name: 'tool' }],
        content: [{ type: 'output_text', text: JSON.stringify(validReport) }],
      }],
    })],
    ['refusal content', () => envelopeResponse({
      status: 'completed', output: [{ type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'refusal', refusal: 'no' }] }],
    })],
    ['ambiguous message text', () => envelopeResponse({
      status: 'completed', output: [{ type: 'message', status: 'completed', role: 'assistant', content: [
        { type: 'output_text', text: JSON.stringify(validReport) },
        { type: 'output_text', text: JSON.stringify(validReport) },
      ] }],
    })],
    ['output text with function call', () => envelopeResponse({
      status: 'completed', output: [{
        type: 'message', status: 'completed', role: 'assistant',
        content: [{ type: 'output_text', text: JSON.stringify(validReport), functionCall: { name: 'tool' } }],
      }],
    })],
    ['markdown-wrapped JSON', () => successfulResponse(`\`\`\`json\n${JSON.stringify(validReport)}\n\`\`\``)],
    ['schema-invalid JSON', () => successfulResponse(JSON.stringify({ ...validReport, schemaVersion: 'legacy' }))],
  ])('rejects %s without repair, fallback, or a second fetch', async (_name, response) => {
    const fetchImpl = vi.fn(async () => response());
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.generateStructured(config, request())).rejects.toMatchObject({ code: 'invalid_response' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('preserves a non-JSON HTTP response body for diagnostics', async () => {
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

  it('redacts keys, HTTP bodies, headers, and upstream envelope text', async () => {
    const secret = 'openai-redaction-sentinel';
    const json = vi.fn(async () => ({ secret }));
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: false, status: 401, json, headers: new Headers({ 'x-secret': secret }),
    }) as unknown as Response);
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
    expect(json).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).not.toContain(secret);
    expect(String(init?.body)).not.toContain(secret);
  });
});

describe('OpenAI connection test card', () => {
  it('sends the exact icon-derived card with the tiny strict schema and accepts true once', async () => {
    const asset = readFileSync(fileURLToPath(new URL('../assets/provider-test-card.png', import.meta.url)));
    expect(createHash('sha256').update(asset).digest('hex')).toBe('3ac9d5233f78c41cf5b9cfb4d0e314836708af268706de6435fd663da8371d08');
    const fetchImpl = vi.fn(async () => successfulResponse('{"seenImage":true}'));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.testConnection(config, new AbortController().signal)).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = fetchCallBody(fetchImpl);
    expect(body.input[0].content[0]).toMatchObject({ type: 'input_text' });
    expect(body.input[0].content[1]).toMatchObject({ type: 'input_image' });
    const dataUrl = body.input[0].content[1].image_url as string;
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(createHash('sha256').update(Buffer.from(dataUrl.split(',')[1]!, 'base64')).digest('hex'))
      .toBe('3ac9d5233f78c41cf5b9cfb4d0e314836708af268706de6435fd663da8371d08');
    expect(body.text.format).toEqual({
      type: 'json_schema',
      name: 'connection_test',
      schema: {
        type: 'object',
        properties: { seenImage: { type: 'boolean' } },
        required: ['seenImage'],
        additionalProperties: false,
      },
      strict: true,
    });
    expect(body.store).toBe(false);
  });

  it.each([
    ['false result', responseEnvelope('{"seenImage":false}')],
    ['extra field', responseEnvelope('{"seenImage":true,"extra":1}')],
    ['missing assistant role', { status: 'completed', output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: '{"seenImage":true}' }] }] }],
    ['extra message', { status: 'completed', output: [
      ...(responseEnvelope('{"seenImage":true}') as any).output,
      ...(responseEnvelope('{"seenImage":true}') as any).output,
    ] }],
  ])('rejects %s through the raw Responses parser', async (_name, envelope) => {
    const fetchImpl = vi.fn(async () => envelopeResponse(envelope));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.testConnection(config, new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_response',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
