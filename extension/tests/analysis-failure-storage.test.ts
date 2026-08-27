import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ value: undefined as unknown }));
const browserMock = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async () => ({ lastAnalysisFailure: state.value })),
      remove: vi.fn(async () => { state.value = undefined; }),
      set: vi.fn(async (items: Record<string, unknown>) => { state.value = items.lastAnalysisFailure; }),
    },
    session: { get: vi.fn(), remove: vi.fn(), set: vi.fn() },
    sync: { get: vi.fn(), remove: vi.fn(), set: vi.fn() },
  },
}));

vi.mock('wxt/browser', () => ({ browser: browserMock }));

import type { AnalysisDiagnostic } from '../src/providers/provider-diagnostics';
import {
  clearLastAnalysisFailure,
  loadLastAnalysisFailure,
  saveLastAnalysisFailure,
} from '../src/storage/analysis-failure-storage';

const diagnostic: AnalysisDiagnostic = {
  source: 'extension_local',
  pipelineVersion: 'community-3.0',
  requestId: 'failure-request-id',
  provider: 'openrouter',
  model: 'openai/gpt-5.6-terra',
  stage: 'report_semantics',
  occurredAt: '2026-08-27T00:00:00.000Z',
  durationMs: 95_332,
  issues: [{
    path: 'tradePlan.summary',
    code: 'multiple_timeframes',
    valuePreview: 'The 1h chart confirms this 15m chart.',
  }],
  snapshot: {
    context: { instrument: 'BTC/USDT', timeframe: '15m', site: 'tradingview', exchange: 'BINANCE' },
    outputLanguage: 'en',
    stages: [{
      stage: 'evidence_reasoning',
      promptVersion: 'reasoning-1.0',
      schemaName: 'community_report_v3',
      hasImage: false,
      systemPrompt: 'system prompt',
      userPrompt: 'user prompt',
      output: { tradePlan: { summary: 'The 1h chart confirms this 15m chart.' } },
    }],
  },
};

describe('last local analysis failure storage', () => {
  beforeEach(() => {
    state.value = undefined;
    vi.clearAllMocks();
  });

  it('persists only the latest failure snapshot in extension-local storage', async () => {
    await saveLastAnalysisFailure(diagnostic);

    await expect(loadLastAnalysisFailure()).resolves.toEqual(diagnostic);
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({ lastAnalysisFailure: diagnostic });
    expect(browserMock.storage.session.set).not.toHaveBeenCalled();
    expect(browserMock.storage.sync.set).not.toHaveBeenCalled();

    await clearLastAnalysisFailure();
    await expect(loadLastAnalysisFailure()).resolves.toBeNull();
  });
});
