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
import {
  describeCloudCaptures,
  type StoredCaptureDescriptor,
} from '../../cloud/cloud-capture-descriptors';
import type {
  ExtensionAnalysisTask,
  ExtensionReport,
} from '../../cloud/contracts/extension-cloud-v1';
import { adaptCloudPresentation } from '../../presentation/cloud-presentation-adapter';
import type {
  PresentationBundle,
  PresentationDrawing,
} from '../../presentation/report-presentation-model';
import {
  loadCloudConnection,
  type StoredCloudConnection,
} from '../../storage/cloud-connection-storage';
import {
  AnalysisRuntimeFailure,
  type AnalysisCapture,
  type AnalysisRuntime,
  type AnalysisRuntimeInput,
  type AnalysisRuntimeOutcome,
  type ProgressMessage,
} from './analysis-runtime';

type CloudAnalysisOperation = {
  readonly controller: AbortController;
  requestId: string | null;
  token: string | null;
  cancelRequested: boolean;
  detached: boolean;
  cancelResponse: Promise<ExtensionAnalysisTask> | null;
};

export type CloudAnalysisRuntimeDependencies = Readonly<{
  client: Pick<CloudClient, 'createTask' | 'task' | 'cancelTask'>;
  connection: Readonly<{ load(): Promise<StoredCloudConnection | null> }>;
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

function captureMetadataMatchesDescriptors(
  metadata: readonly Readonly<{
    captureId: string;
    timeframe: string;
    width: number;
    height: number;
  }>[],
  descriptors: readonly StoredCaptureDescriptor[],
): boolean {
  return metadata.length === descriptors.length
    && metadata.every((capture, index) => {
      const descriptor = descriptors[index]!;
      return capture.captureId === descriptor.captureId
        && capture.timeframe === descriptor.timeframe
        && capture.width === descriptor.width
        && capture.height === descriptor.height;
    });
}

function captureIdentityMatchesDescriptors(
  metadata: readonly Readonly<{ captureId: string; timeframe: string | null }>[],
  descriptors: readonly StoredCaptureDescriptor[],
): boolean {
  return metadata.length === descriptors.length
    && metadata.every((capture, index) => {
      const descriptor = descriptors[index]!;
      return capture.captureId === descriptor.captureId
        && capture.timeframe === descriptor.timeframe;
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

  private requireCurrent(operation: CloudAnalysisOperation): void {
    if (
      this.activeOperation !== operation
      || operation.cancelRequested
      || operation.controller.signal.aborted
    ) {
      throw new AnalysisRuntimeFailure('cancelled');
    }
  }

  private async completedOutcome(
    task: ExtensionAnalysisTask,
    captures: readonly AnalysisCapture[],
  ): Promise<AnalysisRuntimeOutcome> {
    if (!task.report) throw new AnalysisRuntimeFailure('incompatible_report_schema');
    let descriptors: readonly StoredCaptureDescriptor[];
    try {
      descriptors = describeCloudCaptures(captures);
    } catch {
      throw new AnalysisRuntimeFailure('invalid_image');
    }
    if (!captureMetadataMatchesDescriptors(task.report.context.captures, descriptors)) {
      throw new AnalysisRuntimeFailure('incompatible_report_schema');
    }
    let presentation: PresentationBundle;
    try {
      presentation = this.dependencies.adaptPresentation(task.report);
    } catch {
      throw new AnalysisRuntimeFailure('incompatible_report_schema');
    }
    if (!captureIdentityMatchesDescriptors(
      presentation.report.context.captures,
      descriptors,
    )) {
      throw new AnalysisRuntimeFailure('incompatible_report_schema');
    }
    let annotations: PresentationAnnotatedImages;
    try {
      const sources = presentation.report.context.captures.map((metadata, index) => ({
        captureId: metadata.captureId,
        image: captures[index]!.image,
      }));
      annotations = await this.dependencies.buildAnnotations(
        sources,
        presentation.drawings,
      );
    } catch {
      throw new AnalysisRuntimeFailure('invalid_image');
    }
    return { captures, presentation: presentation.report, annotations };
  }

  private async terminalOutcome(
    task: ExtensionAnalysisTask,
    captures: readonly AnalysisCapture[],
  ): Promise<AnalysisRuntimeOutcome | null> {
    if (task.status === 'completed') return this.completedOutcome(task, captures);
    if (task.status === 'failed') throw taskFailure(task);
    if (task.status === 'cancelled') throw new AnalysisRuntimeFailure('cancelled');
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
      detached: false,
      cancelResponse: null,
    };
    const seenProgress = new Set<ProgressMessage>();
    this.activeOperation = operation;

    try {
      const connection = await this.dependencies.connection.load();
      this.requireCurrent(operation);
      if (!connection) throw new AnalysisRuntimeFailure('authentication_required');
      operation.token = connection.token;
      let task = await this.dependencies.client.createTask(connection.token, {
        captures: input.captures,
        outputLanguage: input.outputLanguage,
      });
      operation.requestId = task.requestId;
      this.requireCurrent(operation);
      this.emitProgress(task, seenProgress, input.onProgress);
      const immediate = await this.terminalOutcome(task, input.captures);
      if (immediate) return immediate;

      let attempt = 0;
      while (true) {
        const delay = Math.min(attempt + 1, 3) * 1000;
        attempt += 1;
        await this.dependencies.sleep(delay, operation.controller.signal);
        this.requireCurrent(operation);
        task = await this.dependencies.client.task(
          connection.token,
          task.requestId,
          operation.controller.signal,
        );
        this.requireCurrent(operation);
        this.emitProgress(task, seenProgress, input.onProgress);
        const outcome = await this.terminalOutcome(task, input.captures);
        if (outcome) return outcome;
      }
    } catch (error) {
      if (operation.detached && !operation.cancelRequested) {
        throw new AnalysisRuntimeFailure('cancelled');
      }
      if (operation.controller.signal.aborted || operation.cancelRequested) {
        let terminal: ExtensionAnalysisTask | null;
        try {
          terminal = await (operation.cancelResponse ?? this.startServerCancel(operation));
        } catch {
          throw new AnalysisRuntimeFailure('cancelled');
        }
        if (terminal?.status === 'completed') {
          return this.completedOutcome(terminal, input.captures);
        }
        if (terminal?.status === 'failed' || terminal?.status === 'cancelled') {
          const outcome = await this.terminalOutcome(terminal, input.captures);
          if (outcome) return outcome;
        }
        throw new AnalysisRuntimeFailure('cancelled');
      }
      if (error instanceof AnalysisRuntimeFailure) throw error;
      if (error instanceof CloudConnectionError) throw cloudFailure(error);
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

  detach(): void {
    const operation = this.activeOperation;
    if (!operation || operation.detached) return;
    operation.detached = true;
    operation.controller.abort(new DOMException('Detached', 'AbortError'));
  }
}
