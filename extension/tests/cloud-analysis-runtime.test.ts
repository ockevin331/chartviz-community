import { describe, expect, it, vi } from 'vitest';
import completedFixture from '../contracts/extension-cloud/v1/fixtures/single-completed-task.json';
import multiCompletedFixture from '../contracts/extension-cloud/v1/fixtures/multi-completed-task.json';
import {
  CloudAnalysisRuntime,
} from '../src/analysis/runtime/cloud-analysis-runtime';
import {
  AnalysisRuntimeFailure,
  type AnalysisCapture,
} from '../src/analysis/runtime/analysis-runtime';
import { CloudConnectionError } from '../src/cloud/cloud-client';
import { parseExtensionAnalysisTask } from '../src/cloud/cloud-task-schema';
import type { PresentationSourceCapture } from '../src/annotations/build-presentation-annotations';
import { adaptCloudPresentation } from '../src/presentation/cloud-presentation-adapter';
import type { PresentationDrawing } from '../src/presentation/report-presentation-model';
import { presentationAnnotatedImages } from './community-ui-fixtures';

const token = `cv_live_${'x'.repeat(43)}`;
const account = {
  emailMasked: 'k***n@example.com', plan: 'advance' as const,
  currentPeriodEnd: '2026-09-28T00:00:00+00:00',
  quota: { limit: 100, used: 1, remaining: 99, unlimited: false },
  selectedModel: { id: 'openai/gpt-5.4', name: 'GPT-5.4', quotaCost: 2 },
  entitlements: { multiTimeframe: true, maxCaptures: 3 },
};
const completed = parseExtensionAnalysisTask(structuredClone(completedFixture));
const pending = parseExtensionAnalysisTask({
  ...completed,
  status: 'pending',
  report: null,
  progressEvents: [{ code: 'preparing', createdAt: '2026-08-28T00:00:00Z' }],
});
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

function dependencies(options: Readonly<{
  tasks?: readonly typeof completed[];
  cancelTask?: () => Promise<typeof completed>;
  createTask?: () => Promise<typeof pending>;
}> = {}) {
  const tasks = [...(options.tasks ?? [completed])];
  const client = {
    createTask: vi.fn(options.createTask ?? (async () => pending)),
    task: vi.fn(async () => tasks.shift() ?? completed),
    cancelTask: vi.fn(options.cancelTask ?? (async () => ({
      ...pending, status: 'cancelled' as const,
    }))),
    capture: vi.fn(),
  };
  const sleep = vi.fn(async (_delayMs: number, _signal: AbortSignal): Promise<void> => undefined);
  const buildAnnotations = vi.fn(async (
    _captures: readonly PresentationSourceCapture[],
    _drawings: readonly PresentationDrawing[],
  ) => presentationAnnotatedImages);
  const runtime = new CloudAnalysisRuntime({
    client,
    connection: { load: async () => ({ token, account }) },
    sleep,
    adaptPresentation: adaptCloudPresentation,
    buildAnnotations,
  });
  return { runtime, client, sleep, buildAnnotations };
}

