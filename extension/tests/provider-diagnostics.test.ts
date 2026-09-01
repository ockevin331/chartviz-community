import { describe, expect, it } from 'vitest';
import { runThreeStageAnalysis } from '../src/analysis/stages/analysis-pipeline';
import { getProviderFailureDetail } from '../src/providers/provider-diagnostics';
import { parseOpenRouterTrace } from '../src/providers/openrouter-trace';
import type { ProviderTrace } from '../src/providers/openrouter-trace';
import type {
  ProviderConfig,
  StructuredGenerationRequest,
  StructuredVisionProvider,
  ValidationResult,
} from '../src/providers/provider-types';
import { validReportV3, validSignalFacts, validVisualWireFacts } from './three-stage-fixtures';

const config: ProviderConfig = {
  provider: 'openrouter', apiKey: 'test-key', model: 'anthropic/claude-opus-5', customModel: false,
};

class TracedFixtureProvider implements StructuredVisionProvider {
  readonly kind = 'openrouter' as const;
  private index = 0;

  constructor(
    private readonly fixtures: readonly unknown[],
    private readonly traces: readonly ProviderTrace[],
  ) {}

  validateConfig(): ValidationResult { return { ok: true }; }
  async testConnection(): Promise<void> {}

  async generateStructured<T>(_config: ProviderConfig, request: StructuredGenerationRequest<T>): Promise<T> {
    const index = this.index++;
    request.onTrace?.(this.traces[index]!);
    return request.parse(structuredClone(this.fixtures[index]));
  }
}

describe('OpenRouter trace diagnostics', () => {
  it('keeps only bounded routing metadata and token totals', () => {
    const trace = parseOpenRouterTrace({
      id: 'gen-safe-123',
      model: 'anthropic/claude-opus-5',
      provider: 'Anthropic',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 120,
        output_tokens: 80,
        cache_read_input_tokens: 40,
        cost: 0.012,
        secret_usage_detail: 'do not retain',
      },
      openrouter_metadata: {
        requested: 'anthropic/claude-opus-5',
        strategy: 'fallback',
        region: 'iad',
        summary: 'available=2, selected=Anthropic',
        attempt: 2,
        is_byok: true,
        attempts: [
          { provider: 'Provider A', model: 'model-a', status: 503, error: 'private upstream error' },
          { provider: 'Anthropic', model: 'claude-opus-5', status: 200, headers: { authorization: 'Bearer secret' } },
        ],
        pipeline: [
          {
            type: 'context_compression',
            name: 'context-compression',
            data: { original_prompt: 'private prompt', authorization: 'Bearer secret' },
          },
        ],
        params: { api_key: 'sk-secret-access-token' },
        unknown: 'do not retain',
      },
      content: [{ type: 'text', text: 'private model response' }],
      headers: { authorization: 'Bearer secret-access-token' },
    });

    expect(trace).toEqual({
      generationId: 'gen-safe-123',
      returnedModel: 'anthropic/claude-opus-5',
      selectedProvider: 'Anthropic',
      finishReason: 'end_turn',
      usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
      routing: {
        requestedModel: 'anthropic/claude-opus-5',
        strategy: 'fallback',
        region: 'iad',
        summary: 'available=2, selected=Anthropic',
        attempt: 2,
        attempts: [
          { provider: 'Provider A', model: 'model-a', status: 503 },
          { provider: 'Anthropic', model: 'claude-opus-5', status: 200 },
        ],
        pipeline: [{ type: 'context_compression', name: 'context-compression' }],
      },
    });
    expect(Object.isFrozen(trace)).toBe(true);
    expect(Object.isFrozen(trace?.usage)).toBe(true);
    expect(Object.isFrozen(trace?.routing)).toBe(true);
    expect(Object.isFrozen(trace?.routing?.attempts)).toBe(true);
    expect(Object.isFrozen(trace?.routing?.pipeline)).toBe(true);
    expect(JSON.stringify(trace)).not.toMatch(/private|secret|authorization|api.?key|data:image|cost/i);
  });

  it('supports OpenAI-compatible token names and ignores invalid or empty metadata', () => {
    expect(parseOpenRouterTrace({
      usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
      choices: [{ finish_reason: 'stop', message: { content: 'not retained' } }],
    })).toEqual({
      finishReason: 'stop',
      usage: { inputTokens: 7, outputTokens: 5, totalTokens: 12 },
    });
    expect(parseOpenRouterTrace({ openrouter_metadata: { data: { prompt: 'private' } } })).toBeNull();
    expect(parseOpenRouterTrace(null)).toBeNull();
  });

  it('attaches each trace only to the analysis stage that produced it', async () => {
    const malformedReport = structuredClone(validReportV3) as any;
    malformedReport.tradePlan.summary = 'The 1h chart confirms this 15m chart.';
    const traces: ProviderTrace[] = [
      Object.freeze({ generationId: 'gen-visual', returnedModel: 'model-visual' }),
      Object.freeze({ generationId: 'gen-signal', returnedModel: 'model-signal' }),
      Object.freeze({ generationId: 'gen-reasoning', returnedModel: 'model-reasoning' }),
    ];
    const provider = new TracedFixtureProvider(
      [validVisualWireFacts, validSignalFacts, malformedReport],
      traces,
    );
    let caught: unknown;

    try {
      await runThreeStageAnalysis({
        config,
        provider,
        image: { mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' },
        context: { instrument: 'BTC/USDT', timeframe: '15m', site: 'tradingview', exchange: 'BINANCE' },
        outputLanguage: 'en',
        signal: new AbortController().signal,
      });
    } catch (error) { caught = error; }

    expect(getProviderFailureDetail(caught)?.snapshot?.stages.map((stage) => stage.providerTrace)).toEqual(traces);
  });
});
