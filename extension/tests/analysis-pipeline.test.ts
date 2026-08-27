import { describe, expect, it } from 'vitest';
import { runThreeStageAnalysis } from '../src/analysis/stages/analysis-pipeline';
import { normalizeCommunitySignalFacts } from '../src/analysis/stages/normalize-signals';
import { normalizeCommunityVisualFacts } from '../src/analysis/stages/normalize-visual-facts';
import { getProviderFailureDetail } from '../src/providers/provider-diagnostics';
import { ProviderError } from '../src/providers/provider-errors';
import type {
  ProviderConfig,
  StructuredGenerationRequest,
  StructuredVisionProvider,
  ValidationResult,
} from '../src/providers/provider-types';
import { parseStructuredResponse } from '../src/providers/structured-response';
import { validReportV3, validSignalFacts, validVisualFacts } from './three-stage-fixtures';

const config: ProviderConfig = {
  provider: 'openrouter', apiKey: 'test-key', model: 'openai/gpt-5.6-terra', customModel: false,
};
const context = { instrument: 'BTC/USDT', timeframe: '15m', site: 'tradingview', exchange: 'BINANCE' };
const image = { mediaType: 'image/png' as const, dataUrl: 'data:image/png;base64,AAAA' };

type RecordedRequest = Omit<StructuredGenerationRequest<unknown>, 'parse' | 'signal'> & {
  hasImage: boolean;
  signal: AbortSignal;
};

class FixtureProvider implements StructuredVisionProvider {
  readonly kind = 'openrouter' as const;
  readonly calls: RecordedRequest[] = [];
  private index = 0;

  constructor(private readonly fixtures: unknown[]) {}

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
    });
    const fixture = this.fixtures[this.index++];
    if (fixture instanceof Error) throw fixture;
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
      'community_visual_facts', 'community_signal_facts', 'community_report_v3',
    ]);
    expect(provider.calls.map(({ hasImage }) => hasImage)).toEqual([true, true, false]);
    expect(provider.calls[0]?.systemPrompt).toContain('visual evidence extractor');
    expect(provider.calls[1]?.userPrompt).toContain('Previously validated visual facts');
    expect(provider.calls[2]?.userPrompt).toContain('Validated evidence');
    expect(provider.calls[0]?.userPrompt).not.toMatch(/Output language|Simplified Chinese/);
    expect(provider.calls[1]?.userPrompt).not.toMatch(/Output language|Simplified Chinese/);
    expect(provider.calls[2]?.userPrompt).toContain('Output language: English.');
    expect(new Set(provider.calls.map(({ signal }) => signal)).size).toBe(1);
    expect(progress).toEqual(['reading_chart', 'organizing_evidence', 'preparing_result']);
    expect(report.schemaVersion).toBe('community-3.0');
    expect(report.tradeSignals[0]?.stopLoss.yRatio).toBeCloseTo(0.42, 6);
    expect(report.tradeSignals[0]?.riskReward).toBe('1:2');
  });

  it('normalizes monotonic price coordinates while preserving the signal-candle arrow coordinate', () => {
    const visual = normalizeCommunityVisualFacts(clone(validVisualFacts));
    const signals = normalizeCommunitySignalFacts(clone(validSignalFacts), visual);

    expect(signals.signals[0]?.entry).toMatchObject({ xRatio: 0.86, yRatio: 0.36 });
    expect(signals.signals[0]?.stopLoss.yRatio).toBeCloseTo(0.42, 6);
    expect(signals.signals[0]?.riskReward).toBe('1:2');

    const nonMonotonic = clone(validVisualFacts) as any;
    nonMonotonic.priceScaleAnchors.push({ price: 65_000, label: '65,000', yRatio: 0.7 });
    expect(() => normalizeCommunityVisualFacts(nonMonotonic)).toThrow();
  });

  it('stops at the failing stage and exposes only its safe stage classification', async () => {
    const malformedSignals = clone(validSignalFacts) as any;
    malformedSignals.signals[0].takeProfits = [];
    const provider = new FixtureProvider([validVisualFacts, malformedSignals, validReportV3]);
    let caught: unknown;

    try { await runThreeStageAnalysis(input(provider)); }
    catch (error) { caught = error; }

    expect(caught).toMatchObject({ code: 'invalid_response' });
    expect(getProviderFailureDetail(caught)).toMatchObject({ stage: 'signal_extraction_shape' });
    expect(provider.calls).toHaveLength(2);
    const serialized = JSON.stringify(getProviderFailureDetail(caught));
    expect(serialized).not.toMatch(/data:image|test-key|Previously validated visual facts|Validated evidence/);
  });

  it('classifies deterministic anchor validation as visual semantics without another model call', async () => {
    const nonMonotonic = clone(validVisualFacts) as any;
    nonMonotonic.priceScaleAnchors.push({ price: 65_000, label: '65,000', yRatio: 0.7 });
    const provider = new FixtureProvider([nonMonotonic, validSignalFacts, validReportV3]);
    let caught: unknown;

    try { await runThreeStageAnalysis(input(provider)); }
    catch (error) { caught = error; }

    expect(getProviderFailureDetail(caught)).toEqual({
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
    const provider = new FixtureProvider([validVisualFacts, validSignalFacts, chineseReport()]);

    const report = await runThreeStageAnalysis({ ...input(provider), outputLanguage: 'zh-CN' });

    expect(provider.calls[0]?.systemPrompt).toContain('visual evidence extractor');
    expect(provider.calls[1]?.systemPrompt).toContain('trade-signal visual extractor');
    expect(provider.calls[2]?.systemPrompt).toContain('price-action analyst');
    expect(provider.calls[2]?.userPrompt).toContain('Output language: Simplified Chinese.');
    expect(report.conclusion.summary).toContain('价格');
    expect(report.tradeSignals[0]?.signalType).toBe('突破后回踩');
  });

  it('rejects a final report in the wrong language without a repair request', async () => {
    const provider = new FixtureProvider([validVisualFacts, validSignalFacts, validReportV3]);
    let caught: unknown;

    try { await runThreeStageAnalysis({ ...input(provider), outputLanguage: 'zh-CN' }); }
    catch (error) { caught = error; }

    expect(getProviderFailureDetail(caught)).toEqual({
      stage: 'report_semantics',
      issues: [{ path: 'conclusion.summary', code: 'output_language_mismatch' }],
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

    expect(getProviderFailureDetail(caught)).toEqual({
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

  it('starts a fresh three-call sequence when the caller retries explicitly', async () => {
    const provider = new FixtureProvider([
      validVisualFacts, validSignalFacts, validReportV3,
      validVisualFacts, validSignalFacts, validReportV3,
    ]);

    await runThreeStageAnalysis(input(provider));
    await runThreeStageAnalysis(input(provider));

    expect(provider.calls.map(({ schemaName }) => schemaName)).toEqual([
      'community_visual_facts', 'community_signal_facts', 'community_report_v3',
      'community_visual_facts', 'community_signal_facts', 'community_report_v3',
    ]);
  });
});
