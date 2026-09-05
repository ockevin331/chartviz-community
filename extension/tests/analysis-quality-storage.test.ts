import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ value: undefined as unknown }));
const browserMock = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async () => ({ lastAnalysisQuality: state.value })),
      remove: vi.fn(async () => { state.value = undefined; }),
      set: vi.fn(async (items: Record<string, unknown>) => { state.value = items.lastAnalysisQuality; }),
    },
    session: { get: vi.fn(), remove: vi.fn(), set: vi.fn() },
    sync: { get: vi.fn(), remove: vi.fn(), set: vi.fn() },
  },
}));

vi.mock('wxt/browser', () => ({ browser: browserMock }));

import type { AnalysisQualityDiagnostic } from '../src/analysis/analysis-quality-diagnostics';
import {
  clearLastAnalysisQuality,
  loadLastAnalysisQuality,
  saveLastAnalysisQuality,
} from '../src/storage/analysis-quality-storage';

const diagnostic: AnalysisQualityDiagnostic = {
  source: 'extension_local',
  pipelineVersion: 'community-3.0',
  validationPolicyVersion: 'deterministic-1.0',
  requestId: 'quality-request-id',
  provider: 'openrouter',
  model: 'openai/gpt-5.6-terra',
  occurredAt: '2026-09-05T00:00:00.000Z',
  durationMs: 1_250,
  warnings: [{
    stage: 'evidence_reasoning',
    code: 'unexpected_source_claim',
    path: ['marketExplanation', 'priceAction', 'summary'],
    valuePreview: 'Binance API confirms this move.',
  }],
};

describe('last successful analysis quality storage', () => {
  beforeEach(() => {
    state.value = undefined;
    vi.clearAllMocks();
  });

  it('persists the latest sanitized warning diagnostic in local storage', async () => {
    await saveLastAnalysisQuality(diagnostic);

    await expect(loadLastAnalysisQuality()).resolves.toEqual(diagnostic);
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({ lastAnalysisQuality: diagnostic });
    expect(browserMock.storage.session.set).not.toHaveBeenCalled();
    expect(browserMock.storage.sync.set).not.toHaveBeenCalled();
  });

  it('bounds warning count, paths, and previews while removing secrets', async () => {
    await saveLastAnalysisQuality({
      ...diagnostic,
      warnings: Array.from({ length: 21 }, (_, index) => ({
        stage: 'evidence_reasoning' as const,
        code: 'output_language_mismatch' as const,
        path: ['summary', `${index}`.repeat(200)],
        valuePreview: index === 0 ? 'Bearer secret-access-token' : 'x'.repeat(200),
      })),
    });

    const stored = await loadLastAnalysisQuality();
    expect(stored?.warnings).toHaveLength(20);
    expect(stored?.warnings[0]?.valuePreview).toBe('[redacted]');
    expect(stored?.warnings[0]?.path.join('.').length).toBeLessThanOrEqual(160);
    expect(stored?.warnings[1]?.valuePreview).toHaveLength(120);
  });

  it('clears a stale successful warning record', async () => {
    await saveLastAnalysisQuality(diagnostic);
    await clearLastAnalysisQuality();

    await expect(loadLastAnalysisQuality()).resolves.toBeNull();
    expect(browserMock.storage.local.remove).toHaveBeenCalledWith('lastAnalysisQuality');
  });
});
