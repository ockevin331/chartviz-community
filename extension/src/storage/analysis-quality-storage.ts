import { browser } from 'wxt/browser';
import {
  ANALYSIS_VALIDATION_POLICY_VERSION,
  type AnalysisQualityDiagnostic,
  type AnalysisWarning,
} from '../analysis/analysis-quality-diagnostics';
import { COMMUNITY_ANALYSIS_PIPELINE_VERSION } from '../analysis/semantic-diagnostics';

const storageKey = 'lastAnalysisQuality';
const sensitiveValue = /(?:data:image\/|bearer\s+|\bsk-[A-Za-z0-9_-]{8,}|api[_ -]?key)/i;

function boundedPath(path: readonly (string | number)[]): readonly (string | number)[] {
  const bounded: Array<string | number> = [];
  let length = 0;
  for (const segment of path) {
    const separatorLength = bounded.length === 0 ? 0 : 1;
    const available = 160 - length - separatorLength;
    if (available <= 0) break;
    const stringValue = String(segment);
    bounded.push(typeof segment === 'number' && stringValue.length <= available
      ? segment
      : stringValue.slice(0, available));
    length += Math.min(stringValue.length, available) + separatorLength;
  }
  return Object.freeze(bounded);
}

function sanitizedWarning(warning: AnalysisWarning): AnalysisWarning {
  const normalized = warning.valuePreview.replace(/\s+/g, ' ').trim();
  return Object.freeze({
    stage: warning.stage,
    code: warning.code,
    path: boundedPath(warning.path),
    valuePreview: sensitiveValue.test(normalized) ? '[redacted]' : normalized.slice(0, 120),
  });
}

function sanitizedDiagnostic(value: AnalysisQualityDiagnostic): AnalysisQualityDiagnostic {
  return Object.freeze({
    source: 'extension_local',
    pipelineVersion: COMMUNITY_ANALYSIS_PIPELINE_VERSION,
    validationPolicyVersion: ANALYSIS_VALIDATION_POLICY_VERSION,
    requestId: value.requestId.slice(0, 160),
    provider: value.provider,
    model: value.model.slice(0, 160),
    occurredAt: value.occurredAt,
    durationMs: Math.max(0, Math.round(value.durationMs)),
    warnings: Object.freeze(value.warnings.slice(0, 20).map(sanitizedWarning)),
  });
}

export async function saveLastAnalysisQuality(value: AnalysisQualityDiagnostic): Promise<void> {
  await browser.storage.local.set({ [storageKey]: sanitizedDiagnostic(value) });
}

export async function loadLastAnalysisQuality(): Promise<AnalysisQualityDiagnostic | null> {
  const stored = await browser.storage.local.get(storageKey);
  const value = stored[storageKey];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<AnalysisQualityDiagnostic>;
  return candidate.source === 'extension_local'
    && candidate.pipelineVersion === COMMUNITY_ANALYSIS_PIPELINE_VERSION
    && candidate.validationPolicyVersion === ANALYSIS_VALIDATION_POLICY_VERSION
    && typeof candidate.requestId === 'string'
    && Array.isArray(candidate.warnings)
    ? value as AnalysisQualityDiagnostic
    : null;
}

export async function clearLastAnalysisQuality(): Promise<void> {
  await browser.storage.local.remove(storageKey);
}
