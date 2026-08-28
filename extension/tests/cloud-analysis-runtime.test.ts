import { describe, expect, it, vi } from 'vitest';
import fixture from '../contracts/extension-cloud/v1/fixtures/single-completed-task.json';
import { CloudAnalysisRuntime } from '../src/analysis/runtime/cloud-analysis-runtime';
import { AnalysisRuntimeFailure, type AnalysisCapture } from '../src/analysis/runtime/analysis-runtime';
import { CloudConnectionError, type CloudClient } from '../src/cloud/cloud-client';
import { parseExtensionAnalysisTask } from '../src/cloud/cloud-task-schema';
import type { StoredCloudActiveTask } from '../src/storage/cloud-active-task-storage';
import { annotatedImages } from './community-ui-fixtures';

const token = `cv_live_${'x'.repeat(43)}`;
const capture: AnalysisCapture = {
  image: {
    mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAAA',
    width: 1280, height: 720,
  },
  context: {
    instrument: 'BTC/USDT', timeframe: '15m', site: 'tradingview',
    exchange: 'TradingView', pageType: 'advanced-chart',
  },
};

const completed = parseExtensionAnalysisTask(fixture);
const pending = parseExtensionAnalysisTask({
  requestId: 'c_20260828_active', status: 'pending',
  progressEvents: [{ code: 'preparing', createdAt: '2026-08-28T00:00:00Z' }],
  report: null, error: null,
});
const processing = parseExtensionAnalysisTask({
  requestId: 'c_20260828_active', status: 'processing',
  progressEvents: [
    { code: 'preparing', createdAt: '2026-08-28T00:00:00Z' },
    { code: 'reading_chart', createdAt: '2026-08-28T00:00:01Z' },
  ],
  report: null, error: null,
});

function dependencies(options: {
  active?: StoredCloudActiveTask | null;
  tasks?: typeof completed[];
  cancelTask?: CloudClient['cancelTask'];
} = {}) {
  let active = options.active ?? null;
  const tasks = [...(options.tasks ?? [processing, completed])];
  const client = {
    createTask: vi.fn(async () => pending),
    task: vi.fn(async () => tasks.shift() ?? completed),
    cancelTask: vi.fn(options.cancelTask ?? (async () => ({
      ...pending, status: 'cancelled' as const,
    }))),
  };
  const storage = {
    load: vi.fn(async () => active),
    save: vi.fn(async (value: StoredCloudActiveTask) => { active = value; }),
    clear: vi.fn(async () => { active = null; }),
  };
  const sleep = vi.fn(async (_delay: number, _signal: AbortSignal): Promise<void> => undefined);
  const buildAnnotations = vi.fn(async () => annotatedImages);
  const runtime = new CloudAnalysisRuntime({
    client,
    connection: { load: vi.fn(async () => ({ token, account: {} as never })) },
    activeTask: storage,
    sleep,
    buildAnnotations,
  });
  return { runtime, client, storage, sleep, buildAnnotations, current: () => active };
}

describe('CloudAnalysisRuntime', () => {
  it('creates, persists, polls, adapts, annotates, and clears one analysis', async () => {
    const test = dependencies();
    const progress = vi.fn();

    const outcome = await test.runtime.analyze({
      captures: [capture], outputLanguage: 'en', onProgress: progress,
    });

    expect(test.runtime.capabilities()).toEqual({ multiTimeframe: false, maxTimeframes: 1 });
    expect(test.client.createTask).toHaveBeenCalledTimes(1);
    expect(test.storage.save).toHaveBeenCalledBefore(test.client.task);
    expect(test.sleep.mock.calls.map((call) => call[0])).toEqual([1000, 2000]);
    expect(progress.mock.calls.map(([code]) => code)).toEqual([
      'preparing', 'reading_chart', 'reviewing_clues', 'checking_signals',
      'preparing_result',
    ]);
    expect(outcome.report.schemaVersion).toBe('community-3.0');
    expect(test.buildAnnotations).toHaveBeenCalledTimes(1);
    expect(test.storage.clear).toHaveBeenCalledTimes(1);
  });

  it('rejects multiple captures before loading credentials or uploading', async () => {
    const test = dependencies();

    await expect(test.runtime.analyze({
      captures: [capture, capture], outputLanguage: 'en',
    })).rejects.toMatchObject({ code: 'multi_timeframe_requires_cloud' });
    expect(test.client.createTask).not.toHaveBeenCalled();
  });

  it('restores locally without a network call and resumes without duplicate creation', async () => {
    const active = { requestId: 'c_20260828_active', capture, outputLanguage: 'zh-CN' as const };
    const test = dependencies({ active, tasks: [completed] });

    await expect(test.runtime.restoreActiveAnalysis()).resolves.toEqual({
      captures: [capture], outputLanguage: 'zh-CN',
    });
    expect(test.client.task).not.toHaveBeenCalled();

    await test.runtime.analyze({ captures: [capture], outputLanguage: 'zh-CN' });
    expect(test.client.createTask).not.toHaveBeenCalled();
    expect(test.client.task).toHaveBeenCalledTimes(1);
  });

  it('stops local polling and sends one idempotent cancellation request', async () => {
    let rejectSleep: ((reason: unknown) => void) | null = null;
    const test = dependencies();
    test.sleep.mockImplementation((_delay: number, signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      rejectSleep = reject;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const operation = test.runtime.analyze({ captures: [capture], outputLanguage: 'en' });
    await vi.waitFor(() => expect(rejectSleep).not.toBeNull());

    test.runtime.cancel();
    test.runtime.cancel();

    await expect(operation).rejects.toMatchObject({ code: 'cancelled' });
    expect(test.client.cancelTask).toHaveBeenCalledTimes(1);
  });

  it('returns completion when completion wins the cancel race', async () => {
    const test = dependencies({ cancelTask: async () => completed });
    test.sleep.mockImplementation((_delay: number, signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const operation = test.runtime.analyze({ captures: [capture], outputLanguage: 'en' });
    await vi.waitFor(() => expect(test.storage.save).toHaveBeenCalled());

    test.runtime.cancel();

    await expect(operation).resolves.toMatchObject({ report: { schemaVersion: 'community-3.0' } });
    expect(test.storage.clear).toHaveBeenCalled();
  });

  it('preserves only stable Cloud error details', async () => {
    const test = dependencies();
    test.client.createTask.mockRejectedValue(new CloudConnectionError(
      'quota_exhausted', { remaining: 0 }, 'https://www.chartviz.xyz/#pricing',
    ));

    const operation = test.runtime.analyze({ captures: [capture], outputLanguage: 'en' });

    await expect(operation).rejects.toEqual(expect.objectContaining({
      code: 'quota_exhausted', params: { remaining: 0 },
      pricingUrl: 'https://www.chartviz.xyz/#pricing',
    }));
    await expect(operation).rejects.toBeInstanceOf(AnalysisRuntimeFailure);
    await expect(operation).rejects.not.toThrow(token);
    await expect(operation).rejects.not.toThrow(capture.image.dataUrl);
  });
});
