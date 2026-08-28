import type { AnalysisRuntime } from '../analysis/runtime/analysis-runtime';
import { CloudAnalysisRuntime } from '../analysis/runtime/cloud-analysis-runtime';

export type CloudAvailability =
  | Readonly<{ available: false; code: 'cloud_not_available' }>
  | Readonly<{ available: true }>;

export interface CloudAnalysisGateway {
  availability(): CloudAvailability;
  runtime(): AnalysisRuntime | null;
}

export const unavailableCloudGateway: CloudAnalysisGateway = Object.freeze({
  availability: (): CloudAvailability => ({ available: false, code: 'cloud_not_available' }),
  runtime: (): null => null,
});

export function createCloudAnalysisGateway(
  runtime: AnalysisRuntime = new CloudAnalysisRuntime(),
): CloudAnalysisGateway {
  if (runtime.mode !== 'cloud') {
    throw new TypeError('Cloud gateway requires a Cloud runtime.');
  }
  return Object.freeze({
    availability: (): CloudAvailability => ({ available: true }),
    runtime: (): AnalysisRuntime => runtime,
  });
}

export const productionCloudGateway = createCloudAnalysisGateway();

export function resolveCloudRuntime(
  gateway: CloudAnalysisGateway,
): AnalysisRuntime | null {
  if (!gateway.availability().available) return null;
  const runtime = gateway.runtime();
  if (!runtime || runtime.mode !== 'cloud') {
    throw new TypeError('Available Cloud gateway must expose a Cloud runtime.');
  }
  return runtime;
}
