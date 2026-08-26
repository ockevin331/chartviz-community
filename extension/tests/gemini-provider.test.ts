import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { communityJsonSchema } from '../src/analysis/community-json-schema';
import { ProviderError, type AnalysisErrorCode } from '../src/providers/provider-errors';
import { GeminiProvider } from '../src/providers/gemini-provider';
import type { ProviderConfig, VisionRequest } from '../src/providers/provider-types';

const validReport = {
  schemaVersion: 'community-1.0',
  chart: { instrument: 'BTC/USDT', timeframe: '15m', limitations: [] },
  marketView: {
    bias: 'unclear', phase: 'unclear', strength: 'unclear', summary: 'The visible chart is mixed.', evidenceIds: [],
  },
  evidence: [],
  volume: null,
  indicators: [],
  levels: [],
  scenarios: {
    long: {
      condition: 'Wait for visible resistance to break.', entry: 'Enter only after confirmation.', stop: 'Below visible support.', targets: [], reason: 'Confirmation is not visible yet.', evidenceIds: [],
    },
    short: {
      condition: 'Wait for visible support to fail.', entry: 'Enter only after confirmation.', stop: 'Above visible resistance.', targets: [], reason: 'Breakdown confirmation is not visible yet.', evidenceIds: [],
    },
    wait: { condition: 'Wait while structure remains mixed.', reason: 'The screenshot is inconclusive.', evidenceIds: [] },
  },
  patterns: [],
  signals: [],
  riskNotice: 'Educational screenshot analysis only.',
};

const config: ProviderConfig = {
  provider: 'gemini',
  apiKey: 'unit-test-placeholder',
  model: ' custom/model name ',
  customModel: true,
};

const safeRating = {
  category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
  probability: 'NEGLIGIBLE',
  blocked: false,
};

const validThoughtSignature = 'AQIDBA==';

