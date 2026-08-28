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
import { loadCloudConnection, type StoredCloudConnection } from '../../storage/cloud-connection-storage';
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
  clear(): Promise<void>;
}>;

type CleanupPendingRequest = Readonly<{
  requestId: string;
  token: string;
}>;

export type CloudAnalysisRuntimeDependencies = Readonly<{
  client: Pick<CloudClient, 'createTask' | 'task' | 'cancelTask'>;
  connection: Readonly<{ load(): Promise<StoredCloudConnection | null> }>;
  activeTask: ActiveTaskStorage;
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
  private pollingController: AbortController | null = null;
  private activeRequestId: string | null = null;
  private activeToken: string | null = null;
  private cancelRequested = false;
  private cancelResponse: Promise<ExtensionAnalysisTask> | null = null;
  private cleanupPendingRequest: CleanupPendingRequest | null = null;

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
    const active = await this.dependencies.activeTask.load();
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

  private startServerCancel(): Promise<ExtensionAnalysisTask> | null {
    if (this.cancelResponse) return this.cancelResponse;
    if (!this.activeRequestId || !this.activeToken) return null;
    const response = this.dependencies.client.cancelTask(
      this.activeToken,
      this.activeRequestId,
    );
    void response.catch(() => undefined);
    this.cancelResponse = response;
    return response;
  }

  private async settleCleanupPendingRequest(): Promise<void> {
    const pendingRequest = this.cleanupPendingRequest;
    if (!pendingRequest) return;
    let task: ExtensionAnalysisTask;
    try {
      task = await this.dependencies.client.cancelTask(
        pendingRequest.token,
        pendingRequest.requestId,
      );
    } catch (error) {
      if (
        error instanceof CloudConnectionError
        && error.code === 'task_not_found'
      ) {
        this.cleanupPendingRequest = null;
        return;
      }
      throw new AnalysisRuntimeFailure('service_unavailable');
    }
    if (['completed', 'failed', 'cancelled'].includes(task.status)) {
      this.cleanupPendingRequest = null;
      return;
    }
    throw new AnalysisRuntimeFailure('service_unavailable');
  }

  private async completedOutcome(
    task: ExtensionAnalysisTask,
    captures: readonly AnalysisCapture[],
  ): Promise<AnalysisRuntimeOutcome> {
    if (!task.report) {
      await this.dependencies.activeTask.clear();
      throw new AnalysisRuntimeFailure('incompatible_report_schema');
    }
    const reportCaptures = task.report.context.captures;
    const sourceTimeframes = captures.map(({ context }) => context.timeframe);
    if (
      reportCaptures.length !== captures.length
      || reportCaptures.some((metadata, index) => metadata.timeframe !== sourceTimeframes[index])
    ) {
      await this.dependencies.activeTask.clear();
      throw new AnalysisRuntimeFailure('incompatible_report_schema');
    }
    let presentation: PresentationBundle;
    try {
      presentation = this.dependencies.adaptPresentation(task.report);
    } catch {
      await this.dependencies.activeTask.clear();
      throw new AnalysisRuntimeFailure('incompatible_report_schema');
    }
    if (
      presentation.report.context.captures.length !== captures.length
      || presentation.report.context.captures.some(
        (metadata, index) => metadata.timeframe !== sourceTimeframes[index],
      )
    ) {
      await this.dependencies.activeTask.clear();
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
      await this.dependencies.activeTask.clear();
      throw new AnalysisRuntimeFailure('invalid_image');
    }
    await this.dependencies.activeTask.clear();
    return { captures, presentation: presentation.report, annotations };
  }

  private async terminalOutcome(
    task: ExtensionAnalysisTask,
    captures: readonly AnalysisCapture[],
  ): Promise<AnalysisRuntimeOutcome | null> {
    if (task.status === 'completed') return this.completedOutcome(task, captures);
    if (task.status === 'failed') {
      await this.dependencies.activeTask.clear();
      throw taskFailure(task);
    }
    if (task.status === 'cancelled') {
      await this.dependencies.activeTask.clear();
      throw new AnalysisRuntimeFailure('cancelled');
    }
    return null;
  }

  async analyze(input: AnalysisRuntimeInput): Promise<AnalysisRuntimeOutcome> {
    if (input.captures.length < 1 || input.captures.length > 3) {
      throw new AnalysisRuntimeFailure('invalid_image');
    }
    const controller = new AbortController();
    const seenProgress = new Set<ProgressMessage>();
    this.pollingController = controller;
    this.cancelRequested = false;
    this.cancelResponse = null;
    this.activeRequestId = null;
    this.activeToken = null;
    let captures = input.captures;

    try {
      const connection = await this.dependencies.connection.load();
      if (!connection) throw new AnalysisRuntimeFailure('authentication_required');
      this.activeToken = connection.token;
      const stored = await this.dependencies.activeTask.load();
      let task: ExtensionAnalysisTask;
      if (stored) {
        captures = stored.captures;
        this.activeRequestId = stored.requestId;
        task = await this.dependencies.client.task(
          connection.token,
          stored.requestId,
          controller.signal,
        );
      } else {
        await this.settleCleanupPendingRequest();
        task = await this.dependencies.client.createTask(connection.token, {
          captures,
          outputLanguage: input.outputLanguage,
        });
        this.activeRequestId = task.requestId;
        try {
          await this.dependencies.activeTask.save({
            requestId: task.requestId,
            captures,
            outputLanguage: input.outputLanguage,
          });
        } catch {
          this.cleanupPendingRequest = {
            requestId: task.requestId,
            token: connection.token,
          };
          try {
            await this.settleCleanupPendingRequest();
          } catch {
            // Retain the request in memory and block duplicate creation until cleanup is terminal.
          }
          throw new AnalysisRuntimeFailure('service_unavailable');
        }
        if (this.cancelRequested) this.startServerCancel();
      }
      this.emitProgress(task, seenProgress, input.onProgress);
      const immediate = await this.terminalOutcome(task, captures);
      if (immediate) return immediate;

      let attempt = 0;
      while (true) {
        const delay = Math.min(attempt + 1, 3) * 1000;
        attempt += 1;
        await this.dependencies.sleep(delay, controller.signal);
        task = await this.dependencies.client.task(
          connection.token,
          this.activeRequestId,
          controller.signal,
        );
        this.emitProgress(task, seenProgress, input.onProgress);
        const outcome = await this.terminalOutcome(task, captures);
        if (outcome) return outcome;
      }
    } catch (error) {
      if (controller.signal.aborted || this.cancelRequested) {
        let terminal: ExtensionAnalysisTask | null;
        try {
          terminal = await (this.cancelResponse ?? this.startServerCancel());
        } catch (cancelError) {
          if (
            cancelError instanceof CloudConnectionError
            && cancelError.code === 'task_not_found'
          ) {
            await this.dependencies.activeTask.clear();
          }
          throw new AnalysisRuntimeFailure('cancelled');
        }
        if (terminal?.status === 'completed') {
          return this.completedOutcome(terminal, captures);
        }
        if (terminal?.status === 'failed' || terminal?.status === 'cancelled') {
          const outcome = await this.terminalOutcome(terminal, captures);
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
          await this.dependencies.activeTask.clear();
        }
        throw cloudFailure(error);
      }
      throw new AnalysisRuntimeFailure('unknown');
    } finally {
      if (this.pollingController === controller) this.pollingController = null;
      this.activeRequestId = null;
      this.activeToken = null;
      this.cancelResponse = null;
    }
  }

  cancel(): void {
    if (this.cancelRequested) return;
    this.cancelRequested = true;
    this.pollingController?.abort(new DOMException('Cancelled', 'AbortError'));
    this.startServerCancel();
  }
}
