import type { components } from './extension-cloud-v1.generated';

export const EXTENSION_CLOUD_API_VERSION = '1' as const;
export const EXTENSION_CLOUD_REPORT_VERSION = 'extension-report-1.0' as const;

export type ExtensionCapabilities = components['schemas']['ExtensionCapabilities'];
export type ExtensionAccount = components['schemas']['ExtensionAccount'];
export type ExtensionCaptureSettings = components['schemas']['ExtensionCaptureSettings'];
export type ExtensionAnalysisTask = components['schemas']['ExtensionAnalysisTask'];
export type ExtensionReport = components['schemas']['ExtensionReport'];
export type ExtensionApiError = components['schemas']['ExtensionApiError'];