function request(
  signal = new AbortController().signal,
  image: VisionRequest['image'] = { mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' },
): VisionRequest {
  return {
    image,
    prompt: { system: 'Screenshot-only system prompt.', user: 'Analyze this screenshot.' },
    jsonSchema: communityJsonSchema,
    signal,
  };
}

function responseEnvelope(text: string): Record<string, any> {
  return {
    candidates: [{
      content: { role: 'model', parts: [{ text }] },
      finishReason: 'STOP',
    }],
  };
}

function successfulResponse(text: string): Response {
  return new Response(JSON.stringify(responseEnvelope(text)), { status: 200 });
}

function envelopeResponse(envelope: unknown): Response {
  return new Response(JSON.stringify(envelope), { status: 200 });
}

function fetchCallBody(fetchImpl: ReturnType<typeof vi.fn>): Record<string, any> {
  const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

function providerWithFetch(fetchImpl: ReturnType<typeof vi.fn>, timeoutMs?: number): GeminiProvider {
  vi.stubGlobal('fetch', fetchImpl);
  return new GeminiProvider(timeoutMs === undefined ? {} : { timeoutMs });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Gemini generateContent analyze', () => {
  it('makes one encoded fixed-origin request with header-only key and separated system/user image content', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => successfulResponse(JSON.stringify(validReport)));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.analyze(config, request())).resolves.toEqual(validReport);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/custom%2Fmodel%20name:generateContent');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      'Content-Type': 'application/json',
      'x-goog-api-key': 'unit-test-placeholder',
    });
    const body = fetchCallBody(fetchImpl);
    expect(body).toEqual({
      systemInstruction: { parts: [{ text: 'Screenshot-only system prompt.' }] },
      contents: [{
        role: 'user',
        parts: [
          { text: 'Analyze this screenshot.' },
          { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: communityJsonSchema,
        candidateCount: 1,
      },
    });
    expect(String(url)).not.toContain(config.apiKey);
    expect(JSON.stringify(body)).not.toContain(config.apiKey);
  });

  it('accepts bounded official thought and safety metadata around one final text part', async () => {
    const fetchImpl = vi.fn(async () => envelopeResponse({
      candidates: [{
        content: {
          role: 'model',
          parts: [{ text: JSON.stringify(validReport), thoughtSignature: validThoughtSignature, thought: false }],
        },
        finishReason: 'STOP',
        index: 0,
        avgLogprobs: -0.125,
        safetyRatings: [safeRating],
      }],
      promptFeedback: { safetyRatings: [safeRating] },
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        totalTokenCount: 30,
        thoughtsTokenCount: 4,
      },
      modelVersion: 'gemini-3.7-flash',
      responseId: 'response-safe-id',
      createTime: '2026-08-26T00:00:00Z',
    }));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.analyze(config, request())).resolves.toEqual(validReport);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['non-string signature', 123],
    ['empty signature', ''],
    ['invalid Base64 signature', 'not_base64'],
    ['oversized signature', 'A'.repeat(16_388)],
  ])('rejects %s thoughtSignature', async (_name, thoughtSignature) => {
    const fetchImpl = vi.fn(async () => envelopeResponse({
      candidates: [{
        content: { role: 'model', parts: [{ text: JSON.stringify(validReport), thoughtSignature }] },
        finishReason: 'STOP',
      }],
    }));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.analyze(config, request())).rejects.toMatchObject({ code: 'invalid_response' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects thought content and unknown part metadata even with valid final text', async () => {
    for (const metadata of [
      { thought: true },
      { unknownMetadata: 'unsafe' },
    ]) {
      const fetchImpl = vi.fn(async () => envelopeResponse({
        candidates: [{
          content: { role: 'model', parts: [{ text: JSON.stringify(validReport), ...metadata }] },
          finishReason: 'STOP',
        }],
      }));
      const provider = providerWithFetch(fetchImpl);

      await expect(provider.analyze(config, request())).rejects.toMatchObject({ code: 'invalid_response' });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    ['prompt safety blocked', {
      ...responseEnvelope(JSON.stringify(validReport)),
      promptFeedback: { safetyRatings: [{ ...safeRating, blocked: true }] },
    }],
    ['candidate safety blocked', {
      candidates: [{
        ...(responseEnvelope(JSON.stringify(validReport)).candidates[0]),
        safetyRatings: [{ ...safeRating, blocked: true }],
      }],
    }],
    ['malformed safety rating', {
      ...responseEnvelope(JSON.stringify(validReport)),
      promptFeedback: { safetyRatings: [{ ...safeRating, blocked: 'false' }] },
    }],
    ['payload execution metadata', {
      ...responseEnvelope(JSON.stringify(validReport)), functionCall: { name: 'tool' },
    }],
    ['candidate execution metadata', {
      candidates: [{ ...(responseEnvelope(JSON.stringify(validReport)).candidates[0]), toolResponse: {} }],
    }],
    ['content execution metadata', {
      candidates: [{
        ...responseEnvelope(JSON.stringify(validReport)).candidates[0],
        content: {
          ...responseEnvelope(JSON.stringify(validReport)).candidates[0].content,
          functionResponse: { name: 'tool' },
        },
      }],
    }],
    ['unknown payload metadata', {
      ...responseEnvelope(JSON.stringify(validReport)), unknownMetadata: {},
    }],
    ['unknown candidate metadata', {
      candidates: [{ ...(responseEnvelope(JSON.stringify(validReport)).candidates[0]), unknownMetadata: {} }],
    }],
    ['unknown content metadata', {
      candidates: [{
        ...responseEnvelope(JSON.stringify(validReport)).candidates[0],
        content: { ...responseEnvelope(JSON.stringify(validReport)).candidates[0].content, unknownMetadata: {} },
      }],
    }],
  ])('rejects %s around an otherwise valid STOP response', async (_name, envelope) => {
    const fetchImpl = vi.fn(async () => envelopeResponse(envelope));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.analyze(config, request())).rejects.toMatchObject({ code: 'invalid_response' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    'functionCall',
    'functionResponse',
    'toolCall',
    'toolResponse',
    'executableCode',
    'codeExecutionResult',
    'fileData',
    'inlineData',
  ])('rejects executable or non-text part key %s', async (key) => {
    const fetchImpl = vi.fn(async () => envelopeResponse({
      candidates: [{
        content: { role: 'model', parts: [{ text: JSON.stringify(validReport), [key]: {} }] },
        finishReason: 'STOP',
      }],
    }));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.analyze(config, request())).rejects.toMatchObject({ code: 'invalid_response' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('encodes the complete trimmed custom model as one path segment without allowing a custom origin or query', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => successfulResponse(JSON.stringify(validReport)));
    const provider = providerWithFetch(fetchImpl);
    const hostileModel = '../../other:method?key=url-secret#fragment';

    await provider.analyze({ ...config, model: ` ${hostileModel} ` }, request());

    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(hostileModel)}:generateContent`);
    expect(String(url)).not.toContain('?key=');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['image/png', 'data:image/png;base64,AAAA'],
    ['image/jpeg', 'data:image/jpeg;base64,AQID'],
    ['image/webp', 'data:image/webp;base64,BAUG'],
  ] satisfies Array<[VisionRequest['image']['mediaType'], string]>)('preserves strict %s Base64 bytes in inlineData', async (mediaType, dataUrl) => {
    const fetchImpl = vi.fn(async () => successfulResponse(JSON.stringify(validReport)));
    const provider = providerWithFetch(fetchImpl);

    await provider.analyze(config, request(undefined, { mediaType, dataUrl }));

    expect(fetchCallBody(fetchImpl).contents[0].parts[1]).toEqual({
      inlineData: { mimeType: mediaType, data: dataUrl.split(',')[1] },
    });
  });

  it.each([
    ['MIME mismatch', { mediaType: 'image/png', dataUrl: 'data:image/jpeg;base64,AAAA' }],
    ['unsupported MIME', { mediaType: 'image/png', dataUrl: 'data:image/gif;base64,AAAA' }],
    ['non-Base64 URL', { mediaType: 'image/png', dataUrl: 'data:image/png,AAAA' }],
    ['invalid Base64', { mediaType: 'image/png', dataUrl: 'data:image/png;base64,not_base64' }],
    ['empty Base64', { mediaType: 'image/png', dataUrl: 'data:image/png;base64,' }],
    ['embedded whitespace', { mediaType: 'image/png', dataUrl: 'data:image/png;base64,AA AA' }],
  ] satisfies Array<[string, VisionRequest['image']]>)('rejects invalid data URL form: %s', async (_name, image) => {
    const fetchImpl = vi.fn();
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.analyze(config, request(undefined, image))).rejects.toMatchObject({
      code: 'invalid_image', params: { provider: 'gemini' },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
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

    await expect(provider.analyze(config, request())).rejects.toMatchObject({
      code, httpStatus: status, params: { provider: 'gemini' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
  });

  it('rejects invalid and provider-mismatched config before fetch', async () => {
    const fetchImpl = vi.fn();
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.analyze({ ...config, model: ' ' }, request())).rejects.toMatchObject({
      code: 'invalid_config', params: { field: 'model' },
    });
    await expect(provider.analyze({ ...config, provider: 'openai' }, request())).rejects.toMatchObject({
      code: 'invalid_config', params: { field: 'model' },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps supplied abort, timeout, and network rejection with one call and no retry', async () => {
    const controller = new AbortController();
    const abortFetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('abort secret', 'AbortError')));
    }));
    const abortProvider = providerWithFetch(abortFetch);
    const abortOperation = abortProvider.analyze(config, request(controller.signal));
    controller.abort();
    await expect(abortOperation).rejects.toMatchObject({ code: 'cancelled' });
    expect(abortFetch).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    const timeoutFetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout secret', 'AbortError')));
    }));
    const timeoutProvider = providerWithFetch(timeoutFetch, 25);
    const timeoutOperation = timeoutProvider.analyze(config, request());
    const timeoutAssertion = expect(timeoutOperation).rejects.toMatchObject({ code: 'network_timeout' });
    await vi.advanceTimersByTimeAsync(25);
    await timeoutAssertion;
    expect(timeoutFetch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();

    const networkFetch = vi.fn(async () => { throw new TypeError('network secret'); });
    const networkProvider = providerWithFetch(networkFetch);
    await expect(networkProvider.analyze(config, request())).rejects.toMatchObject({ code: 'network_timeout' });
    expect(networkFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps supplied abort and timeout active during response-body reading', async () => {
    const controller = new AbortController();
    const abortJson = vi.fn(() => new Promise<unknown>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new DOMException('body secret', 'AbortError')));
    }));
    const abortFetch = vi.fn(async () => ({ ok: true, status: 200, json: abortJson }) as unknown as Response);
    const abortProvider = providerWithFetch(abortFetch);
    const abortOperation = abortProvider.analyze(config, request(controller.signal));
    await vi.waitFor(() => expect(abortJson).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(abortOperation).rejects.toMatchObject({ code: 'cancelled' });

    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const timeoutJson = vi.fn(() => new Promise<unknown>((_resolve, reject) => {
      requestSignal?.addEventListener('abort', () => reject(new DOMException('body timeout', 'AbortError')));
    }));
    const timeoutFetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return { ok: true, status: 200, json: timeoutJson } as unknown as Response;
    });
    const timeoutProvider = providerWithFetch(timeoutFetch, 25);
    const timeoutOperation = timeoutProvider.analyze(config, request());
    const timeoutAssertion = expect(timeoutOperation).rejects.toMatchObject({ code: 'network_timeout' });
    await vi.advanceTimersByTimeAsync(25);
    await timeoutAssertion;
    expect(timeoutFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid outer JSON', () => new Response('{', { status: 200 })],
    ['missing candidates', () => envelopeResponse({})],
    ['extra candidate', () => envelopeResponse({ candidates: [
      ...(responseEnvelope(JSON.stringify(validReport)) as any).candidates,
      ...(responseEnvelope(JSON.stringify(validReport)) as any).candidates,
    ] })],
    ['prompt blocked', () => envelopeResponse({ ...responseEnvelope(JSON.stringify(validReport)), promptFeedback: { blockReason: 'SAFETY' } })],
    ['safety finish', () => envelopeResponse({ candidates: [{
      content: { role: 'model', parts: [{ text: JSON.stringify(validReport) }] }, finishReason: 'SAFETY',
    }] })],
    ['missing model role', () => envelopeResponse({ candidates: [{
      content: { parts: [{ text: JSON.stringify(validReport) }] }, finishReason: 'STOP',
    }] })],
    ['assistant role', () => envelopeResponse({ candidates: [{
      content: { role: 'assistant', parts: [{ text: JSON.stringify(validReport) }] }, finishReason: 'STOP',
    }] })],
    ['function call', () => envelopeResponse({ candidates: [{
      content: { role: 'model', parts: [{ functionCall: { name: 'tool' } }] }, finishReason: 'STOP',
    }] })],
    ['ambiguous part', () => envelopeResponse({ candidates: [{
      content: { role: 'model', parts: [{ text: JSON.stringify(validReport), functionCall: { name: 'tool' } }] }, finishReason: 'STOP',
    }] })],
    ['extra text part', () => envelopeResponse({ candidates: [{
      content: { role: 'model', parts: [{ text: JSON.stringify(validReport) }, { text: '{}' }] }, finishReason: 'STOP',
    }] })],
    ['markdown-wrapped JSON', () => successfulResponse(`\`\`\`json\n${JSON.stringify(validReport)}\n\`\`\``)],
    ['schema-invalid JSON', () => successfulResponse(JSON.stringify({ ...validReport, schemaVersion: 'legacy' }))],
  ])('rejects %s without repair, fallback, or a second fetch', async (_name, response) => {
    const fetchImpl = vi.fn(async () => response());
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.analyze(config, request())).rejects.toMatchObject({ code: 'invalid_response' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('redacts API keys, upstream errors, headers, and response content', async () => {
    const secret = 'gemini-redaction-sentinel';
    const json = vi.fn(async () => ({ error: { message: secret } }));
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: false, status: 403, json, headers: new Headers({ 'x-secret': secret }),
    }) as unknown as Response);
    const provider = providerWithFetch(fetchImpl);
    let caught: unknown;

    try {
      await provider.analyze({ ...config, apiKey: secret }, request());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProviderError);
    expect(`${String(caught)} ${JSON.stringify(caught)} ${(caught as Error).stack}`).not.toContain(secret);
    expect(Object.keys(caught as object).sort()).toEqual(['code', 'httpStatus', 'name', 'params']);
    expect(json).not.toHaveBeenCalled();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).not.toContain(secret);
    expect(String(init?.body)).not.toContain(secret);
  });
});

