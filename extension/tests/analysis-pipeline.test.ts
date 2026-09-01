import { describe, expect, it } from 'vitest';
import { runThreeStageAnalysis } from '../src/analysis/stages/analysis-pipeline';
import { normalizeCommunitySignalFacts } from '../src/analysis/stages/normalize-signals';
import { normalizeCommunityVisualFacts } from '../src/analysis/stages/normalize-visual-facts';
import { attachProviderFailureDetail, getProviderFailureDetail } from '../src/providers/provider-diagnostics';
import { ProviderError } from '../src/providers/provider-errors';
import type {
  ProviderConfig,
  StructuredGenerationRequest,
  StructuredVisionProvider,
  ValidationResult,
} from '../src/providers/provider-types';
import { parseStructuredResponse } from '../src/providers/structured-response';
import type { ProviderTrace } from '../src/providers/openrouter-trace';
import {
  validReportV3,
  validSignalFacts,
  validVisualFacts as domainVisualFacts,
  validVisualWireFacts as validVisualFacts,
} from './three-stage-fixtures';

const config: ProviderConfig = {
  provider: 'openrouter', apiKey: 'test-key', model: 'openai/gpt-5.6-terra', customModel: false,
};
const context = { instrument: 'BTC/USDT', timeframe: '15m', site: 'tradingview', exchange: 'BINANCE' };
const image = { mediaType: 'image/png' as const, dataUrl: 'data:image/png;base64,AAAA' };

type RecordedRequest = Omit<StructuredGenerationRequest<unknown>, 'parse' | 'signal'> & {
  hasImage: boolean;
  signal: AbortSignal;
  timeoutMs?: number;
};

class FixtureProvider implements StructuredVisionProvider {
  readonly kind = 'openrouter' as const;
  readonly calls: RecordedRequest[] = [];
  private index = 0;

  constructor(
    private readonly fixtures: unknown[],
    private readonly traces: readonly (ProviderTrace | undefined)[] = [],
  ) {}

  validateConfig(): ValidationResult { return { ok: true }; }
  async testConnection(): Promise<void> {}

  async generateStructured<T>(_config: ProviderConfig, request: StructuredGenerationRequest<T>): Promise<T> {
    this.calls.push({
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      image: request.image,
      schemaName: request.schemaName,
      jsonSchema: request.jsonSchema,
      hasImage: request.image !== undefined,
      signal: request.signal,
      timeoutMs: (request as StructuredGenerationRequest<T> & { timeoutMs?: number }).timeoutMs,
    });
    const fixtureIndex = this.index++;
    const fixture = this.fixtures[fixtureIndex];
    if (fixture instanceof Error) throw fixture;
    const trace = this.traces[fixtureIndex];
    if (trace) request.onTrace?.(trace);
    return parseStructuredResponse(this.kind, structuredClone(fixture), request.parse);
  }
}

function clone<T>(value: T): T { return structuredClone(value); }

function chineseReport() {
  const report = clone(validReportV3) as any;
  Object.assign(report.conclusion, {
    summary: '价格正在可见支撑和阻力之间震荡。',
    primaryRisk: '若价格有效突破区间，当前震荡判断将失效。',
  });
  Object.assign(report.marketExplanation.priceAction, {
    summary: '近期K线在可见区间内反复重叠。',
    evidence: ['价格在区间两侧都出现了多次反应。'],
    timeAnchor: '图表右半部分',
  });
  Object.assign(report.marketExplanation.volume, {
    summary: '最近一段震荡中的成交量正在收缩。',
    implication: '参与度不足以确认方向性突破。',
    timeAnchor: '右侧成交量柱',
  });
  Object.assign(report.marketExplanation.indicators[0], {
    state: '位于中轴附近。', implication: '动能相对均衡，暂未形成明确方向。', timeAnchor: '指标面板右侧',
  });
  Object.assign(report.levels[0], { reason: '多次回调在这里出现反应。', timeAnchor: '图表中部和右侧' });
  Object.assign(report.tradePlan, { summary: '在任一边界被有效接受前，把当前行情视为尚未解决的区间。' });
  Object.assign(report.tradePlan.long, {
    condition: '价格收在阻力上方并在回踩时守住。', entry: '阻力上方出现可见接受之后。',
    stop: '重新跌回被收复的边界下方。', targets: ['下一个可见摆动高点。'], reason: '这说明买方能够维持更高价格。',
  });
  Object.assign(report.tradePlan.short, {
    condition: '价格收在支撑下方并且反抽无法收复。', entry: '支撑下方出现可见接受之后。',
    stop: '重新回到失守边界上方。', targets: ['下一个可见摆动低点。'], reason: '这说明卖方能够维持更低价格。',
  });
  Object.assign(report.tradePlan.wait, { condition: '价格仍处于区间内部。', reason: '多空双方都没有建立持续接受。' });
  Object.assign(report.tradeSignals[0], {
    signalType: '突破后回踩', signalTime: '最右侧已收盘K线', thesisAtSignal: '价格突破边界后回踩受控并保持在上方。',
    evidenceAtSignal: ['阻力前出现逐步抬高的低点。', '突破尝试时成交量有所放大。'],
  });
  Object.assign(report.patterns[0], {
    name: '上升通道', timeRange: '图表左侧至右侧', evidence: '摆动高点和低点沿平行边界逐步抬高。',
    confirmation: '价格收在通道上边界之上。', invalidation: '价格收在通道下边界之下。',
  });
  report.riskNotice = '仅用于教育性的截图分析。';
  return report;
}

