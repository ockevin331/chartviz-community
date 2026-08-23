import { describe, expect, it, vi } from 'vitest';

import {
  BackendController,
  backendControllerErrorResponse,
  type CommunityConnectionStore,
} from '../src/api/backend-controller';
import type { AnalysisBackendRuntime } from '../src/api/backend-runtime';
import type {
  CommunityConnectionPlatform,
  VerifiedCommunityConnection,
} from '../src/api/community-connection';
import type { ChartContext } from '../src/domain/analysis';

const token = 'local-token-with-32-characters-000';
const capabilities = {
  edition: 'community' as const, apiVersion: '1' as const, reportSchemaVersion: '1.3' as const,
  limits: { maxImages: 1, maxTimeframes: 1 },
  features: {
    multiTimeframe: false, marketDataFusion: false, advancedAnnotations: false,
    cloudAuthentication: false, billing: false,
  },
};
const context: ChartContext = {
  site: 'tradingview', pageType: 'advanced-chart',
  url: 'https://www.tradingview.com/chart/example/', symbol: 'BTCUSD', timeframe: '15m',
  chart: { id: 'chart', bounds: { x: 0, y: 0, width: 800, height: 600 } },
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
};

class MemoryStore implements CommunityConnectionStore {
  value: VerifiedCommunityConnection | null = null;
  saves = 0;
  clears = 0;

  async load() { return this.value; }
  async save(value: VerifiedCommunityConnection) { this.value = value; this.saves += 1; }
  async clear() { this.value = null; this.clears += 1; }
}

function probePlatform(statuses: Array<{ body: unknown; status?: number }>): CommunityConnectionPlatform {
  return {
    containsOrigin: async () => true,
    requestOrigin: async () => true,
    fetch: async () => {
      const next = statuses.shift();
      if (!next) throw new Error('unexpected probe');
      return Response.json(next.body, { status: next.status ?? 200 });
    },
  };
}

function successfulProbes(repetitions = 1) {
  return Array.from({ length: repetitions }, () => [
    { body: capabilities },
    { body: { models: [{ id: 'test-model' }] } },
  ]).flat();
}

function cloudRuntime(): AnalysisBackendRuntime {
  return {
    edition: 'cloud',
    capabilities: async () => ({ ...capabilities, edition: 'cloud', limits: { maxImages: 3, maxTimeframes: 3 } }),
    createAnalysis: async () => ({ requestId: 'c_cloud', status: 'pending', context }),
    getAnalysis: async () => ({ requestId: 'c_cloud', status: 'processing', context }),
    cancelAnalysis: async () => ({ requestId: 'c_cloud', status: 'cancel_requested', context }),
  };
}

describe('backend controller', () => {
  it('maps connection failures to the public code and message shape', () => {
    const error = Object.assign(new Error('Token rejected.'), {
      code: 'community_token_rejected',
    });

    expect(backendControllerErrorResponse(error)).toEqual({
      ok: false,
      code: 'community_token_rejected',
      message: 'Token rejected.',
    });
  });

  it('persists only a verified connection and returns a redacted status', async () => {
    const store = new MemoryStore();
    const controller = new BackendController({
      edition: 'community', store,
      platform: probePlatform(successfulProbes(2)),
      cloudRuntime: cloudRuntime(),
    });

    const connected = await controller.testAndSaveConnection({
      baseUrl: 'http://127.0.0.1:8000/', token,
    });
    const status = await controller.connectionStatus();

    expect(connected).toEqual({
      connected: true, baseUrl: 'http://127.0.0.1:8000', hasStoredToken: true,
      modelId: 'test-model', capabilities,
    });
    expect(status).toEqual(connected);
    expect(store.saves).toBe(2);
    expect(JSON.stringify(status)).not.toContain(token);
  });

  it('does not save when verification fails', async () => {
    const store = new MemoryStore();
    const controller = new BackendController({
      edition: 'community', store,
      platform: probePlatform([{ body: capabilities }, { body: { detail: 'no' }, status: 401 }]),
      cloudRuntime: cloudRuntime(),
    });

    await expect(controller.testAndSaveConnection({
      baseUrl: 'http://127.0.0.1:8000', token,
    })).rejects.toMatchObject({ code: 'community_token_rejected' });
    expect(store.saves).toBe(0);
  });

  it('reuses a stored token only when explicitly requested', async () => {
    const store = new MemoryStore();
    store.value = {
      version: 1, baseUrl: 'http://127.0.0.1:8000', token,
      capabilities, modelId: 'old-model',
    };
    const controller = new BackendController({
      edition: 'community', store,
      platform: probePlatform(successfulProbes()),
      cloudRuntime: cloudRuntime(),
    });

    const status = await controller.testAndSaveConnection({
      baseUrl: 'http://127.0.0.1:8000', reuseStoredToken: true,
    });

    expect(status.modelId).toBe('test-model');
    expect(store.value?.token).toBe(token);
  });

  it('rejects Community connection operations in Cloud edition', async () => {
    const controller = new BackendController({
      edition: 'cloud', store: new MemoryStore(),
      platform: probePlatform([]), cloudRuntime: cloudRuntime(),
    });

    await expect(controller.connectionStatus())
      .rejects.toMatchObject({ code: 'community_feature_unavailable' });
    await expect(controller.disconnectCommunity())
      .rejects.toMatchObject({ code: 'community_feature_unavailable' });
  });

  it('requires a saved connection for Community analysis', async () => {
    const controller = new BackendController({
      edition: 'community', store: new MemoryStore(),
      platform: probePlatform([]), cloudRuntime: cloudRuntime(),
    });

    await expect(controller.createAnalysis({
      images: [{ timeframe: '15m', image: new Blob(['png']) }], context,
    })).rejects.toMatchObject({ code: 'community_connection_required' });
  });

  it('loads the latest Community connection for every task operation', async () => {
    const store = new MemoryStore();
    store.value = {
      version: 1, baseUrl: 'http://127.0.0.1:8000', token,
      capabilities, modelId: 'test-model',
    };
    let runtimeConnections = 0;
    const runtime: AnalysisBackendRuntime = {
      edition: 'community', capabilities: async () => capabilities,
      createAnalysis: async () => ({ requestId: 'c_local', status: 'pending', context }),
      getAnalysis: async () => ({ requestId: 'c_local', status: 'processing', context }),
      cancelAnalysis: async () => ({ requestId: 'c_local', status: 'cancel_requested', context }),
    };
    const controller = new BackendController({
      edition: 'community', store, platform: probePlatform([]), cloudRuntime: cloudRuntime(),
      communityRuntimeFactory: () => { runtimeConnections += 1; return runtime; },
    });

    await controller.createAnalysis({ images: [{ timeframe: '15m', image: new Blob(['png']) }], context });
    await controller.getAnalysis('c_local');
    await controller.cancelAnalysis('c_local');

    expect(runtimeConnections).toBe(3);
    await controller.disconnectCommunity();
    expect(store.clears).toBe(1);
  });
});
