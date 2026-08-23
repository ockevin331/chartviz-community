import { AnalysisApiError } from './analysis-client';
import {
  CloudBackendRuntime,
  createBackendRuntime,
  type AnalysisBackendRuntime,
  type BackendAnalysisTask,
  type CloudRequestIdentity,
} from './backend-runtime';
import type { BackendCapabilities } from './backend-capabilities';
import {
  clearCommunityConnection,
  loadCommunityConnection,
  publicConnectionView,
  saveCommunityConnection,
  verifyCommunityConnection,
  type CommunityConnectionPlatform,
  type CommunityConnectionView,
  type VerifiedCommunityConnection,
} from './community-connection';
import type { ExtensionEdition } from '../config/edition';
import type { ChartContext } from '../domain/analysis';

export type ControllerAnalysisInput = {
  images: Array<{ timeframe: string; image: Blob }>;
  context: ChartContext;
  cloudIdentity?: CloudRequestIdentity;
};

export type TestCommunityConnectionInput = {
  baseUrl: string;
  token?: string;
  reuseStoredToken?: boolean;
};

export interface CommunityConnectionStore {
  load(): Promise<VerifiedCommunityConnection | null>;
  save(connection: VerifiedCommunityConnection): Promise<void>;
  clear(): Promise<void>;
}

const browserCommunityStore: CommunityConnectionStore = {
  load: loadCommunityConnection,
  save: saveCommunityConnection,
  clear: clearCommunityConnection,
};

type BackendControllerOptions = {
  edition: ExtensionEdition;
  platform: CommunityConnectionPlatform;
  store?: CommunityConnectionStore;
  cloudRuntime?: AnalysisBackendRuntime;
  communityRuntimeFactory?: (connection: VerifiedCommunityConnection) => AnalysisBackendRuntime;
};

export function backendControllerErrorResponse(error: unknown): {
  ok: false;
  code: string;
  message: string;
} {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : 'community_connection_failed';
  return {
    ok: false,
    code,
    message: error instanceof Error ? error.message : 'Community backend operation failed.',
  };
}

export class BackendController {
  private readonly edition: ExtensionEdition;
  private readonly platform: CommunityConnectionPlatform;
  private readonly store: CommunityConnectionStore;
  private readonly cloudRuntime: AnalysisBackendRuntime;
  private readonly communityRuntimeFactory: (
    connection: VerifiedCommunityConnection,
  ) => AnalysisBackendRuntime;

  constructor(options: BackendControllerOptions) {
    this.edition = options.edition;
    this.platform = options.platform;
    this.store = options.store ?? browserCommunityStore;
    this.cloudRuntime = options.cloudRuntime ?? new CloudBackendRuntime();
    this.communityRuntimeFactory = options.communityRuntimeFactory
      ?? ((connection) => createBackendRuntime({
        edition: 'community', communityConnection: connection,
      }));
  }

  private requireCommunityEdition(): void {
    if (this.edition !== 'community') {
      throw new AnalysisApiError(
        'Community backend settings are unavailable in the Cloud edition.',
        'community_feature_unavailable',
      );
    }
  }

  private async resolveCandidateToken(input: TestCommunityConnectionInput): Promise<string> {
    if (input.token) return input.token;
    if (input.reuseStoredToken) {
      const stored = await this.store.load();
      if (stored) return stored.token;
    }
    throw new AnalysisApiError(
      'Enter the local backend token.',
      'community_token_invalid',
    );
  }

  private async runtime(): Promise<AnalysisBackendRuntime> {
    if (this.edition === 'cloud') return this.cloudRuntime;
    const connection = await this.store.load();
    if (!connection) {
      throw new AnalysisApiError(
        'Connect a Community backend before analyzing a chart.',
        'community_connection_required',
      );
    }
    return this.communityRuntimeFactory(connection);
  }

  async testAndSaveConnection(
    input: TestCommunityConnectionInput,
  ): Promise<CommunityConnectionView> {
    this.requireCommunityEdition();
    const token = await this.resolveCandidateToken(input);
    const verified = await verifyCommunityConnection(
      { baseUrl: input.baseUrl, token },
      this.platform,
    );
    await this.store.save(verified);
    return publicConnectionView(verified);
  }

  async connectionStatus(): Promise<CommunityConnectionView> {
    this.requireCommunityEdition();
    const stored = await this.store.load();
    if (!stored) return { connected: false, hasStoredToken: false };
    const verified = await verifyCommunityConnection(
      { baseUrl: stored.baseUrl, token: stored.token },
      this.platform,
    );
    await this.store.save(verified);
    return publicConnectionView(verified);
  }

  async disconnectCommunity(): Promise<CommunityConnectionView> {
    this.requireCommunityEdition();
    await this.store.clear();
    return { connected: false, hasStoredToken: false };
  }

  async capabilities(): Promise<BackendCapabilities> {
    return (await this.runtime()).capabilities();
  }

  async createAnalysis(input: ControllerAnalysisInput): Promise<BackendAnalysisTask> {
    return (await this.runtime()).createAnalysis(
      input.images,
      input.context,
      input.cloudIdentity,
    );
  }

  async getAnalysis(
    requestId: string,
    cloudIdentity?: CloudRequestIdentity,
  ): Promise<BackendAnalysisTask> {
    return (await this.runtime()).getAnalysis(requestId, cloudIdentity);
  }

  async cancelAnalysis(
    requestId: string,
    cloudIdentity?: CloudRequestIdentity,
  ): Promise<BackendAnalysisTask> {
    return (await this.runtime()).cancelAnalysis(requestId, cloudIdentity);
  }
}
