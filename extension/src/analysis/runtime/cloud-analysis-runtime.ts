import {
  buildPresentationAnnotations,
  type PresentationSourceCapture,
} from '../../annotations/build-presentation-annotations';
import type { PresentationAnnotatedImages } from '../../annotations/annotation-types';
import {
  CloudConnectionError,
  createCloudClient,
  type CloudClient,
} from '../../cloud/cloud-client';
import type { ExtensionAnalysisTask } from '../../cloud/contracts/extension-cloud-v1';
import type { ExtensionReport } from '../../cloud/contracts/extension-cloud-v1';
import { adaptCloudPresentation } from '../../presentation/cloud-presentation-adapter';
import type { PresentationBundle, PresentationDrawing } from '../../presentation/report-presentation-model';
import {
  clearCloudCleanupPending,
  cloudGrantFingerprint,
  loadCloudCleanupPending,
  loadCloudConnection,
  saveCloudCleanupPending,
  type CloudCleanupPendingStorage,
  type StoredCloudConnection,
} from '../../storage/cloud-connection-storage';
import {
  clearCloudActiveTask,
  loadCloudActiveTask,
  saveCloudActiveTask,
  type StoredCloudActiveTask,
} from '../../storage/cloud-active-task-storage';
import {
  AnalysisRuntimeFailure,
  type AnalysisCapture,
  type AnalysisRuntime,
  type AnalysisRuntimeInput,
  type AnalysisRuntimeOutcome,
  type ProgressMessage,
} from './analysis-runtime';

type ActiveTaskStorage = Readonly<{
  load(): Promise<StoredCloudActiveTask | null>;
  save(value: StoredCloudActiveTask): Promise<void>;
  clear(expectedRequestId?: string): Promise<void>;
}>;

type CloudAnalysisOperation = {
  readonly controller: AbortController;
  requestId: string | null;
  token: string | null;
  cancelRequested: boolean;
  cancelResponse: Promise<ExtensionAnalysisTask> | null;
};

export type CloudAnalysisRuntimeDependencies = Readonly<{
  client: Pick<CloudClient, 'createTask' | 'task' | 'cancelTask'>;
  connection: Readonly<{ load(): Promise<StoredCloudConnection | null> }>;
  activeTask: ActiveTaskStorage;
  cleanupPending: CloudCleanupPendingStorage;
  fingerprintGrant(token: string): Promise<string>;
  sleep(delayMs: number, signal: AbortSignal): Promise<void>;
  adaptPresentation(report: ExtensionReport): PresentationBundle;
  buildAnnotations(
    captures: readonly PresentationSourceCapture[],
    drawings: readonly PresentationDrawing[],
  ): Promise<PresentationAnnotatedImages>;
}>;

function abortableSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

const defaultDependencies: CloudAnalysisRuntimeDependencies = {
  client: createCloudClient(),
  connection: { load: loadCloudConnection },
  activeTask: {
    load: loadCloudActiveTask,
    save: saveCloudActiveTask,
    clear: clearCloudActiveTask,
  },
  cleanupPending: {
    load: loadCloudCleanupPending,
    save: saveCloudCleanupPending,
    clear: clearCloudCleanupPending,
  },
  fingerprintGrant: cloudGrantFingerprint,
  sleep: abortableSleep,
  adaptPresentation: adaptCloudPresentation,
  buildAnnotations: buildPresentationAnnotations,
};

const cloudCapabilities = Object.freeze({
  multiTimeframe: true,
  maxTimeframes: 3,
} as const);

function cloudFailure(error: CloudConnectionError): AnalysisRuntimeFailure {
  if (error.code === 'task_cancelled') return new AnalysisRuntimeFailure('cancelled');
  return new AnalysisRuntimeFailure(error.code, null, {
    params: error.params,
    pricingUrl: error.pricingUrl,
  });
}

