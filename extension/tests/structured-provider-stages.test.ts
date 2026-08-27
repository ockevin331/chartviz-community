import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  communityReportV3JsonSchema,
  parseCommunityReportV3,
} from '../src/analysis/stages/community-report-v3';
import {
  communityVisualFactsJsonSchema,
  parseCommunityVisualFacts,
} from '../src/analysis/stages/visual-facts';
import { GeminiProvider } from '../src/providers/gemini-provider';
import { OpenAiProvider } from '../src/providers/openai-provider';
import { OpenRouterProvider } from '../src/providers/openrouter-provider';
import type {
  ProviderConfig,
  StructuredGenerationRequest,
  StructuredVisionProvider,
} from '../src/providers/provider-types';
import { validReportV3, validVisualFacts } from './three-stage-fixtures';

const image = { mediaType: 'image/png' as const, dataUrl: 'data:image/png;base64,AAAA' };

function config(provider: ProviderConfig['provider']): ProviderConfig {
  return {
    provider,
    apiKey: 'unit-test-placeholder',
    model: ` custom/${provider}-vision `,
    customModel: true,
  };
}

function imageRequest(): StructuredGenerationRequest<ReturnType<typeof parseCommunityVisualFacts>> {
  return {
    systemPrompt: 'Extract screenshot facts.',
    userPrompt: 'Return only visible facts.',
    image,
    schemaName: 'community_visual_facts',
    jsonSchema: communityVisualFactsJsonSchema,
    parse: parseCommunityVisualFacts,
    signal: new AbortController().signal,
  };
}

function textRequest(): StructuredGenerationRequest<ReturnType<typeof parseCommunityReportV3>> {
  return {
    systemPrompt: 'Reason from supplied facts.',
    userPrompt: 'Return the final report.',
    schemaName: 'community_report_v3',
    jsonSchema: communityReportV3JsonSchema,
    parse: parseCommunityReportV3,
    signal: new AbortController().signal,
  };
}

function bodyOf(fetchImpl: ReturnType<typeof vi.fn>, call: number): Record<string, any> {
  const init = fetchImpl.mock.calls[call]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

function responseFor(provider: ProviderConfig['provider'], value: unknown): Response {
  const text = JSON.stringify(value);
  if (provider === 'openai') {
    return new Response(JSON.stringify({
      status: 'completed',
      output: [{
        id: 'msg_1',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text, annotations: [] }],
      }],
    }), { status: 200 });
  }
  if (provider === 'openrouter') {
    return new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: text } }],
    }), { status: 200 });
  }
  return new Response(JSON.stringify({
    candidates: [{
      finishReason: 'STOP',
      content: { role: 'model', parts: [{ text }] },
    }],
  }), { status: 200 });
}

function providerFor(kind: ProviderConfig['provider']): StructuredVisionProvider {
  if (kind === 'openai') return new OpenAiProvider();
  if (kind === 'openrouter') return new OpenRouterProvider();
  return new GeminiProvider();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(['openai', 'openrouter', 'gemini'] as const)('%s structured stage transport', (kind) => {
  it('sends an image only for the image stage and parses both stages with their real contracts', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(responseFor(kind, validVisualFacts))
      .mockResolvedValueOnce(responseFor(kind, validReportV3));
    vi.stubGlobal('fetch', fetchImpl);
    const provider = providerFor(kind);

    await expect(provider.generateStructured(config(kind), imageRequest())).resolves.toEqual(validVisualFacts);
    await expect(provider.generateStructured(config(kind), textRequest())).resolves.toEqual(validReportV3);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const imageBody = bodyOf(fetchImpl, 0);
    const textBody = bodyOf(fetchImpl, 1);

    if (kind === 'openai') {
      expect(imageBody).toEqual({
        model: 'custom/openai-vision',
        instructions: 'Extract screenshot facts.',
        input: [{ role: 'user', content: [
          { type: 'input_text', text: 'Return only visible facts.' },
          { type: 'input_image', image_url: image.dataUrl },
        ] }],
        text: { format: {
          type: 'json_schema', name: 'community_visual_facts', schema: communityVisualFactsJsonSchema, strict: true,
        } },
        store: false,
      });
      expect(textBody.input[0].content).toEqual([
        { type: 'input_text', text: 'Return the final report.' },
      ]);
      expect(textBody.text.format).toEqual({
        type: 'json_schema', name: 'community_report_v3', schema: communityReportV3JsonSchema, strict: true,
      });
    } else if (kind === 'openrouter') {
      expect(imageBody.messages).toEqual([
        { role: 'system', content: 'Extract screenshot facts.' },
        { role: 'user', content: [
          { type: 'text', text: 'Return only visible facts.' },
          { type: 'image_url', image_url: { url: image.dataUrl } },
        ] },
      ]);
      expect(textBody.messages).toEqual([
        { role: 'system', content: 'Reason from supplied facts.' },
        { role: 'user', content: [{ type: 'text', text: 'Return the final report.' }] },
      ]);
      expect(imageBody.response_format.json_schema).toEqual({
        name: 'community_visual_facts', strict: true, schema: communityVisualFactsJsonSchema,
      });
      expect(textBody.response_format.json_schema).toEqual({
        name: 'community_report_v3', strict: true, schema: communityReportV3JsonSchema,
      });
      expect(imageBody.provider).toEqual({ require_parameters: true });
      expect(textBody.provider).toEqual({ require_parameters: true });
    } else {
      expect(imageBody.systemInstruction).toEqual({ parts: [{ text: 'Extract screenshot facts.' }] });
      expect(imageBody.contents[0].parts).toEqual([
        { text: 'Return only visible facts.' },
        { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
      ]);
      expect(textBody.systemInstruction).toEqual({ parts: [{ text: 'Reason from supplied facts.' }] });
      expect(textBody.contents[0].parts).toEqual([{ text: 'Return the final report.' }]);
      expect(imageBody.generationConfig.responseSchema).toEqual(communityVisualFactsJsonSchema);
      expect(textBody.generationConfig.responseSchema).toEqual(communityReportV3JsonSchema);
    }

    expect(JSON.stringify(imageBody)).not.toContain('unit-test-placeholder');
    expect(JSON.stringify(textBody)).not.toContain(image.dataUrl);
  });
});