function input(provider: StructuredVisionProvider, signal = new AbortController().signal) {
  return { config, provider, image, context, outputLanguage: 'en' as const, signal };
}

describe('three-stage analysis pipeline', () => {
  it('runs three ordered calls, supplies the image only to extraction, and applies language only to reasoning', async () => {
    const provider = new FixtureProvider([validVisualFacts, validSignalFacts, validReportV3]);
    const progress: string[] = [];

    const report = await runThreeStageAnalysis({
      ...input(provider), onProgress: (message) => progress.push(message),
    });

    expect(provider.calls.map(({ schemaName }) => schemaName)).toEqual([
      'community_visual_wire', 'community_signal_facts', 'community_report_v3',
    ]);
    expect(provider.calls.map(({ hasImage }) => hasImage)).toEqual([true, true, false]);
    expect(provider.calls.map(({ timeoutMs }) => timeoutMs)).toEqual([120_000, 120_000, 180_000]);
    expect(provider.calls[0]?.systemPrompt).toContain('visual evidence extractor');
    expect(provider.calls[1]?.userPrompt).toContain('Previously validated visual facts');
    expect(provider.calls[2]?.userPrompt).toContain('Validated evidence');
    expect(provider.calls[0]?.userPrompt).not.toMatch(/Output language|Simplified Chinese/);
    expect(provider.calls[1]?.userPrompt).not.toMatch(/Output language|Simplified Chinese/);
    expect(provider.calls[2]?.userPrompt).toContain('Output language: English.');
    expect(provider.calls[2]?.userPrompt).toContain('no more than four important support and resistance levels');
    expect(new Set(provider.calls.map(({ signal }) => signal)).size).toBe(1);
    expect(progress).toEqual([
      'preparing',
      'reading_chart',
      'reviewing_clues',
      'checking_signals',
      'preparing_result',
    ]);
    expect(report.schemaVersion).toBe('community-3.0');
    expect(report.tradeSignals[0]?.stopLoss.yRatio).toBeCloseTo(0.42, 6);
    expect(report.tradeSignals[0]?.riskReward).toBe('1:2');
  });

  it('records the effective timeout and prompt size for every stage in a failure snapshot', async () => {
    const upstreamFailure = new ProviderError('network_timeout', { params: { provider: 'openrouter' } });
    const provider = new FixtureProvider([validVisualFacts, validSignalFacts, upstreamFailure]);
    let caught: unknown;

    try { await runThreeStageAnalysis(input(provider)); }
    catch (error) { caught = error; }

    const stages = getProviderFailureDetail(caught)?.snapshot?.stages;
    expect(stages?.map(({ timeoutMs }) => timeoutMs)).toEqual([120_000, 120_000, 180_000]);
    expect(stages?.map(({ inputChars }) => inputChars)).toEqual(
      provider.calls.map(({ systemPrompt, userPrompt }) => systemPrompt.length + userPrompt.length),
    );
  });

  it('attaches each provider trace only to the stage that produced it', async () => {
    const malformedReport = clone(validReportV3) as any;
    malformedReport.tradePlan.summary = 'The 1h chart confirms this 15m chart.';
    const traces: ProviderTrace[] = [
      Object.freeze({ generationId: 'gen-visual', returnedModel: 'model-visual' }),
      Object.freeze({ generationId: 'gen-signal', returnedModel: 'model-signal' }),
      Object.freeze({ generationId: 'gen-reasoning', returnedModel: 'model-reasoning' }),
    ];
    const provider = new FixtureProvider(
      [validVisualFacts, validSignalFacts, malformedReport],
      traces,
    );
    let caught: unknown;

    try { await runThreeStageAnalysis(input(provider)); }
    catch (error) { caught = error; }

    expect(getProviderFailureDetail(caught)?.snapshot?.stages.map((stage) => stage.providerTrace)).toEqual(traces);
  });

  it('normalizes monotonic price coordinates while preserving the signal-candle arrow coordinate', () => {
    const visual = normalizeCommunityVisualFacts(clone(domainVisualFacts));
    const signals = normalizeCommunitySignalFacts(clone(validSignalFacts), visual);

    expect(signals.signals[0]?.entry).toMatchObject({ xRatio: 0.86, yRatio: 0.36 });
    expect(signals.signals[0]?.stopLoss.yRatio).toBeCloseTo(0.42, 6);
    expect(signals.signals[0]?.riskReward).toBe('1:2');

    const nonMonotonic = clone(domainVisualFacts) as any;
    nonMonotonic.priceScaleAnchors.push({ price: 65_000, label: '65,000', yRatio: 0.7 });
    expect(() => normalizeCommunityVisualFacts(nonMonotonic)).toThrow();
  });

  it('stops at the failing stage and preserves a secret-free snapshot', async () => {
    const malformedSignals = clone(validSignalFacts) as any;
    malformedSignals.signals[0].takeProfits = [];
    const provider = new FixtureProvider([validVisualFacts, malformedSignals, validReportV3]);
    let caught: unknown;

    try { await runThreeStageAnalysis(input(provider)); }
    catch (error) { caught = error; }

    expect(caught).toMatchObject({ code: 'invalid_response' });
    expect(getProviderFailureDetail(caught)).toMatchObject({
      stage: 'signal_extraction_shape',
      exception: { name: 'ZodError' },
    });
    expect(provider.calls).toHaveLength(2);
    const serialized = JSON.stringify(getProviderFailureDetail(caught));
    expect(serialized).toContain('Previously validated visual facts');
    expect(serialized).not.toMatch(/data:image|test-key|bearer\s|sk-[A-Za-z0-9_-]{8,}/i);
  });

  it('preserves the provider parser stage and raw output instead of flattening it to report_shape', async () => {
    const rawOutput = 'not valid JSON from the model';
    const parseFailure = attachProviderFailureDetail(
      new ProviderError('invalid_response', { params: { provider: 'openrouter' } }),
      {
        stage: 'json_parse',
        issues: [{ path: 'provider.response.output_text', code: 'invalid_json' }],
        providerOutput: rawOutput,
      } as any,
    );
    const provider = new FixtureProvider([validVisualFacts, validSignalFacts, parseFailure]);
    let caught: unknown;

    try { await runThreeStageAnalysis(input(provider)); }
    catch (error) { caught = error; }

    const detail = getProviderFailureDetail(caught);
    expect(detail?.stage).toBe('json_parse');
    expect(detail?.issues).toEqual([{
      path: 'provider.response.output_text', code: 'invalid_json',
    }]);
    expect(detail?.snapshot?.stages[2]?.output).toBe(rawOutput);
  });

  it('classifies an HTTP 500 as transport evidence instead of an empty report_shape failure', async () => {
    const upstreamFailure = new ProviderError('invalid_response', {
      params: { provider: 'openrouter' },
      httpStatus: 500,
    });
    const provider = new FixtureProvider([validVisualFacts, validSignalFacts, upstreamFailure]);
    let caught: unknown;

    try { await runThreeStageAnalysis(input(provider)); }
    catch (error) { caught = error; }

    expect(getProviderFailureDetail(caught)).toMatchObject({
      stage: 'evidence_reasoning_transport',
      issues: [{ path: 'provider.http.status', code: 'http_500' }],
    });
  });

  it('does not invent a report shape failure when the provider omitted parser detail', async () => {
    const upstreamFailure = new ProviderError('invalid_response', { params: { provider: 'openrouter' } });
    const provider = new FixtureProvider([validVisualFacts, validSignalFacts, upstreamFailure]);
    let caught: unknown;

    try { await runThreeStageAnalysis(input(provider)); }
    catch (error) { caught = error; }

    expect(getProviderFailureDetail(caught)).toMatchObject({
      stage: 'response_envelope',
      issues: [{ path: 'provider.response', code: 'missing_failure_detail' }],
    });
  });

  it('preserves a bare transport error code when provider diagnostics are absent', async () => {
    const upstreamFailure = new ProviderError('network_timeout', { params: { provider: 'openrouter' } });
    const provider = new FixtureProvider([upstreamFailure]);
    let caught: unknown;

    try { await runThreeStageAnalysis(input(provider)); }
    catch (error) { caught = error; }

    expect(getProviderFailureDetail(caught)).toMatchObject({
      stage: 'visual_extraction_transport',
      issues: [{ path: 'provider.transport', code: 'network_timeout' }],
    });
  });

  it('classifies deterministic anchor validation as visual semantics without another model call', async () => {
    const nonMonotonic = clone(validVisualFacts) as any;
    nonMonotonic.priceScaleAnchors.push({ price: 65_000, yRatio: 0.7 });
    const provider = new FixtureProvider([nonMonotonic, validSignalFacts, validReportV3]);
    let caught: unknown;

    try { await runThreeStageAnalysis(input(provider)); }
    catch (error) { caught = error; }

    expect(getProviderFailureDetail(caught)).toMatchObject({
      stage: 'visual_extraction_semantics',
      issues: [{ path: 'priceScaleAnchors.1', code: 'price_scale_not_monotonic' }],
    });
    expect(provider.calls).toHaveLength(1);
  });

  it('uses one caller-owned AbortSignal and never starts a later stage after cancellation', async () => {
    const controller = new AbortController();
    const provider = new FixtureProvider([
      validVisualFacts,
      new ProviderError('cancelled', { params: { provider: 'openrouter' } }),
      validReportV3,
    ]);

    await expect(runThreeStageAnalysis(input(provider, controller.signal))).rejects.toMatchObject({ code: 'cancelled' });
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]?.signal).toBe(controller.signal);
    expect(provider.calls[1]?.signal).toBe(controller.signal);
  });

  it('keeps prompts in English while producing a schema-valid Simplified Chinese report', async () => {
    const rawReport = chineseReport();
    rawReport.tradeSignals[0].signalType = '模型自由生成的信号名称';
    const provider = new FixtureProvider([validVisualFacts, validSignalFacts, rawReport]);

    const report = await runThreeStageAnalysis({ ...input(provider), outputLanguage: 'zh-CN' });

    expect(provider.calls[0]?.systemPrompt).toContain('visual evidence extractor');
    expect(provider.calls[1]?.systemPrompt).toContain('trade-signal visual extractor');
    expect(provider.calls[2]?.systemPrompt).toContain('price-action analyst');
    expect(provider.calls[2]?.userPrompt).toContain('Output language: Simplified Chinese.');
    expect(report.conclusion.summary).toContain('价格');
    expect(report.tradeSignals[0]?.signalType).toBe('突破后回踩');
  });

  it('uses the deterministic English label instead of model-authored signal wording', async () => {
    const rawReport = clone(validReportV3) as any;
    rawReport.tradeSignals[0].signalType = 'Model-authored wording';
    const provider = new FixtureProvider([validVisualFacts, validSignalFacts, rawReport]);

    const report = await runThreeStageAnalysis(input(provider));

    expect(report.tradeSignals[0]?.signalType).toBe('Breakout and retest');
  });

  it('localizes a supported pattern classification instead of trusting model-authored wording', async () => {
    const visual = clone(validVisualFacts) as any;
    visual.patterns[0].canonicalType = 'rising_channel';
    const rawReport = chineseReport();
    rawReport.patterns[0].name = 'Model-authored pattern name';
    const provider = new FixtureProvider([visual, validSignalFacts, rawReport]);

    const report = await runThreeStageAnalysis({ ...input(provider), outputLanguage: 'zh-CN' });

    expect(report.patterns[0]?.name).toBe('上升通道');
  });

  it('returns a custom pattern name with a soft language warning instead of failing the analysis', async () => {
    const visual = clone(validVisualFacts) as any;
    visual.patterns[0].canonicalType = null;
    visual.patterns[0].name = 'Custom visible structure';
    const rawReport = chineseReport();
    rawReport.patterns[0].name = 'Custom visible structure';
    const provider = new FixtureProvider([visual, validSignalFacts, rawReport]);
    const warnings: unknown[] = [];

    const report = await runThreeStageAnalysis({
      ...input(provider), outputLanguage: 'zh-CN', onWarning: (warning: unknown) => warnings.push(warning),
    } as any);

    expect(report.patterns[0]?.name).toBe('Custom visible structure');
    expect(warnings).toEqual([{
      code: 'output_language_mismatch', path: ['patterns', 0, 'name'], valuePreview: 'Custom visible structure',
    }]);
  });

  it('accepts a standard technical acronym as a Chinese trade-plan target', async () => {
    const report = chineseReport();
    report.tradePlan.short.targets = ['VWAP'];
    const provider = new FixtureProvider([validVisualFacts, validSignalFacts, report]);

    const result = await runThreeStageAnalysis({ ...input(provider), outputLanguage: 'zh-CN' });

    expect(result.tradePlan.short.targets).toEqual(['VWAP']);
    expect(provider.calls).toHaveLength(3);
  });

  it('returns a report in the wrong language with warnings and without a repair request', async () => {
    const provider = new FixtureProvider([validVisualFacts, validSignalFacts, validReportV3]);
    const warnings: unknown[] = [];

    const report = await runThreeStageAnalysis({
      ...input(provider), outputLanguage: 'zh-CN', onWarning: (warning) => warnings.push(warning),
    });

    expect(report.conclusion.summary).toBe('Price is rotating between visible support and resistance.');
    expect(warnings).toContainEqual({
      path: ['conclusion', 'summary'], code: 'output_language_mismatch',
      valuePreview: 'Price is rotating between visible support and resistance.',
    });
    expect(provider.calls).toHaveLength(3);
  });

  it('returns an English trade-plan target in Chinese output with a safe warning', async () => {
    const report = chineseReport();
    report.tradePlan.short.targets = ['previous low'];
    const provider = new FixtureProvider([validVisualFacts, validSignalFacts, report]);
    const warnings: unknown[] = [];

    const result = await runThreeStageAnalysis({
      ...input(provider), outputLanguage: 'zh-CN', onWarning: (warning) => warnings.push(warning),
    });

    expect(result.tradePlan.short.targets).toEqual(['previous low']);
    expect(warnings).toContainEqual({
      path: ['tradePlan', 'short', 'targets', 0], code: 'output_language_mismatch',
      valuePreview: 'previous low',
    });
    expect(provider.calls).toHaveLength(3);
  });

  it('reports the exact visible field that exposes an internal evidence id', async () => {
    const alteredReport = clone(validReportV3) as any;
    alteredReport.tradePlan.summary = 'Wait while L01 remains under review.';
    const provider = new FixtureProvider([validVisualFacts, validSignalFacts, alteredReport]);
    let caught: unknown;

    try { await runThreeStageAnalysis(input(provider)); }
    catch (error) { caught = error; }

    expect(getProviderFailureDetail(caught)).toMatchObject({
      stage: 'report_semantics',
      issues: [{ path: 'tradePlan.summary', code: 'internal_evidence_id_exposed' }],
    });
    expect(provider.calls).toHaveLength(3);
  });

  it('keeps chart identity and level coordinates anchored to extracted evidence', async () => {
    const alteredReport = clone(validReportV3) as any;
    alteredReport.chart.instrument = 'INVENTED/PAIR';
    alteredReport.levels[0].type = 'resistance';
    alteredReport.levels[0].priceLabel = '99,999';
    alteredReport.levels[0].yRatio = 0.1;
    alteredReport.levels[0].confidence = 0.1;
    const provider = new FixtureProvider([validVisualFacts, validSignalFacts, alteredReport]);

    const report = await runThreeStageAnalysis(input(provider));

    expect(report.chart).toEqual({ instrument: 'BTC/USDT', timeframe: '15m' });
    expect(report.levels[0]).toMatchObject({
      id: 'L01', type: 'support', priceLabel: '64,000', yRatio: 0.6, confidence: 0.86,
    });
  });

  it('accepts three layered supports and one resistance when the total stays within four', async () => {
    const visualFacts = clone(validVisualFacts) as any;
    visualFacts.levels = [
      visualFacts.levels[0],
      { id: 'L02', type: 'support', priceLabel: '63,000', price: null, yRatio: 0.66, reason: 'A deeper reaction formed here.', timeAnchor: 'Left side', confidence: 0.74 },
      { id: 'L03', type: 'support', priceLabel: '62,000', price: null, yRatio: 0.71, reason: 'The visible base formed here.', timeAnchor: 'Far left', confidence: 0.68 },
      { id: 'L04', type: 'resistance', priceLabel: '66,000', price: 66_000, yRatio: 0.2, reason: 'Repeated highs stalled here.', timeAnchor: 'Right side', confidence: 0.81 },
    ];
    const report = clone(validReportV3) as any;
    report.levels = [
      report.levels[0],
      { id: 'L02', type: 'support', tier: 'secondary', status: 'holding', priceLabel: '63,000', reason: 'A deeper reaction formed here.', timeAnchor: 'Left side', yRatio: 0.66, confidence: 0.74 },
      { id: 'L03', type: 'support', tier: 'major', status: 'holding', priceLabel: '62,000', reason: 'The visible base formed here.', timeAnchor: 'Far left', yRatio: 0.71, confidence: 0.68 },
      { id: 'L04', type: 'resistance', tier: 'nearest', status: 'testing', priceLabel: '66,000', reason: 'Repeated highs stalled here.', timeAnchor: 'Right side', yRatio: 0.2, confidence: 0.81 },
    ];
    const provider = new FixtureProvider([visualFacts, validSignalFacts, report]);

    const result = await runThreeStageAnalysis(input(provider));

    expect(result.levels).toHaveLength(4);
    expect(result.levels.filter(({ type }) => type === 'support')).toHaveLength(3);
    expect(provider.calls).toHaveLength(3);
  });

  it('anchors the final chart timeframe before semantic validation', async () => {
    const alteredReport = clone(validReportV3) as any;
    alteredReport.chart = { instrument: 'INVENTED/PAIR', timeframe: '15m and 1h' };
    const provider = new FixtureProvider([validVisualFacts, validSignalFacts, alteredReport]);

    const report = await runThreeStageAnalysis(input(provider));

    expect(report.chart).toEqual({ instrument: 'BTC/USDT', timeframe: '15m' });
    expect(provider.calls).toHaveLength(3);
  });

  it('preserves the exact offending field and three-stage failure snapshot', async () => {
    const alteredReport = clone(validReportV3) as any;
    alteredReport.tradePlan.summary = 'The 1h chart confirms this 15m chart.';
    const provider = new FixtureProvider([validVisualFacts, validSignalFacts, alteredReport]);
    let caught: unknown;

    try { await runThreeStageAnalysis(input(provider)); }
    catch (error) { caught = error; }

    expect(getProviderFailureDetail(caught)).toMatchObject({
      stage: 'report_semantics',
      issues: [{
        path: 'tradePlan.summary',
        code: 'multiple_timeframes',
        valuePreview: 'The 1h chart confirms this 15m chart.',
      }],
      snapshot: {
        context,
        outputLanguage: 'en',
        stages: [
          {
            stage: 'visual_extraction', promptVersion: 'visual-2.0',
            schemaName: 'community_visual_wire', hasImage: true,
            output: validVisualFacts,
          },
          {
            stage: 'signal_extraction', promptVersion: 'signals-1.2',
            schemaName: 'community_signal_facts', hasImage: true,
            output: validSignalFacts,
          },
          {
            stage: 'evidence_reasoning', promptVersion: 'reasoning-1.3',
            schemaName: 'community_report_v3', hasImage: false,
            output: alteredReport,
          },
        ],
      },
    });
    const snapshot = (getProviderFailureDetail(caught) as any)?.snapshot;
    expect(snapshot.stages[2].systemPrompt).toContain('price-action analyst');
    expect(snapshot.stages[2].userPrompt).toContain('Validated evidence');
    expect(JSON.stringify(snapshot)).not.toMatch(/data:image|api.?key|bearer\s|sk-[A-Za-z0-9_-]{8,}/i);
  });

  it('starts a fresh three-call sequence when the caller retries explicitly', async () => {
    const provider = new FixtureProvider([
      validVisualFacts, validSignalFacts, validReportV3,
      validVisualFacts, validSignalFacts, validReportV3,
    ]);

    await runThreeStageAnalysis(input(provider));
    await runThreeStageAnalysis(input(provider));

    expect(provider.calls.map(({ schemaName }) => schemaName)).toEqual([
      'community_visual_wire', 'community_signal_facts', 'community_report_v3',
      'community_visual_wire', 'community_signal_facts', 'community_report_v3',
    ]);
  });
});