function taskFailure(task: ExtensionAnalysisTask): AnalysisRuntimeFailure {
  const error = task.error;
  if (!error) return new AnalysisRuntimeFailure('task_failed');
  if (error.code === 'task_cancelled') return new AnalysisRuntimeFailure('cancelled');
  return new AnalysisRuntimeFailure(error.code, null, {
    params: error.params,
    pricingUrl: error.pricingUrl,
  });
}

export class CloudAnalysisRuntime implements AnalysisRuntime {
  readonly mode = 'cloud' as const;
  private readonly dependencies: CloudAnalysisRuntimeDependencies;
  private activeOperation: CloudAnalysisOperation | null = null;

  constructor(dependencies: Partial<CloudAnalysisRuntimeDependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  capabilities(): typeof cloudCapabilities {
    return cloudCapabilities;
  }

  async restoreActiveAnalysis(): Promise<Readonly<{
    captures: readonly AnalysisCapture[];
    outputLanguage: 'en' | 'zh-CN';
  }> | null> {
    const connection = await this.dependencies.connection.load();
    if (!connection) return null;
    const tokenFingerprint = await this.dependencies.fingerprintGrant(connection.token);
    const active = await this.dependencies.activeTask.load();
    if (active && active.tokenFingerprint !== tokenFingerprint) {
      await this.dependencies.activeTask.clear(active.requestId);
      return null;
    }
    return active
      ? { captures: active.captures, outputLanguage: active.outputLanguage }
      : null;
  }

  private emitProgress(
    task: ExtensionAnalysisTask,
    seen: Set<ProgressMessage>,
    callback: AnalysisRuntimeInput['onProgress'],
  ): void {
    for (const event of task.progressEvents ?? []) {
      if (seen.has(event.code)) continue;
      seen.add(event.code);
      callback?.(event.code);
    }
  }

  private startServerCancel(
    operation: CloudAnalysisOperation,
  ): Promise<ExtensionAnalysisTask> | null {
    if (operation.cancelResponse) return operation.cancelResponse;
    if (!operation.requestId || !operation.token) return null;
    const response = this.dependencies.client.cancelTask(
      operation.token,
      operation.requestId,
    );
    void response.catch(() => undefined);
    operation.cancelResponse = response;
    return response;
  }

  private isCurrent(operation: CloudAnalysisOperation): boolean {
    return this.activeOperation === operation;
  }

  private requireCurrent(operation: CloudAnalysisOperation): void {
    if (
      !this.isCurrent(operation)
      || operation.cancelRequested
      || operation.controller.signal.aborted
    ) {
      throw new AnalysisRuntimeFailure('cancelled');
    }
  }

  private async clearActiveTask(operation: CloudAnalysisOperation): Promise<void> {
    if (!this.isCurrent(operation) || !operation.requestId) return;
    await this.dependencies.activeTask.clear(operation.requestId);
  }

  private async settleCleanupPendingRequest(
    operation: CloudAnalysisOperation,
    token: string,
    tokenFingerprint: string,
  ): Promise<void> {
    this.requireCurrent(operation);
    const pendingRequest = await this.dependencies.cleanupPending.load();
    this.requireCurrent(operation);
    if (!pendingRequest) return;
    if (pendingRequest.tokenFingerprint !== tokenFingerprint) {
      this.requireCurrent(operation);
      await this.dependencies.cleanupPending.clear();
      return;
    }
    let task: ExtensionAnalysisTask;
    try {
      this.requireCurrent(operation);
      task = await this.dependencies.client.cancelTask(
        token,
        pendingRequest.requestId,
      );
    } catch (error) {
      if (
        error instanceof CloudConnectionError
        && error.code === 'task_not_found'
      ) {
        this.requireCurrent(operation);
        await this.dependencies.cleanupPending.clear();
        return;
      }
      throw new AnalysisRuntimeFailure('service_unavailable');
    }
    if (['completed', 'failed', 'cancelled'].includes(task.status)) {
      this.requireCurrent(operation);
      await this.dependencies.cleanupPending.clear();
      return;
    }
    throw new AnalysisRuntimeFailure('service_unavailable');
  }

  private async completedOutcome(
    operation: CloudAnalysisOperation,
    task: ExtensionAnalysisTask,
    captures: readonly AnalysisCapture[],
  ): Promise<AnalysisRuntimeOutcome> {
    if (!task.report) {
      await this.clearActiveTask(operation);
      throw new AnalysisRuntimeFailure('incompatible_report_schema');
    }
    const reportCaptures = task.report.context.captures;
    const sourceTimeframes = captures.map(({ context }) => context.timeframe);
    if (
      reportCaptures.length !== captures.length
      || reportCaptures.some((metadata, index) => metadata.timeframe !== sourceTimeframes[index])
    ) {
      await this.clearActiveTask(operation);
      throw new AnalysisRuntimeFailure('incompatible_report_schema');
    }
    let presentation: PresentationBundle;
    try {
      presentation = this.dependencies.adaptPresentation(task.report);
    } catch {
      await this.clearActiveTask(operation);
      throw new AnalysisRuntimeFailure('incompatible_report_schema');
    }
    if (
      presentation.report.context.captures.length !== captures.length
      || presentation.report.context.captures.some(
        (metadata, index) => metadata.timeframe !== sourceTimeframes[index],
      )
    ) {
      await this.clearActiveTask(operation);
      throw new AnalysisRuntimeFailure('incompatible_report_schema');
    }
    let annotations: PresentationAnnotatedImages;
    try {
      const sources = presentation.report.context.captures.map((metadata, index) => ({
        captureId: metadata.captureId,
        image: captures[index]!.image,
      }));
      annotations = await this.dependencies.buildAnnotations(sources, presentation.drawings);
    } catch {
      await this.clearActiveTask(operation);
      throw new AnalysisRuntimeFailure('invalid_image');
    }
    await this.clearActiveTask(operation);
    return { captures, presentation: presentation.report, annotations };
  }

  private async terminalOutcome(
    operation: CloudAnalysisOperation,
    task: ExtensionAnalysisTask,
    captures: readonly AnalysisCapture[],
  ): Promise<AnalysisRuntimeOutcome | null> {
    if (task.status === 'completed') return this.completedOutcome(operation, task, captures);
    if (task.status === 'failed') {
      await this.clearActiveTask(operation);
      throw taskFailure(task);
    }
    if (task.status === 'cancelled') {
      await this.clearActiveTask(operation);
      throw new AnalysisRuntimeFailure('cancelled');
    }
    return null;
  }

  async analyze(input: AnalysisRuntimeInput): Promise<AnalysisRuntimeOutcome> {
    if (input.captures.length < 1 || input.captures.length > 3) {
      throw new AnalysisRuntimeFailure('invalid_image');
    }
    const operation: CloudAnalysisOperation = {
      controller: new AbortController(),
      requestId: null,
      token: null,
      cancelRequested: false,
      cancelResponse: null,
    };
    const seenProgress = new Set<ProgressMessage>();
    this.activeOperation = operation;
    let captures = input.captures;

    try {
      const connection = await this.dependencies.connection.load();
      this.requireCurrent(operation);
      if (!connection) throw new AnalysisRuntimeFailure('authentication_required');
      operation.token = connection.token;
      const tokenFingerprint = await this.dependencies.fingerprintGrant(connection.token);
      this.requireCurrent(operation);
      let stored = await this.dependencies.activeTask.load();
      this.requireCurrent(operation);
      if (stored && stored.tokenFingerprint !== tokenFingerprint) {
        await this.dependencies.activeTask.clear(stored.requestId);
        this.requireCurrent(operation);
        stored = null;
      }
      let task: ExtensionAnalysisTask;
      if (stored) {
        captures = stored.captures;
        operation.requestId = stored.requestId;
        this.requireCurrent(operation);
        task = await this.dependencies.client.task(
          connection.token,
          stored.requestId,
          operation.controller.signal,
        );
        this.requireCurrent(operation);
      } else {
        await this.settleCleanupPendingRequest(operation, connection.token, tokenFingerprint);
        this.requireCurrent(operation);
        task = await this.dependencies.client.createTask(connection.token, {
          captures,
          outputLanguage: input.outputLanguage,
        });
        operation.requestId = task.requestId;
        this.requireCurrent(operation);
        try {
          await this.dependencies.activeTask.save({
            requestId: task.requestId,
            tokenFingerprint,
            captures,
            outputLanguage: input.outputLanguage,
          });
        } catch {
          if (!this.isCurrent(operation)) {
            this.startServerCancel(operation);
            throw new AnalysisRuntimeFailure('cancelled');
          }
          const pendingCleanup = {
            requestId: task.requestId,
            tokenFingerprint,
          };
          try {
            await this.dependencies.cleanupPending.save(pendingCleanup);
          } catch {
            try {
              await this.dependencies.client.cancelTask(connection.token, task.requestId);
            } catch {
              // The stable failure below remains diagnosable when both local stores are unavailable.
            }
            throw new AnalysisRuntimeFailure('service_unavailable');
          }
          try {
            await this.settleCleanupPendingRequest(operation, connection.token, tokenFingerprint);
          } catch {
            // The persisted tombstone blocks duplicate creation until cleanup is terminal.
          }
          throw new AnalysisRuntimeFailure('service_unavailable');
        }
        this.requireCurrent(operation);
      }
      this.requireCurrent(operation);
      this.emitProgress(task, seenProgress, input.onProgress);
      const immediate = await this.terminalOutcome(operation, task, captures);
      if (immediate) return immediate;

      let attempt = 0;
      while (true) {
        const delay = Math.min(attempt + 1, 3) * 1000;
        attempt += 1;
        await this.dependencies.sleep(delay, operation.controller.signal);
        this.requireCurrent(operation);
        if (!operation.requestId) throw new AnalysisRuntimeFailure('task_not_found');
        task = await this.dependencies.client.task(
          connection.token,
          operation.requestId,
          operation.controller.signal,
        );
        this.requireCurrent(operation);
        this.emitProgress(task, seenProgress, input.onProgress);
        const outcome = await this.terminalOutcome(operation, task, captures);
        if (outcome) return outcome;
      }
    } catch (error) {
      if (operation.controller.signal.aborted || operation.cancelRequested) {
        let terminal: ExtensionAnalysisTask | null;
        try {
          terminal = await (operation.cancelResponse ?? this.startServerCancel(operation));
        } catch (cancelError) {
          if (
            cancelError instanceof CloudConnectionError
            && cancelError.code === 'task_not_found'
          ) {
            await this.clearActiveTask(operation);
          }
          throw new AnalysisRuntimeFailure('cancelled');
        }
        if (terminal?.status === 'completed') {
          return await this.completedOutcome(operation, terminal, captures);
        }
        if (terminal?.status === 'failed' || terminal?.status === 'cancelled') {
          const outcome = await this.terminalOutcome(operation, terminal, captures);
          if (outcome) return outcome;
        }
        throw new AnalysisRuntimeFailure('cancelled');
      }
      if (error instanceof AnalysisRuntimeFailure) throw error;
      if (error instanceof CloudConnectionError) {
        if ([
          'task_not_found',
          'task_failed',
          'task_cancelled',
          'incompatible_report_schema',
          'incompatible_api_version',
        ].includes(error.code)) {
          await this.clearActiveTask(operation);
        }
        throw cloudFailure(error);
      }
      throw new AnalysisRuntimeFailure('unknown');
    } finally {
      if (this.activeOperation === operation) this.activeOperation = null;
    }
  }

  cancel(): void {
    const operation = this.activeOperation;
    if (!operation || operation.cancelRequested) return;
    operation.cancelRequested = true;
    operation.controller.abort(new DOMException('Cancelled', 'AbortError'));
    this.startServerCancel(operation);
  }
}
