import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ value: undefined as unknown }));
const browserMock = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async () => ({ chartvizCloudActiveTask: state.value })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        state.value = items.chartvizCloudActiveTask;
      }),
      remove: vi.fn(async () => { state.value = undefined; }),
    },
  },
}));

vi.mock('wxt/browser', () => ({ browser: browserMock }));

import {
  clearCloudActiveTask,
  loadCloudActiveTask,
  saveCloudActiveTask,
} from '../src/storage/cloud-active-task-storage';

const activeTask = {
  requestId: 'c_20260828_active',
  outputLanguage: 'en' as const,
  capture: {
    image: {
      mediaType: 'image/png' as const,
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      width: 1280,
      height: 720,
    },
    context: {
      instrument: 'BTC/USDT', timeframe: '15m', site: 'binance',
      exchange: 'Binance', pageType: 'spot-trade' as const,
    },
  },
};

describe('Cloud active task storage', () => {
  beforeEach(() => {
    state.value = undefined;
    vi.clearAllMocks();
  });

  it('round-trips one complete capture without storing a token', async () => {
    await saveCloudActiveTask(activeTask);

    await expect(loadCloudActiveTask()).resolves.toEqual(activeTask);
    expect(JSON.stringify(state.value)).not.toContain('cv_live_');
    expect(browserMock.storage.local.set).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...activeTask, outputLanguage: 'fr' },
    { ...activeTask, token: `cv_live_${'x'.repeat(43)}` },
    { ...activeTask, capture: { ...activeTask.capture, image: { ...activeTask.capture.image, dataUrl: 'https://example.test/chart.png' } } },
    { ...activeTask, capture: { ...activeTask.capture, image: { ...activeTask.capture.image, width: 0 } } },
    { ...activeTask, captures: [activeTask.capture, activeTask.capture] },
  ])('rejects malformed or credential-bearing state', async (value) => {
    await expect(saveCloudActiveTask(value as never)).rejects.toBeInstanceOf(TypeError);
    expect(browserMock.storage.local.set).not.toHaveBeenCalled();
  });

  it('returns null for malformed persisted state and clears idempotently', async () => {
    state.value = { ...activeTask, extra: true };
    await expect(loadCloudActiveTask()).resolves.toBeNull();

    await clearCloudActiveTask();
    await clearCloudActiveTask();
    await expect(loadCloudActiveTask()).resolves.toBeNull();
    expect(browserMock.storage.local.remove).toHaveBeenCalledTimes(2);
  });
});