describe('CloudAnalysisRuntime', () => {
  it('creates, polls, and completes without capture downloads', async () => {
    const test = dependencies();
    const progress = vi.fn();

    const result = await test.runtime.analyze({
      captures: [capture], outputLanguage: 'en', onProgress: progress,
    });

    expect(test.client.createTask).toHaveBeenCalledTimes(1);
    expect(test.client.task).toHaveBeenCalledWith(
      token, pending.requestId, expect.any(AbortSignal),
    );
    expect(test.client.capture).not.toHaveBeenCalled();
    expect(result.captures).toEqual([capture]);
    expect(result.presentation.schemaVersion).toBe('presentation-1.0');
    expect(test.buildAnnotations).toHaveBeenCalledWith(
      [{ captureId: 'C01', image: capture.image }],
      expect.any(Array),
    );
    expect(progress.mock.calls.map(([code]) => code)).toEqual([
      'preparing', 'reading_chart', 'reviewing_clues', 'checking_signals',
      'preparing_result',
    ]);
  });

  it('submits and presents three captures in their exact input order', async () => {
    const multiCompleted = parseExtensionAnalysisTask(structuredClone(multiCompletedFixture));
    const captures = (['4h', '1h', '15m'] as const).map((timeframe, index) => ({
      ...capture,
      image: { ...capture.image, dataUrl: `data:image/png;base64,AAAA${index}` },
      context: { ...capture.context, timeframe },
    }));
    const test = dependencies({ tasks: [multiCompleted] });

    const result = await test.runtime.analyze({ captures, outputLanguage: 'en' });

    expect(test.client.createTask).toHaveBeenCalledWith(token, {
      captures,
      outputLanguage: 'en',
    });
    expect(result.captures).toEqual(captures);
    expect(test.buildAnnotations.mock.calls[0]?.[0].map(({ image }) => image))
      .toEqual(captures.map(({ image }) => image));
  });

  it.each([
    { captures: [] },
    { captures: [capture, capture, capture, capture] },
  ])(
    'rejects capture counts outside one through three before loading credentials',
    async ({ captures }) => {
      const test = dependencies();

      await expect(test.runtime.analyze({ captures, outputLanguage: 'en' }))
        .rejects.toMatchObject({ code: 'invalid_image' });
      expect(test.client.createTask).not.toHaveBeenCalled();
    },
  );

  it('stops local polling and sends one idempotent explicit cancellation request', async () => {
    const test = dependencies();
    test.sleep.mockImplementation((_delay: number, signal: AbortSignal) => (
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })
    ));
    const operation = test.runtime.analyze({ captures: [capture], outputLanguage: 'en' });
    await vi.waitFor(() => expect(test.sleep).toHaveBeenCalledTimes(1));

    test.runtime.cancel();
    test.runtime.cancel();

    await expect(operation).rejects.toMatchObject({ code: 'cancelled' });
    expect(test.client.cancelTask).toHaveBeenCalledTimes(1);
  });

  it('detaches local polling without cancelling the Cloud backend task', async () => {
    const test = dependencies();
    let pollSignal: AbortSignal | undefined;
    test.sleep.mockImplementation((_delay: number, signal: AbortSignal) => {
      pollSignal = signal;
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const operation = test.runtime.analyze({ captures: [capture], outputLanguage: 'en' });
    await vi.waitFor(() => expect(pollSignal).toBeDefined());

    test.runtime.detach();
    test.runtime.detach();

    await expect(operation).rejects.toMatchObject({ code: 'cancelled' });
    expect(pollSignal?.aborted).toBe(true);
    expect(test.client.cancelTask).not.toHaveBeenCalled();
  });

  it('returns a completed report when completion wins the explicit-cancel race', async () => {
    const test = dependencies({ cancelTask: async () => completed });
    test.sleep.mockImplementation((_delay: number, signal: AbortSignal) => (
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })
    ));
    const operation = test.runtime.analyze({ captures: [capture], outputLanguage: 'en' });
    await vi.waitFor(() => expect(test.sleep).toHaveBeenCalledTimes(1));

    test.runtime.cancel();

    await expect(operation).resolves.toMatchObject({
      presentation: { schemaVersion: 'presentation-1.0' },
    });
  });

  it('preserves only stable Cloud error details', async () => {
    const test = dependencies({ createTask: async () => {
      throw new CloudConnectionError(
        'quota_exhausted', { remaining: 0 }, 'https://www.chartviz.xyz/#pricing',
      );
    } });

    const operation = test.runtime.analyze({ captures: [capture], outputLanguage: 'en' });

    await expect(operation).rejects.toEqual(expect.objectContaining({
      code: 'quota_exhausted', params: { remaining: 0 },
      pricingUrl: 'https://www.chartviz.xyz/#pricing',
    }));
    await expect(operation).rejects.toBeInstanceOf(AnalysisRuntimeFailure);
    await expect(operation).rejects.not.toThrow(token);
    await expect(operation).rejects.not.toThrow(capture.image.dataUrl);
  });

  it('rejects a completed report whose capture metadata differs from the source', async () => {
    const mismatched = parseExtensionAnalysisTask({
      ...completed,
      report: {
        ...completed.report!,
        context: {
          ...completed.report!.context,
          captures: completed.report!.context.captures.map((item) => ({
            ...item, timeframe: '1h',
          })),
        },
      },
    });
    const test = dependencies({ tasks: [mismatched] });

    await expect(test.runtime.analyze({ captures: [capture], outputLanguage: 'en' }))
      .rejects.toMatchObject({ code: 'incompatible_report_schema' });
  });
});
