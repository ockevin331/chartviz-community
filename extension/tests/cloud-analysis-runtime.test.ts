import { describe, expect, it, vi } from 'vitest';
import fixture from '../contracts/extension-cloud/v1/fixtures/single-completed-task.json';
import twoFixture from '../contracts/extension-cloud/v1/fixtures/two-completed-task.json';
import {
  CloudAnalysisRuntime,
  type CloudAnalysisRuntimeDependencies,
} from '../src/analysis/runtime/cloud-analysis-runtime';
import { AnalysisRuntimeFailure, type AnalysisCapture } from '../src/analysis/runtime/analysis-runtime';
import {
  CloudConnectionError,
  createCloudClient,
  type CloudClient,
  type DownloadedCapture,
} from '../src/cloud/cloud-client';
import type { StoredCaptureDescriptor } from '../src/cloud/cloud-capture-descriptors';
import { parseExtensionAnalysisTask } from '../src/cloud/cloud-task-schema';
import {
  createCloudActiveTaskStorage,
  type CloudActiveTaskLockManager,
  type StoredCloudActiveTask,
} from '../src/storage/cloud-active-task-storage';
import type { StoredCloudConnection } from '../src/storage/cloud-connection-storage';
import { parsePresentationBundle } from '../src/presentation/report-presentation-model';
import { adaptCloudPresentation } from '../src/presentation/cloud-presentation-adapter';
import { presentationAnnotatedImages } from './community-ui-fixtures';
import { validPresentationBundle } from './presentation-fixtures';

const token = `cv_live_${'x'.repeat(43)}`;
const rotatedToken = `cv_live_${'y'.repeat(43)}`;
const fingerprint = 'a'.repeat(64);
const rotatedFingerprint = 'b'.repeat(64);
const account: StoredCloudConnection['account'] = {
  emailMasked: 'a***z@example.com',
  plan: 'advance',
  currentPeriodEnd: '2026-09-28T00:00:00+00:00',
  quota: { limit: null, used: 3, remaining: null, unlimited: true },
  selectedModel: { id: 'openai/gpt-5.4', name: 'GPT-5.4', quotaCost: 2 },
  entitlements: { multiTimeframe: true, maxCaptures: 3 },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, reject, resolve };
}

class RuntimeSharedExclusiveLock implements CloudActiveTaskLockManager {
  requests = 0;
  private tail: Promise<void> = Promise.resolve();

  request<T>(
    _name: string,
    _options: Readonly<{ mode: 'exclusive' }>,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.requests += 1;
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function runtimeActiveTaskStorage(
  initial: StoredCloudActiveTask,
  lock: CloudActiveTaskLockManager,
) {
  const key = 'chartvizCloudActiveTask';
  let value: unknown = structuredClone(initial);
  const storage = createCloudActiveTaskStorage({
    get: async (requestedKey) => value === undefined
      ? {}
      : { [requestedKey]: structuredClone(value) },
    set: async (items) => { value = structuredClone(items[key]); },
    remove: async () => { value = undefined; },
  }, lock);
  return storage;
}

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

const captures: readonly AnalysisCapture[] = [
  { ...capture, image: { ...capture.image, dataUrl: 'data:image/png;base64,AAAA' }, context: { ...capture.context, timeframe: '4h' } },
  { ...capture, image: { ...capture.image, dataUrl: 'data:image/png;base64,BBBB' }, context: { ...capture.context, timeframe: '1h' } },
  { ...capture, image: { ...capture.image, dataUrl: 'data:image/png;base64,CCCC' }, context: { ...capture.context, timeframe: '15m' } },
];

const storedCaptures: readonly StoredCaptureDescriptor[] = [
  {
    captureId: 'C01', timeframe: '4h', role: 'context', instrument: 'BTC/USDT',
    site: 'tradingview', exchange: 'TradingView', pageType: 'advanced-chart',
    width: 1280, height: 720,
  },
  {
    captureId: 'C02', timeframe: '1h', role: 'setup', instrument: 'BTC/USDT',
    site: 'tradingview', exchange: 'TradingView', pageType: 'advanced-chart',
    width: 1280, height: 720,
  },
  {
    captureId: 'C03', timeframe: '15m', role: 'trigger', instrument: 'BTC/USDT',
    site: 'tradingview', exchange: 'TradingView', pageType: 'advanced-chart',
    width: 1280, height: 720,
  },
];

const singleStoredCapture: StoredCaptureDescriptor = {
  captureId: 'C01', timeframe: '15m', role: null, instrument: 'BTC/USDT',
  site: 'tradingview', exchange: 'TradingView', pageType: 'advanced-chart',
  width: 1280, height: 720,
};

const captureDataUrls = [
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABQAAAALQCAYAAADPfd1WAAAACElEQVR4nAMAAAAAAUgGidIAAAAASUVORK5CYII=',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABQAAAALQCAYAAADPfd1WAAAACElEQVR4nAMAAAAAAtEP2GgAAAAASUVORK5CYII=',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABQAAAALQCAYAAADPfd1WAAAACElEQVR4nAMAAAAAA6YI6P4AAAAASUVORK5CYII=',
] as const;

const testPngSignature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function testCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function testPngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength);
  for (let index = 0; index < 4; index += 1) {
    chunk[4 + index] = type.charCodeAt(index);
  }
  chunk.set(data, 8);
  view.setUint32(8 + data.byteLength, testCrc32(chunk.subarray(4, 8 + data.byteLength)));
  return chunk;
}

function joinTestBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy.buffer;
}

function testPngParts(width = 1280, height = 720, marker = 1) {
  const ihdrData = new Uint8Array(13);
  const header = new DataView(ihdrData.buffer);
  header.setUint32(0, width);
  header.setUint32(4, height);
  ihdrData.set([8, 6, 0, 0, 0], 8);
  return {
    signature: testPngSignature,
    ihdr: testPngChunk('IHDR', ihdrData),
    idat: testPngChunk('IDAT', Uint8Array.from([120, 156, 3, 0, 0, 0, 0, marker])),
    iend: testPngChunk('IEND', new Uint8Array()),
  };
}

function pngBytes(width = 1280, height = 720, marker = 1): ArrayBuffer {
  const parts = testPngParts(width, height, marker);
  return exactArrayBuffer(joinTestBytes(parts.signature, parts.ihdr, parts.idat, parts.iend));
}