describe('Gemini connection test card', () => {
  it('sends exact card bytes through inlineData and accepts one STOP model response with true', async () => {
    const asset = readFileSync(fileURLToPath(new URL('../assets/provider-test-card.png', import.meta.url)));
    expect(createHash('sha256').update(asset).digest('hex')).toBe('3ac9d5233f78c41cf5b9cfb4d0e314836708af268706de6435fd663da8371d08');
    const fetchImpl = vi.fn(async () => successfulResponse('{"seenImage":true}'));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.testConnection(config, new AbortController().signal)).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = fetchCallBody(fetchImpl);
    expect(body.contents[0].parts[0]).toHaveProperty('text');
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe('image/png');
    expect(createHash('sha256').update(Buffer.from(body.contents[0].parts[1].inlineData.data, 'base64')).digest('hex'))
      .toBe('3ac9d5233f78c41cf5b9cfb4d0e314836708af268706de6435fd663da8371d08');
    expect(body.generationConfig).toEqual({
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: { seenImage: { type: 'boolean' } },
        required: ['seenImage'],
        additionalProperties: false,
      },
      candidateCount: 1,
    });
  });

  it('accepts a valid thoughtSignature on the one final connection text part', async () => {
    const fetchImpl = vi.fn(async () => envelopeResponse({
      candidates: [{
        content: {
          role: 'model',
          parts: [{ text: '{"seenImage":true}', thoughtSignature: validThoughtSignature }],
        },
        finishReason: 'STOP',
      }],
    }));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.testConnection(config, new AbortController().signal)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['false result', responseEnvelope('{"seenImage":false}')],
    ['extra result field', responseEnvelope('{"seenImage":true,"extra":1}')],
    ['blocked result', { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }],
    ['extra candidate', { candidates: [
      ...(responseEnvelope('{"seenImage":true}') as any).candidates,
      ...(responseEnvelope('{"seenImage":true}') as any).candidates,
    ] }],
  ])('rejects %s through the strict Gemini parser', async (_name, envelope) => {
    const fetchImpl = vi.fn(async () => envelopeResponse(envelope));
    const provider = providerWithFetch(fetchImpl);

    await expect(provider.testConnection(config, new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_response',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
