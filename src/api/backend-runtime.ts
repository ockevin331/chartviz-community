import {
  AnalysisApiError,
  cancelChartAnalysisTask,
  createChartAnalysisTask,
  getChartAnalysisTask,
  getCloudBackendCapabilities,
} from './analysis-client';
import { parseCompatibleCapabilities, type BackendCapabilities } from './backend-capabilities';
import { CommunityAnalysisClient } from './community-client';
import type { VerifiedCommunityConnection } from './community-connection';
import type { ExtensionEdition } from '../config/edition';
import type { AnalysisReport, ChartContext } from '../domain/analysis';
import type { AnalysisProgressEvent } from '../domain/analysis-progress';

export type BackendAnalysisStatus =
  | 'pending'
  | 'processing'
  | 'awaiting_confirmation'
  | 'cancel_requested'
  | 'cancelled'
  | 'completed'
  | 'failed';

export type BackendAnalysisTask = {
  requestId: string;
  status: BackendAnalysisStatus;
  context: ChartContext;
  report?: AnalysisReport;
  error?: string;
  progressEvents?: AnalysisProgressEvent[];
};

export type CloudRequestIdentity = {
  accessToken: string;
  userId: string;
  extensionVersion: string;
};

export interface AnalysisBackendRuntime {
  readonly edition: ExtensionEdition;
  capabilities(): Promise<BackendCapabilities>;
  createAnalysis(
    images: Array<{ timeframe: string; image: Blob }>,
    context: ChartContext,
    identity?: CloudRequestIdentity,
  ): Promise<BackendAnalysisTask>;
  getAnalysis(
    requestId: string,
    identity?: CloudRequestIdentity,
  ): Promise<BackendAnalysisTask>;
  cancelAnalysis(
    requestId: string,
    identity?: CloudRequestIdentity,
  ): Promise<BackendAnalysisTask>;
}

function requireCloudIdentity(identity?: CloudRequestIdentity): CloudRequestIdentity {
  if (!identity?.accessToken || !identity.userId || !identity.extensionVersion) {
    throw new AnalysisApiError(
      'Your ChartViz authorization has expired. Sign in again.',
      'authentication_required',
    );
  }
  return identity;
}

export class CloudBackendRuntime implements AnalysisBackendRuntime {
  readonly edition = 'cloud' as const;

  async capabilities(): Promise<BackendCapabilities> {
    return parseCompatibleCapabilities(await getCloudBackendCapabilities(), 'cloud');
  }

  async createAnalysis(
    images: Array<{ timeframe: string; image: Blob }>,
    context: ChartContext,
    identity?: CloudRequestIdentity,
  ): Promise<BackendAnalysisTask> {
    const required = requireCloudIdentity(identity);
    return createChartAnalysisTask(
      images,
      context,
      required.accessToken,
      { userId: required.userId, version: required.extensionVersion },
    );
  }

  async getAnalysis(
    requestId: string,
    identity?: CloudRequestIdentity,
  ): Promise<BackendAnalysisTask> {
    const required = requireCloudIdentity(identity);
    return getChartAnalysisTask(
      requestId,
      required.accessToken,
      { userId: required.userId, version: required.extensionVersion },
    );
  }

  async cancelAnalysis(
    requestId: string,
    identity?: CloudRequestIdentity,
  ): Promise<BackendAnalysisTask> {
    const required = requireCloudIdentity(identity);
    return cancelChartAnalysisTask(
      requestId,
      required.accessToken,
      { userId: required.userId, version: required.extensionVersion },
    );
  }
}

export class CommunityBackendRuntime implements AnalysisBackendRuntime {
  readonly edition = 'community' as const;

  constructor(
    private readonly client: CommunityAnalysisClient,
    private readonly backendCapabilities: BackendCapabilities,
  ) {}

  async capabilities(): Promise<BackendCapabilities> {
    return this.backendCapabilities;
  }

  async createAnalysis(
    images: Array<{ timeframe: string; image: Blob }>,
    context: ChartContext,
    _identity?: CloudRequestIdentity,
  ): Promise<BackendAnalysisTask> {
    return this.client.createAnalysis(images, context);
  }

  async getAnalysis(
    requestId: string,
    _identity?: CloudRequestIdentity,
  ): Promise<BackendAnalysisTask> {
    return this.client.getAnalysis(requestId);
  }

  async cancelAnalysis(
    requestId: string,
    _identity?: CloudRequestIdentity,
  ): Promise<BackendAnalysisTask> {
    return this.client.cancelAnalysis(requestId);
  }
}

export function createBackendRuntime(options: {
  edition: ExtensionEdition;
  communityConnection?: VerifiedCommunityConnection;
  communityFetcher?: typeof fetch;
}): AnalysisBackendRuntime {
  if (options.edition === 'cloud') return new CloudBackendRuntime();
  if (!options.communityConnection) {
    throw new AnalysisApiError(
      'Connect a Community backend before analyzing a chart.',
      'community_connection_required',
    );
  }
  return new CommunityBackendRuntime(
    new CommunityAnalysisClient(options.communityConnection, options.communityFetcher),
    options.communityConnection.capabilities,
  );
}