const malformedPng = (() => {
  const parts = testPngParts();
  const valid = new Uint8Array(pngBytes());
  const truncatedData = new Uint8Array(10);
  const truncatedDataView = new DataView(truncatedData.buffer);
  truncatedDataView.setUint32(0, 4);
  truncatedData.set([73, 68, 65, 84, 1, 2], 4);
  const ihdrCrcMismatch = valid.slice();
  const ihdrCrcIndex = parts.signature.byteLength + parts.ihdr.byteLength - 1;
  ihdrCrcMismatch[ihdrCrcIndex] = ihdrCrcMismatch[ihdrCrcIndex]! ^ 0xff;
  const idatCrcMismatch = valid.slice();
  const idatCrcIndex = parts.signature.byteLength
    + parts.ihdr.byteLength
    + parts.idat.byteLength
    - 1;
  idatCrcMismatch[idatCrcIndex] = idatCrcMismatch[idatCrcIndex]! ^ 0xff;
  return {
    ihdrOnly: exactArrayBuffer(joinTestBytes(parts.signature, parts.ihdr)),
    missingIend: exactArrayBuffer(joinTestBytes(parts.signature, parts.ihdr, parts.idat)),
    missingIdat: exactArrayBuffer(joinTestBytes(parts.signature, parts.ihdr, parts.iend)),
    truncatedChunkHeader: exactArrayBuffer(joinTestBytes(
      parts.signature, parts.ihdr, parts.idat, parts.iend.subarray(0, 2),
    )),
    truncatedData: exactArrayBuffer(joinTestBytes(parts.signature, parts.ihdr, truncatedData)),
    truncatedCrc: exactArrayBuffer(valid.slice(
      0,
      parts.signature.byteLength + parts.ihdr.byteLength + parts.idat.byteLength - 1,
    )),
    ihdrCrcMismatch: exactArrayBuffer(ihdrCrcMismatch),
    idatCrcMismatch: exactArrayBuffer(idatCrcMismatch),
    malformedIendLength: exactArrayBuffer(joinTestBytes(
      parts.signature,
      parts.ihdr,
      parts.idat,
      testPngChunk('IEND', Uint8Array.of(0)),
    )),
    trailingBytes: exactArrayBuffer(joinTestBytes(valid, Uint8Array.of(0))),
    duplicateIhdr: exactArrayBuffer(joinTestBytes(
      parts.signature, parts.ihdr, parts.ihdr, parts.idat, parts.iend,
    )),
    noncontiguousIdat: exactArrayBuffer(joinTestBytes(
      parts.signature,
      parts.ihdr,
      parts.idat,
      testPngChunk('tEXt', Uint8Array.of(0)),
      parts.idat,
      parts.iend,
    )),
  };
})();

function downloadedCapture(captureId: 'C01' | 'C02' | 'C03'): DownloadedCapture {
  return {
    mediaType: 'image/png',
    bytes: pngBytes(1280, 720, Number(captureId.slice(-1))),
  };
}

const multiCaptureMetadata = [
  { captureId: 'C01', timeframe: '4h', role: 'context' as const },
  { captureId: 'C02', timeframe: '1h', role: 'setup' as const },
  { captureId: 'C03', timeframe: '15m', role: 'trigger' as const },
];

function multiCompletedTask() {
  const value = structuredClone(fixture);
  return parseExtensionAnalysisTask({
    ...value,
    report: {
      ...value.report,
      context: {
        ...value.report.context,
        captures: multiCaptureMetadata.map((item) => ({
          ...value.report.context.captures[0]!,
          ...item,
        })),
      },
      timeframeViews: multiCaptureMetadata.map((item) => ({
        ...value.report.timeframeViews[0]!,
        ...item,
      })),
    },
  });
}

function multiPresentationBundle() {
  const value = structuredClone(validPresentationBundle);
  return parsePresentationBundle({
    ...value,
    report: {
      ...value.report,
      context: {
        ...value.report.context,
        captures: multiCaptureMetadata.map((item) => ({
          ...value.report.context.captures[0]!,
          ...item,
        })),
      },
      timeframeViews: multiCaptureMetadata.map((item) => ({
        ...value.report.timeframeViews[0]!,
        ...item,
      })),
    },
  });
}

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
  cleanup?: { requestId: string; tokenFingerprint: string } | null;
  connectionToken?: string;
  tasks?: typeof completed[];
  cancelTask?: CloudClient['cancelTask'];
  presentation?: ReturnType<typeof parsePresentationBundle>;
  adaptPresentation?: typeof adaptCloudPresentation;
  capture?: CloudClient['capture'];
} = {}) {
  let active = options.active ?? null;
  let cleanup = options.cleanup ?? null;
  const tasks = [...(options.tasks ?? [processing, completed])];
  const client = {
    createTask: vi.fn(async () => pending),
    task: vi.fn(async () => tasks.shift() ?? completed),
    cancelTask: vi.fn(options.cancelTask ?? (async () => ({
      ...pending, status: 'cancelled' as const,
    }))),
    capture: vi.fn(options.capture ?? (async (_token, _requestId, captureId) => (
      downloadedCapture(captureId)
    ))),
  };
  const storage = {
    load: vi.fn(async () => active),
    save: vi.fn(async (value: StoredCloudActiveTask) => { active = value; }),
    clear: vi.fn(async (expectedRequestId?: string) => {
      if (expectedRequestId === undefined || active?.requestId === expectedRequestId) active = null;
    }),
  };
  const cleanupStorage = {
    load: vi.fn(async () => cleanup),
    save: vi.fn(async (value: { requestId: string; tokenFingerprint: string }) => { cleanup = value; }),
    clear: vi.fn(async () => { cleanup = null; }),
  };
  const connectionToken = options.connectionToken ?? token;
  const fingerprintGrant = vi.fn(async (value: string) =>
    value === rotatedToken ? rotatedFingerprint : fingerprint);
  const sleep = vi.fn(async (_delay: number, _signal: AbortSignal): Promise<void> => undefined);
  const adaptPresentation = vi.fn(options.adaptPresentation ?? (() => options.presentation
    ?? parsePresentationBundle(structuredClone(validPresentationBundle))));
  const buildAnnotations = vi.fn(async () => presentationAnnotatedImages);
  const runtimeDependencies: CloudAnalysisRuntimeDependencies = {
    client,
    connection: { load: vi.fn(async () => ({ token: connectionToken, account })) },
    activeTask: storage,
    cleanupPending: cleanupStorage,
    fingerprintGrant,
    sleep,
    adaptPresentation,
    buildAnnotations,
  };
  const createRuntime = () => new CloudAnalysisRuntime(runtimeDependencies);
  const runtime = createRuntime();
  return {
    runtime,
    recreateRuntime: createRuntime,
    client,
    storage,
    cleanupStorage,
    fingerprintGrant,
    sleep,
    adaptPresentation,
    buildAnnotations,
    current: () => active,
    currentCleanup: () => cleanup,
  };
}

describe('CloudAnalysisRuntime', () => {
  it('creates, persists, polls, adapts, annotates, and clears one analysis', async () => {
    const test = dependencies();
    const progress = vi.fn();

    const outcome = await test.runtime.analyze({
      captures: [capture], outputLanguage: 'en', onProgress: progress,
    });

    expect(test.runtime.capabilities()).toEqual({ multiTimeframe: true, maxTimeframes: 3 });
    expect(test.client.createTask).toHaveBeenCalledTimes(1);
    expect(test.client.capture).not.toHaveBeenCalled();
    expect(test.storage.save).toHaveBeenCalledBefore(test.client.task);
    expect(test.storage.save).toHaveBeenCalledWith({
      requestId: pending.requestId,
      tokenFingerprint: fingerprint,
      captures: [singleStoredCapture],
      outputLanguage: 'en',
    });
    expect(test.sleep.mock.calls.map((call) => call[0])).toEqual([1000, 2000]);
    expect(progress.mock.calls.map(([code]) => code)).toEqual([
      'preparing', 'reading_chart', 'reviewing_clues', 'checking_signals',
      'preparing_result',
    ]);
    expect(outcome.presentation.schemaVersion).toBe('presentation-1.0');
    expect(outcome.captures).toEqual([capture]);
    expect(test.adaptPresentation).toHaveBeenCalledWith(completed.report);
    expect(test.buildAnnotations).toHaveBeenCalledTimes(1);
    expect(test.buildAnnotations).toHaveBeenCalledWith(
      [{ captureId: 'C01', image: capture.image }],
      validPresentationBundle.drawings,
    );
    expect(test.storage.clear).toHaveBeenCalledTimes(1);
  });

  it('persists and annotates three exact source images in report capture order', async () => {
    const completedMulti = multiCompletedTask();
    const presentation = multiPresentationBundle();
    const test = dependencies({ tasks: [completedMulti], presentation });

    await test.runtime.analyze({ captures, outputLanguage: 'en' });

    expect(test.client.createTask).toHaveBeenCalledWith(token, {
      captures,
      outputLanguage: 'en',
    });
    expect(test.storage.save).toHaveBeenCalledWith({
      requestId: pending.requestId,
      tokenFingerprint: fingerprint,
      captures: storedCaptures,
      outputLanguage: 'en',
    });
    expect(test.client.capture).not.toHaveBeenCalled();
    expect(test.storage.save).toHaveBeenCalledBefore(test.client.task);
    expect(test.buildAnnotations).toHaveBeenCalledWith([
      { captureId: 'C01', image: captures[0]!.image },
      { captureId: 'C02', image: captures[1]!.image },
      { captureId: 'C03', image: captures[2]!.image },
    ], presentation.drawings);
  });

  it('completes a valid two-capture report with setup_and_trigger presentation role', async () => {
    const twoCompleted = parseExtensionAnalysisTask(structuredClone(twoFixture));
    const twoCaptures = [
      { ...capture, image: { ...capture.image, dataUrl: 'data:image/png;base64,AAAA' }, context: { ...capture.context, timeframe: '4h' } },
      { ...capture, image: { ...capture.image, dataUrl: 'data:image/png;base64,BBBB' }, context: { ...capture.context, timeframe: '15m' } },
    ];
    const test = dependencies({ tasks: [twoCompleted], adaptPresentation: adaptCloudPresentation });

    const outcome = await test.runtime.analyze({ captures: twoCaptures, outputLanguage: 'en' });

    expect(outcome.presentation.context.captures.map(({ role }) => role)).toEqual([
      'context', 'setup_and_trigger',
    ]);
    expect(test.buildAnnotations).toHaveBeenCalledWith([
      { captureId: 'C01', image: twoCaptures[0]!.image },
      { captureId: 'C02', image: twoCaptures[1]!.image },
    ], expect.any(Array));
  });

  it.each([
    { invalidCaptures: [] },
    { invalidCaptures: [capture, capture, capture, capture] },
  ])('rejects capture counts outside one through three before loading credentials', async ({ invalidCaptures }) => {
    const test = dependencies();

    await expect(test.runtime.analyze({
      captures: invalidCaptures, outputLanguage: 'en',
    })).rejects.toMatchObject({ code: 'invalid_image' });
    expect(test.client.createTask).not.toHaveBeenCalled();
  });

  it('polls once, downloads descriptors, and restores PNG captures only in memory', async () => {
    const completedMulti = multiCompletedTask();
    const active = {
      requestId: 'c_20260828_active', tokenFingerprint: fingerprint,
      captures: storedCaptures, outputLanguage: 'zh-CN' as const,
    };
    const test = dependencies({
      active,
      tasks: [completedMulti, completedMulti],
      presentation: multiPresentationBundle(),
    });

    const restored = await test.runtime.restoreActiveAnalysis();
    expect(restored).toEqual({
      captures: captures.map((source, index) => ({
        ...source,
        image: { ...source.image, dataUrl: captureDataUrls[index]! },
      })),
      outputLanguage: 'zh-CN',
    });
    expect(test.fingerprintGrant).toHaveBeenCalledWith(token);
    expect(test.client.task).toHaveBeenCalledTimes(1);
    expect(test.client.capture.mock.calls.map((call) => call.slice(1, 3))).toEqual([
      [active.requestId, 'C01'],
      [active.requestId, 'C02'],
      [active.requestId, 'C03'],
    ]);
    expect(test.storage.clear).not.toHaveBeenCalled();
    expect(test.current()).toEqual(active);

    if (!restored) throw new Error('Expected restored captures.');
    const outcome = await test.runtime.analyze({
      captures: restored.captures,
      outputLanguage: restored.outputLanguage,
    });
    expect(outcome.captures).toEqual(restored.captures);
    expect(test.client.createTask).not.toHaveBeenCalled();
    expect(test.client.task).toHaveBeenCalledTimes(2);
  });

  it.each(['pending', 'processing', 'cancel_requested'] as const)(
    'hydrates an active %s task after one status poll',
    async (status) => {
      const active = {
        requestId: 'c_20260828_active', tokenFingerprint: fingerprint,
        captures: [singleStoredCapture], outputLanguage: 'en' as const,
      };
      const task = parseExtensionAnalysisTask({
        ...pending,
        status,
        progressEvents: status === 'processing' ? processing.progressEvents : pending.progressEvents,
      });
      const test = dependencies({ active, tasks: [task] });

      await expect(test.runtime.restoreActiveAnalysis()).resolves.toEqual({
        captures: [{
          image: {
            mediaType: 'image/png', dataUrl: captureDataUrls[0], width: 1280, height: 720,
          },
          context: {
            instrument: 'BTC/USDT', timeframe: '15m', site: 'tradingview',
            exchange: 'TradingView', pageType: 'advanced-chart',
          },
        }],
        outputLanguage: 'en',
      });
      expect(test.client.task).toHaveBeenCalledTimes(1);
      expect(test.client.capture).toHaveBeenCalledTimes(1);
      expect(test.storage.clear).not.toHaveBeenCalled();
    },
  );

  it('limits capture hydration to three concurrent downloads and preserves descriptor order', async () => {
    const active = {
      requestId: 'c_20260828_active', tokenFingerprint: fingerprint,
      captures: storedCaptures, outputLanguage: 'en' as const,
    };
    const downloads = {
      C01: deferred<DownloadedCapture>(),
      C02: deferred<DownloadedCapture>(),
      C03: deferred<DownloadedCapture>(),
    };
    let concurrent = 0;
    let maximumConcurrent = 0;
    const test = dependencies({
      active,
      tasks: [multiCompletedTask()],
      capture: async (_token, _requestId, captureId) => {
        concurrent += 1;
        maximumConcurrent = Math.max(maximumConcurrent, concurrent);
        try {
          return await downloads[captureId].promise;
        } finally {
          concurrent -= 1;
        }
      },
    });

    const restoration = test.runtime.restoreActiveAnalysis();
    await vi.waitFor(() => expect(test.client.capture).toHaveBeenCalledTimes(3));
    downloads.C03.resolve(downloadedCapture('C03'));
    downloads.C01.resolve(downloadedCapture('C01'));
    downloads.C02.resolve(downloadedCapture('C02'));

    const restored = await restoration;
    expect(maximumConcurrent).toBe(3);
    expect(restored?.captures.map(({ context }) => context.timeframe)).toEqual(['4h', '1h', '15m']);
    expect(restored?.captures.map(({ image }) => image.dataUrl)).toEqual(captureDataUrls);
  });

  it('discards a partial download set and preserves the active record on transient failure', async () => {
    const active = {
      requestId: 'c_20260828_active', tokenFingerprint: fingerprint,
      captures: storedCaptures, outputLanguage: 'en' as const,
    };
    const test = dependencies({
      active,
      tasks: [processing],
      capture: async (_token, _requestId, captureId) => {
        if (captureId === 'C02') throw new CloudConnectionError('service_unavailable');
        return downloadedCapture(captureId);
      },
    });

    await expect(test.runtime.restoreActiveAnalysis())
      .rejects.toMatchObject({ code: 'service_unavailable' });

    expect(test.client.capture).toHaveBeenCalledTimes(3);
    expect(test.current()).toEqual(active);
    expect(test.storage.clear).not.toHaveBeenCalled();
  });

  it('preserves the active record when the restoration status poll is transiently unavailable', async () => {
    const active = {
      requestId: 'c_20260828_active', tokenFingerprint: fingerprint,
      captures: [singleStoredCapture], outputLanguage: 'en' as const,
    };
    const test = dependencies({ active });
    test.client.task.mockRejectedValue(new CloudConnectionError('service_unavailable'));

    await expect(test.runtime.restoreActiveAnalysis())
      .rejects.toMatchObject({ code: 'service_unavailable' });

    expect(test.client.capture).not.toHaveBeenCalled();
    expect(test.current()).toEqual(active);
    expect(test.storage.clear).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong MIME', () => new Response(downloadedCapture('C01').bytes, {
      status: 200, headers: { 'Content-Type': 'image/jpeg' },
    })],
    ['missing body', () => new Response(null, {
      status: 200, headers: { 'Content-Type': 'image/png' },
    })],
    ['empty body', () => new Response(new Uint8Array(), {
      status: 200, headers: { 'Content-Type': 'image/png' },
    })],
    ['declared oversize body', () => new Response(downloadedCapture('C01').bytes, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String((10 * 1024 * 1024) + 1),
      },
    })],
    ['actual oversize body', () => {
      const bytes = new Uint8Array((10 * 1024 * 1024) + 1);
      bytes.set(new Uint8Array(downloadedCapture('C01').bytes).subarray(0, 8));
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/png' } });
    }],
    ['bad PNG signature', () => new Response(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]), {
      status: 200, headers: { 'Content-Type': 'image/png' },
    })],
  ])('classifies a deterministic successful %s through the real client and clears its record', async (
    _label,
    response,
  ) => {
    const active = {
      requestId: 'c_20260828_invalid_download', tokenFingerprint: fingerprint,
      captures: [singleStoredCapture], outputLanguage: 'en' as const,
    };
    const realClient = createCloudClient(vi.fn(async () => response()));
    const test = dependencies({
      active,
      tasks: [processing],
      capture: realClient.capture,
    });

    await expect(test.runtime.restoreActiveAnalysis()).rejects.toMatchObject({
      code: 'invalid_image',
    });

    expect(test.storage.clear).toHaveBeenCalledWith(active.requestId, expect.any(Function));
    expect(test.current()).toBeNull();
  });

  it('cannot clear a newer record when the real client rejects an older invalid response', async () => {
    const activeA = {
      requestId: 'c_20260828_invalid_a', tokenFingerprint: fingerprint,
      captures: [singleStoredCapture], outputLanguage: 'en' as const,
    };
    const activeB = { ...activeA, requestId: 'c_20260828_invalid_b' };
    const test = dependencies({ active: activeA, tasks: [processing] });
    const realClient = createCloudClient(vi.fn(async () => {
      await test.storage.save(activeB);
      return new Response(downloadedCapture('C01').bytes, {
        status: 200, headers: { 'Content-Type': 'image/jpeg' },
      });
    }));
    test.client.capture.mockImplementation(realClient.capture);

    await expect(test.runtime.restoreActiveAnalysis()).rejects.toMatchObject({
      code: 'invalid_image',
    });

    expect(test.storage.clear).toHaveBeenCalledWith(activeA.requestId, expect.any(Function));
    expect(test.current()).toEqual(activeB);
  });

  it.each([
    ['invalid PNG bytes', { mediaType: 'image/png' as const, bytes: new Uint8Array([1, 2, 3]).buffer }],
    ['IHDR without IDAT or IEND', { mediaType: 'image/png' as const, bytes: malformedPng.ihdrOnly }],
    ['missing IEND', { mediaType: 'image/png' as const, bytes: malformedPng.missingIend }],
    ['missing IDAT', { mediaType: 'image/png' as const, bytes: malformedPng.missingIdat }],
    ['truncated chunk header', {
      mediaType: 'image/png' as const, bytes: malformedPng.truncatedChunkHeader,
    }],
    ['truncated chunk data', {
      mediaType: 'image/png' as const, bytes: malformedPng.truncatedData,
    }],
    ['truncated chunk CRC', {
      mediaType: 'image/png' as const, bytes: malformedPng.truncatedCrc,
    }],
    ['IHDR CRC mismatch', {
      mediaType: 'image/png' as const, bytes: malformedPng.ihdrCrcMismatch,
    }],
    ['IDAT CRC mismatch', {
      mediaType: 'image/png' as const, bytes: malformedPng.idatCrcMismatch,
    }],
    ['non-zero IEND length', {
      mediaType: 'image/png' as const, bytes: malformedPng.malformedIendLength,
    }],
    ['trailing bytes after IEND', {
      mediaType: 'image/png' as const, bytes: malformedPng.trailingBytes,
    }],
    ['duplicate IHDR', {
      mediaType: 'image/png' as const, bytes: malformedPng.duplicateIhdr,
    }],
    ['non-contiguous IDAT chunks', {
      mediaType: 'image/png' as const, bytes: malformedPng.noncontiguousIdat,
    }],
    ['PNG dimensions differing from the descriptor', {
      mediaType: 'image/png' as const, bytes: pngBytes(640, 360, 4),
    }],
  ])('clears only the matching active record for %s', async (_label, downloaded) => {
    const active = {
      requestId: 'c_20260828_active', tokenFingerprint: fingerprint,
      captures: [singleStoredCapture], outputLanguage: 'en' as const,
    };
    const test = dependencies({ active, tasks: [processing], capture: async () => downloaded });

    await expect(test.runtime.restoreActiveAnalysis()).rejects.toMatchObject({ code: 'invalid_image' });

    expect(test.storage.clear).toHaveBeenCalledWith(active.requestId, expect.any(Function));
    expect(test.current()).toBeNull();
  });

  it('discards every hydrated capture when one PNG is structurally invalid', async () => {
    const active = {
      requestId: 'c_20260828_active', tokenFingerprint: fingerprint,
      captures: storedCaptures, outputLanguage: 'en' as const,
    };
    const test = dependencies({
      active,
      tasks: [processing],
      capture: async (_token, _requestId, captureId) => ({
        mediaType: 'image/png',
        bytes: captureId === 'C02' ? malformedPng.missingIend : downloadedCapture(captureId).bytes,
      }),
    });

    await expect(test.runtime.restoreActiveAnalysis()).rejects.toMatchObject({ code: 'invalid_image' });

    expect(test.client.capture).toHaveBeenCalledTimes(3);
    expect(test.storage.clear).toHaveBeenCalledWith(active.requestId, expect.any(Function));
    expect(test.current()).toBeNull();
  });

  it('clears the matching record when completed task metadata differs from stored timeframes', async () => {
    const active = {
      requestId: 'c_20260828_active', tokenFingerprint: fingerprint,
      captures: storedCaptures, outputLanguage: 'en' as const,
    };
    const task = multiCompletedTask();
    if (!task.report) throw new Error('Expected completed report.');
    const mismatched = parseExtensionAnalysisTask({
      ...task,
      report: {
        ...task.report,
        context: {
          ...task.report.context,
          captures: task.report.context.captures.map((metadata, index) => (
            index === 1 ? { ...metadata, timeframe: '30m' } : metadata
          )),
        },
      },
    });
    const test = dependencies({ active, tasks: [mismatched] });

    await expect(test.runtime.restoreActiveAnalysis())
      .rejects.toMatchObject({ code: 'incompatible_report_schema' });

    expect(test.storage.clear).toHaveBeenCalledWith(active.requestId, expect.any(Function));
    expect(test.current()).toBeNull();
  });

  it('clears the matching record without downloading when the task is missing', async () => {
    const active = {
      requestId: 'c_20260828_missing', tokenFingerprint: fingerprint,
      captures: [singleStoredCapture], outputLanguage: 'en' as const,
    };
    const test = dependencies({ active });
    test.client.task.mockRejectedValue(new CloudConnectionError('task_not_found'));

    await expect(test.runtime.restoreActiveAnalysis()).rejects.toMatchObject({ code: 'task_not_found' });

    expect(test.client.capture).not.toHaveBeenCalled();
    expect(test.storage.clear).toHaveBeenCalledWith(active.requestId, expect.any(Function));
  });

  it.each(['incompatible_report_schema', 'incompatible_api_version'] as const)(
    'clears the matching record when restoration polling returns %s',
    async (code) => {
      const active = {
        requestId: 'c_20260828_invalid', tokenFingerprint: fingerprint,
        captures: [singleStoredCapture], outputLanguage: 'en' as const,
      };
      const test = dependencies({ active });
      test.client.task.mockRejectedValue(new CloudConnectionError(code));

      await expect(test.runtime.restoreActiveAnalysis()).rejects.toMatchObject({ code });

      expect(test.client.capture).not.toHaveBeenCalled();
      expect(test.storage.clear).toHaveBeenCalledWith(active.requestId, expect.any(Function));
      expect(test.current()).toBeNull();
    },
  );

  it.each(['failed', 'cancelled'] as const)(
    'clears a terminal %s record without downloading captures',
    async (status) => {
      const active = {
        requestId: 'c_20260828_terminal', tokenFingerprint: fingerprint,
        captures: [singleStoredCapture], outputLanguage: 'en' as const,
      };
      const task = parseExtensionAnalysisTask({
        ...pending,
        requestId: active.requestId,
        status,
        error: status === 'failed'
          ? { code: 'task_failed', params: {}, pricingUrl: null }
          : null,
      });
      const test = dependencies({ active, tasks: [task] });

      await expect(test.runtime.restoreActiveAnalysis()).rejects.toBeInstanceOf(AnalysisRuntimeFailure);

      expect(test.client.capture).not.toHaveBeenCalled();
      expect(test.storage.clear).toHaveBeenCalledWith(active.requestId, expect.any(Function));
    },
  );

  it('rejects restored input that does not exactly match descriptors before polling', async () => {
    const active = {
      requestId: 'c_20260828_active', tokenFingerprint: fingerprint,
      captures: storedCaptures, outputLanguage: 'en' as const,
    };
    const test = dependencies({ active, tasks: [multiCompletedTask()] });
    const mismatchedCaptures = captures.map((source, index) => (
      index === 1 ? { ...source, image: { ...source.image, width: 1279 } } : source
    ));

    await expect(test.runtime.analyze({ captures: mismatchedCaptures, outputLanguage: 'en' }))
      .rejects.toMatchObject({ code: 'invalid_image' });

    expect(test.client.task).not.toHaveBeenCalled();
    expect(test.storage.clear).toHaveBeenCalledWith(active.requestId, expect.any(Function));
  });

  it('cannot clear a newer record when an older restoration receives invalid bytes', async () => {
    const activeA = {
      requestId: 'c_20260828_operation_a', tokenFingerprint: fingerprint,
      captures: [singleStoredCapture], outputLanguage: 'en' as const,
    };
    const activeB = { ...activeA, requestId: 'c_20260828_operation_b' };
    const test = dependencies({ active: activeA, tasks: [processing] });
    test.client.capture.mockImplementation(async () => {
      await test.storage.save(activeB);
      return { mediaType: 'image/png', bytes: new Uint8Array([1, 2, 3]).buffer };
    });

    await expect(test.runtime.restoreActiveAnalysis()).rejects.toMatchObject({ code: 'invalid_image' });

    expect(test.storage.clear).toHaveBeenCalledWith(activeA.requestId, expect.any(Function));
    expect(test.current()).toEqual(activeB);
  });

  it('cancels capture restoration without clearing a cancel-requested active record', async () => {
    const active = {
      requestId: 'c_20260828_active', tokenFingerprint: fingerprint,
      captures: [singleStoredCapture], outputLanguage: 'en' as const,
    };
    const test = dependencies({
      active,
      tasks: [pending],
      cancelTask: async () => ({ ...pending, status: 'cancel_requested' as const }),
      capture: async (_token, _requestId, _captureId, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    });
    const restoration = test.runtime.restoreActiveAnalysis();
    await vi.waitFor(() => expect(test.client.capture).toHaveBeenCalledTimes(1));

    test.runtime.cancel();
    test.runtime.cancel();

    await expect(restoration).rejects.toMatchObject({ code: 'cancelled' });
    expect(test.client.cancelTask).toHaveBeenCalledTimes(1);
    expect(test.client.cancelTask).toHaveBeenCalledWith(token, active.requestId);
    expect(test.storage.clear).not.toHaveBeenCalled();
    expect(test.current()).toEqual(active);
  });

  it('detaches restoration idempotently and ignores a late successful download', async () => {
    const active = {
      requestId: 'c_20260828_active', tokenFingerprint: fingerprint,
      captures: [singleStoredCapture], outputLanguage: 'en' as const,
    };
    const download = deferred<DownloadedCapture>();
    let captureSignal: AbortSignal | undefined;
    const test = dependencies({
      active,
      tasks: [pending],
      capture: async (_token, _requestId, _captureId, signal) => {
        captureSignal = signal;
        return download.promise;
      },
    });
    const restoration = test.runtime.restoreActiveAnalysis();
    await vi.waitFor(() => expect(test.client.capture).toHaveBeenCalledTimes(1));

    test.runtime.detach();
    test.runtime.detach();
    expect(captureSignal?.aborted).toBe(true);
    download.resolve(downloadedCapture('C01'));

    await expect(restoration).rejects.toMatchObject({ code: 'cancelled' });
    expect(test.client.cancelTask).not.toHaveBeenCalled();
    expect(test.storage.clear).not.toHaveBeenCalled();
    expect(test.current()).toEqual(active);
  });

  it('sanitizes a late restoration failure after detach without clearing the active record', async () => {
    const active = {
      requestId: 'c_20260828_active', tokenFingerprint: fingerprint,
      captures: [singleStoredCapture], outputLanguage: 'en' as const,
    };
    const download = deferred<DownloadedCapture>();
    const test = dependencies({
      active,
      tasks: [pending],
      capture: async () => download.promise,
    });
    const restoration = test.runtime.restoreActiveAnalysis();
    await vi.waitFor(() => expect(test.client.capture).toHaveBeenCalledTimes(1));

    test.runtime.detach();
    download.reject(new AnalysisRuntimeFailure('invalid_image'));

    await expect(restoration).rejects.toMatchObject({ code: 'cancelled' });
    expect(test.client.cancelTask).not.toHaveBeenCalled();
    expect(test.storage.clear).not.toHaveBeenCalled();
    expect(test.current()).toEqual(active);
  });

  it.each([
    'terminal task',
    'descriptor mismatch',
    'invalid capture',
    'task error',
  ] as const)('preserves the descriptor when detach overtakes queued %s cleanup', async (path) => {
    const active = {
      requestId: `c_20260828_queued_${path.replaceAll(' ', '_')}`,
      tokenFingerprint: fingerprint,
      captures: [singleStoredCapture],
      outputLanguage: 'en' as const,
    };
    const lock = new RuntimeSharedExclusiveLock();
    const activeTask = runtimeActiveTaskStorage(active, lock);
    const blockerEntered = deferred<void>();
    const releaseBlocker = deferred<void>();
    let blocker: Promise<void> | null = null;
    const failedTask = parseExtensionAnalysisTask({
      ...pending,
      requestId: active.requestId,
      status: 'failed',
      error: { code: 'task_failed', params: {}, pricingUrl: null },
    });
    const mismatchedTask = parseExtensionAnalysisTask({
      ...structuredClone(completed),
      requestId: active.requestId,
      report: {
        ...structuredClone(completed.report),
        context: {
          ...structuredClone(completed.report?.context),
          captures: completed.report!.context.captures.map((item) => ({
            ...item,
            timeframe: '30m',
          })),
        },
      },
    });
    const processingTask = parseExtensionAnalysisTask({
      ...processing,
      requestId: active.requestId,
    });
    const task = vi.fn(async () => {
      blocker = lock.request(
        'chartviz-cloud-active-task',
        { mode: 'exclusive' },
        async () => {
          blockerEntered.resolve();
          await releaseBlocker.promise;
        },
      );
      await blockerEntered.promise;
      if (path === 'task error') throw new CloudConnectionError('task_not_found');
      if (path === 'terminal task') return failedTask;
      if (path === 'descriptor mismatch') return mismatchedTask;
      return processingTask;
    });
    const cancelTask = vi.fn(async () => failedTask);
    const runtime = new CloudAnalysisRuntime({
      client: {
        createTask: vi.fn(async () => processingTask),
        task,
        cancelTask,
        capture: vi.fn(async () => path === 'invalid capture'
          ? { mediaType: 'image/png' as const, bytes: Uint8Array.of(1, 2, 3).buffer }
          : downloadedCapture('C01')),
      },
      connection: { load: async () => ({ token, account }) },
      activeTask,
      cleanupPending: {
        load: async () => null,
        save: async () => undefined,
        clear: async () => undefined,
      },
      fingerprintGrant: async () => fingerprint,
      sleep: async () => undefined,
      adaptPresentation: () => parsePresentationBundle(structuredClone(validPresentationBundle)),
      buildAnnotations: async () => presentationAnnotatedImages,
    });
    const restoration = runtime.restoreActiveAnalysis();
    await blockerEntered.promise;
    await vi.waitFor(() => expect(lock.requests).toBe(3));

    runtime.detach();
    releaseBlocker.resolve();
    await blocker;

    await expect(restoration).rejects.toMatchObject({ code: 'cancelled' });
    expect(cancelTask).not.toHaveBeenCalled();
    await expect(activeTask.load()).resolves.toEqual(active);
  });

  it('clears an account A active record before returning any captures to account B', async () => {
    const active = {
      requestId: 'c_20260828_account_a', tokenFingerprint: fingerprint,
      captures: [singleStoredCapture], outputLanguage: 'en' as const,
    };
    const test = dependencies({ active, connectionToken: rotatedToken });

    const restored = await test.runtime.restoreActiveAnalysis();

    expect(restored).toBeNull();
    expect(test.client.task).not.toHaveBeenCalled();
    expect(test.client.capture).not.toHaveBeenCalled();
    expect(test.storage.clear).toHaveBeenCalledTimes(1);
    expect(test.current()).toBeNull();
  });

  it('clears account A sources and analyzes only account B input after token rotation', async () => {
    const accountBCapture = {
      ...capture,
      image: { ...capture.image, dataUrl: 'data:image/png;base64,ACCOUNT_B' },
    };
    const active = {
      requestId: 'c_20260828_account_a', tokenFingerprint: fingerprint,
      captures: [singleStoredCapture], outputLanguage: 'en' as const,
    };
    const test = dependencies({
      active,
      connectionToken: rotatedToken,
      tasks: [completed],
    });

    const outcome = await test.runtime.analyze({ captures: [accountBCapture], outputLanguage: 'en' });

    expect(outcome.captures).toEqual([accountBCapture]);
    expect(test.client.createTask).toHaveBeenCalledWith(rotatedToken, {
      captures: [accountBCapture],
      outputLanguage: 'en',
    });
    expect(test.client.task).not.toHaveBeenCalledWith(
      rotatedToken,
      active.requestId,
      expect.any(AbortSignal),
    );
    expect(test.buildAnnotations).toHaveBeenCalledWith(
      [{ captureId: 'C01', image: accountBCapture.image }],
      expect.any(Array),
    );
  });

  it('rejects and clears a completed report whose capture count differs from stored sources', async () => {
    const test = dependencies({ tasks: [completed] });

    await expect(test.runtime.analyze({ captures, outputLanguage: 'en' }))
      .rejects.toMatchObject({ code: 'incompatible_report_schema' });

    expect(test.adaptPresentation).not.toHaveBeenCalled();
    expect(test.buildAnnotations).not.toHaveBeenCalled();
    expect(test.storage.clear).toHaveBeenCalledTimes(1);
  });

  it('rejects and clears a completed report whose timeframe sequence differs from stored sources', async () => {
    const test = dependencies({
      tasks: [multiCompletedTask()],
      presentation: multiPresentationBundle(),
    });
    const wrongOrder = [captures[0]!, captures[2]!, captures[1]!];

    await expect(test.runtime.analyze({ captures: wrongOrder, outputLanguage: 'en' }))
      .rejects.toMatchObject({ code: 'incompatible_report_schema' });

    expect(test.adaptPresentation).not.toHaveBeenCalled();
    expect(test.buildAnnotations).not.toHaveBeenCalled();
    expect(test.storage.clear).toHaveBeenCalledTimes(1);
  });

  it('rejects and clears a resumed report whose dimensions differ from stored sources', async () => {
    const active = {
      requestId: 'c_20260828_active', tokenFingerprint: fingerprint,
      captures: storedCaptures, outputLanguage: 'en' as const,
    };
    const task = multiCompletedTask();
    if (!task.report) throw new Error('Expected completed report.');
    const mismatched = parseExtensionAnalysisTask({
      ...task,
      report: {
        ...task.report,
        context: {
          ...task.report.context,
          captures: task.report.context.captures.map((metadata, index) => (
            index === 1 ? { ...metadata, width: metadata.width - 1 } : metadata
          )),
        },
      },
    });
    const test = dependencies({ active, tasks: [mismatched] });

    await expect(test.runtime.analyze({ captures, outputLanguage: 'en' }))
      .rejects.toMatchObject({ code: 'incompatible_report_schema' });

    expect(test.adaptPresentation).not.toHaveBeenCalled();
    expect(test.buildAnnotations).not.toHaveBeenCalled();
    expect(test.storage.clear).toHaveBeenCalledWith(active.requestId, expect.any(Function));
  });

  it('clears saved captures when polling reports task_not_found', async () => {
    const test = dependencies({ tasks: [] });
    test.client.task.mockRejectedValue(new CloudConnectionError('task_not_found'));

    await expect(test.runtime.analyze({ captures: [capture], outputLanguage: 'en' }))
      .rejects.toMatchObject({ code: 'task_not_found' });

    expect(test.storage.save).toHaveBeenCalledTimes(1);
    expect(test.storage.clear).toHaveBeenCalledTimes(1);
  });

  it.each([
    'incompatible_report_schema',
    'incompatible_api_version',
  ] as const)('clears an unrestorable active task after %s', async (code) => {
    const active = {
      requestId: 'c_20260828_active', tokenFingerprint: fingerprint,
      captures: [singleStoredCapture], outputLanguage: 'en' as const,
    };
    const test = dependencies({ active });
    test.client.task.mockRejectedValue(new CloudConnectionError(code));

    await expect(test.runtime.analyze({ captures: [capture], outputLanguage: 'en' }))
      .rejects.toMatchObject({ code });

    expect(test.client.createTask).not.toHaveBeenCalled();
    expect(test.storage.clear).toHaveBeenCalledTimes(1);
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
    expect(test.storage.clear).toHaveBeenCalledTimes(1);
  });

  it('preserves stored captures when cancellation is only cancel_requested', async () => {
    const test = dependencies({ cancelTask: async () => ({
      ...pending, status: 'cancel_requested' as const,
    }) });
    test.sleep.mockImplementation((_delay: number, signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const operation = test.runtime.analyze({ captures: [capture], outputLanguage: 'en' });
    await vi.waitFor(() => expect(test.storage.save).toHaveBeenCalledTimes(1));

    test.runtime.cancel();

    await expect(operation).rejects.toMatchObject({ code: 'cancelled' });
    expect(test.storage.clear).not.toHaveBeenCalled();
    expect(test.current()).toEqual({
      requestId: pending.requestId, tokenFingerprint: fingerprint,
      captures: [singleStoredCapture], outputLanguage: 'en',
    });
  });

  it('preserves stored captures when the cancellation request fails in transport', async () => {
    const test = dependencies({ cancelTask: async () => {
      throw new CloudConnectionError('service_unavailable');
    } });
    test.sleep.mockImplementation((_delay: number, signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const operation = test.runtime.analyze({ captures: [capture], outputLanguage: 'en' });
    await vi.waitFor(() => expect(test.storage.save).toHaveBeenCalledTimes(1));

    test.runtime.cancel();

    await expect(operation).rejects.toMatchObject({ code: 'cancelled' });
    expect(test.storage.clear).not.toHaveBeenCalled();
    expect(test.current()).not.toBeNull();
  });

  it('isolates cancelled account A while account B starts and completes before A settles', async () => {
    const requestA = 'c_20260828_operation_a';
    const requestB = 'c_20260828_operation_b';
    const pendingA = parseExtensionAnalysisTask({ ...pending, requestId: requestA });
    const pendingB = parseExtensionAnalysisTask({ ...pending, requestId: requestB });
    const cancelledA = parseExtensionAnalysisTask({
      ...pendingA,
      status: 'cancelled',
      error: null,
    });
    const completedB = parseExtensionAnalysisTask({ ...completed, requestId: requestB });
    const captureA = {
      ...capture,
      image: { ...capture.image, dataUrl: 'data:image/png;base64,OPERATION_A' },
    };
    const captureB = {
      ...capture,
      image: { ...capture.image, dataUrl: 'data:image/png;base64,OPERATION_B' },
    };
    const cancellationA = deferred<typeof cancelledA>();
    const sleepB = deferred<void>();
    let active: StoredCloudActiveTask | null = null;
    const storage = {
      load: vi.fn(async () => active),
      save: vi.fn(async (value: StoredCloudActiveTask) => { active = value; }),
      clear: vi.fn(async (expectedRequestId?: string) => {
        if (expectedRequestId === undefined || active?.requestId === expectedRequestId) active = null;
      }),
    };
    const connection = {
      load: vi.fn()
        .mockResolvedValueOnce({ token, account })
        .mockResolvedValueOnce({ token: rotatedToken, account }),
    };
    const client = {
      createTask: vi.fn(async (value: string) => value === token ? pendingA : pendingB),
      task: vi.fn(async (value: string, requestId: string | null) => {
        if (value === rotatedToken && requestId === requestB) return completedB;
        throw new CloudConnectionError('task_not_found');
      }),
      cancelTask: vi.fn(() => cancellationA.promise),
      capture: vi.fn(async (_token: string, _requestId: string, captureId: 'C01' | 'C02' | 'C03') => (
        downloadedCapture(captureId)
      )),
    };
    const sleep = vi.fn()
      .mockImplementationOnce((_delay: number, signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }))
      .mockImplementationOnce(() => sleepB.promise);
    const buildAnnotations = vi.fn(async () => presentationAnnotatedImages);
    const runtime = new CloudAnalysisRuntime({
      client,
      connection,
      activeTask: storage,
      cleanupPending: { load: async () => null, save: async () => undefined, clear: async () => undefined },
      fingerprintGrant: async (value) => value === token ? fingerprint : rotatedFingerprint,
      sleep,
      adaptPresentation: () => parsePresentationBundle(structuredClone(validPresentationBundle)),
      buildAnnotations,
    });

    const operationA = runtime.analyze({ captures: [captureA], outputLanguage: 'en' });
    await vi.waitFor(() => expect(active?.requestId).toBe(requestA));
    runtime.cancel();
    await vi.waitFor(() => expect(client.cancelTask).toHaveBeenCalledWith(token, requestA));

    const operationB = runtime.analyze({ captures: [captureB], outputLanguage: 'en' });
    await vi.waitFor(() => expect(active).toEqual({
      requestId: requestB,
      tokenFingerprint: rotatedFingerprint,
      captures: [singleStoredCapture],
      outputLanguage: 'en',
    }));

    cancellationA.resolve(cancelledA);
    await expect(operationA).rejects.toMatchObject({ code: 'cancelled' });
    expect(active).toMatchObject({ requestId: requestB });
    expect(client.cancelTask).toHaveBeenCalledTimes(1);

    sleepB.resolve();
    const outcomeB = await operationB;

    expect(outcomeB.captures).toEqual([captureB]);
    expect(client.task).toHaveBeenCalledTimes(1);
    expect(client.task).toHaveBeenCalledWith(rotatedToken, requestB, expect.any(AbortSignal));
    expect(storage.save).toHaveBeenLastCalledWith(expect.objectContaining({
      requestId: requestB,
      captures: [singleStoredCapture],
    }));
    expect(storage.clear).toHaveBeenCalledTimes(2);
    expect(buildAnnotations).toHaveBeenCalledWith(
      [{ captureId: 'C01', image: captureB.image }],
      expect.any(Array),
    );
  });

  it('cancels a just-created server task when active capture persistence fails', async () => {
    const test = dependencies();
    test.storage.save.mockRejectedValue(new Error('IndexedDB write failed'));

    await expect(test.runtime.analyze({ captures: [capture], outputLanguage: 'en' }))
      .rejects.toMatchObject({ code: 'service_unavailable' });

    expect(test.client.cancelTask).toHaveBeenCalledWith(token, pending.requestId);
    expect(test.client.createTask).toHaveBeenCalledTimes(1);
    expect(test.client.task).not.toHaveBeenCalled();
    expect(test.currentCleanup()).toBeNull();
  });

  it('clears a different-grant cleanup tombstone without cancelling it', async () => {
    const test = dependencies({
      cleanup: {
        requestId: 'c_20260828_account_a_cleanup',
        tokenFingerprint: fingerprint,
      },
      connectionToken: rotatedToken,
      tasks: [completed],
    });

    await test.runtime.analyze({ captures: [capture], outputLanguage: 'en' });

    expect(test.cleanupStorage.clear).toHaveBeenCalledTimes(1);
    expect(test.currentCleanup()).toBeNull();
    expect(test.client.cancelTask).not.toHaveBeenCalledWith(
      rotatedToken,
      'c_20260828_account_a_cleanup',
    );
    expect(test.client.createTask).toHaveBeenCalledTimes(1);
  });

  it('clears a same-grant cleanup tombstone after task_not_found and then creates safely', async () => {
    const test = dependencies({
      cleanup: {
        requestId: 'c_20260828_missing_cleanup',
        tokenFingerprint: fingerprint,
      },
      cancelTask: async () => {
        throw new CloudConnectionError('task_not_found');
      },
      tasks: [completed],
    });

    await test.runtime.analyze({ captures: [capture], outputLanguage: 'en' });

    expect(test.cleanupStorage.clear).toHaveBeenCalledTimes(1);
    expect(test.currentCleanup()).toBeNull();
    expect(test.client.cancelTask).toHaveBeenCalledWith(token, 'c_20260828_missing_cleanup');
    expect(test.client.createTask).toHaveBeenCalledTimes(1);
  });

  it('does not create a duplicate after runtime recreation while cleanup cancellation keeps rejecting', async () => {
    const test = dependencies({ cancelTask: async () => {
      throw new CloudConnectionError('service_unavailable');
    } });
    test.storage.save.mockRejectedValue(new Error('IndexedDB write failed'));

    await expect(test.runtime.analyze({ captures: [capture], outputLanguage: 'en' }))
      .rejects.toMatchObject({ code: 'service_unavailable' });
    const reloadedRuntime = test.recreateRuntime();
    await expect(reloadedRuntime.analyze({ captures: [capture], outputLanguage: 'en' }))
      .rejects.toMatchObject({ code: 'service_unavailable' });

    expect(test.client.createTask).toHaveBeenCalledTimes(1);
    expect(test.client.cancelTask).toHaveBeenCalledTimes(2);
    expect(test.client.cancelTask).toHaveBeenNthCalledWith(2, token, pending.requestId);
    expect(test.client.task).not.toHaveBeenCalled();
    expect(test.currentCleanup()).toEqual({
      requestId: pending.requestId,
      tokenFingerprint: fingerprint,
    });
  });

  it('does not create a duplicate after runtime recreation while cleanup remains cancel_requested', async () => {
    const test = dependencies({ cancelTask: async () => ({
      ...pending, status: 'cancel_requested' as const,
    }) });
    test.storage.save.mockRejectedValue(new Error('IndexedDB write failed'));

    await expect(test.runtime.analyze({ captures: [capture], outputLanguage: 'en' }))
      .rejects.toMatchObject({ code: 'service_unavailable' });
    const reloadedRuntime = test.recreateRuntime();
    await expect(reloadedRuntime.analyze({ captures: [capture], outputLanguage: 'en' }))
      .rejects.toMatchObject({ code: 'service_unavailable' });

    expect(test.client.createTask).toHaveBeenCalledTimes(1);
    expect(test.client.cancelTask).toHaveBeenCalledTimes(2);
    expect(test.client.cancelTask).toHaveBeenNthCalledWith(2, token, pending.requestId);
    expect(test.client.task).not.toHaveBeenCalled();
    expect(test.currentCleanup()).toEqual({
      requestId: pending.requestId,
      tokenFingerprint: fingerprint,
    });
  });

  it('observes cancellation rejection immediately while active-task save is pending', async () => {
    const save = deferred<void>();
    const cancellation = deferred<typeof pending>();
    const cancellationCatch = vi.spyOn(cancellation.promise, 'catch');
    const test = dependencies({ cancelTask: () => cancellation.promise });
    test.storage.save.mockImplementation(() => save.promise);
    test.sleep.mockImplementation(async (_delay: number, signal: AbortSignal) => {
      throw signal.reason;
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);

    try {
      const operation = test.runtime.analyze({ captures: [capture], outputLanguage: 'en' });
      await vi.waitFor(() => expect(test.storage.save).toHaveBeenCalledTimes(1));

      test.runtime.cancel();
      const immediateObserverCount = cancellationCatch.mock.calls.length;
      cancellation.reject(new CloudConnectionError('service_unavailable'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);

      save.resolve();
      await expect(operation).rejects.toMatchObject({ code: 'cancelled' });
      expect(immediateObserverCount).toBe(1);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      void cancellation.promise.catch(() => undefined);
      save.resolve();
    }
  });

  it('returns completion when completion wins the cancel race', async () => {
    const test = dependencies({ cancelTask: async () => completed });
    test.sleep.mockImplementation((_delay: number, signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const operation = test.runtime.analyze({ captures: [capture], outputLanguage: 'en' });
    await vi.waitFor(() => expect(test.storage.save).toHaveBeenCalled());

    test.runtime.cancel();

    await expect(operation).resolves.toMatchObject({ presentation: { schemaVersion: 'presentation-1.0' } });
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
