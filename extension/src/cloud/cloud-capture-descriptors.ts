import type { AnalysisCapture } from '../analysis/runtime/analysis-runtime';
import type { ExtensionApiError } from './contracts/extension-cloud-v1';

export type CloudConnectionErrorCode = ExtensionApiError['code'];

export class CloudConnectionError extends Error {
  readonly code: CloudConnectionErrorCode;
  readonly params: ExtensionApiError['params'];
  readonly pricingUrl: string | null;
  readonly limit: number | null;
  readonly activeTaskIds: readonly string[];

  constructor(
    code: CloudConnectionErrorCode,
    params: ExtensionApiError['params'] = {},
    pricingUrl: string | null = null,
    limit: number | null = null,
    activeTaskIds: readonly string[] = [],
  ) {
    super(code);
    this.name = 'CloudConnectionError';
    this.code = code;
    this.params = params;
    this.pricingUrl = pricingUrl;
    this.limit = limit;
    this.activeTaskIds = Object.freeze([...activeTaskIds]);
  }
}

export type StoredCaptureDescriptor = Readonly<{
  captureId: 'C01' | 'C02' | 'C03';
  timeframe: string;
  role: 'context' | 'setup' | 'trigger' | 'setup_and_trigger' | null;
  instrument: string | null;
  site: string | null;
  exchange: string | null;
  pageType: 'advanced-chart' | 'spot-trade' | 'futures-trade' | 'stock-trade' | 'web3-token' | null;
  width: number;
  height: number;
}>;

const timeframeDurations = Object.freeze({
  '1m': 1,
  '3m': 3,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '2h': 120,
  '4h': 240,
  '6h': 360,
  '8h': 480,
  '12h': 720,
  '1d': 1440,
  '3d': 4320,
  '1w': 10080,
  '1M': 43200,
} as const);

const pageTypes = new Set<NonNullable<StoredCaptureDescriptor['pageType']>>([
  'advanced-chart', 'spot-trade', 'futures-trade', 'stock-trade', 'web3-token',
]);

function captureIdForIndex(index: number): StoredCaptureDescriptor['captureId'] {
  return `C0${index + 1}` as StoredCaptureDescriptor['captureId'];
}

function isSupportedTimeframe(
  timeframe: string,
): timeframe is keyof typeof timeframeDurations {
  return Object.hasOwn(timeframeDurations, timeframe);
}

function invalidImage(): never {
  throw new CloudConnectionError('invalid_image');
}

function normalizedOptionalString(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return invalidImage();
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) return invalidImage();
  return normalized;
}

function normalizedTimeframe(value: unknown): string {
  if (typeof value !== 'string') throw new CloudConnectionError('unsupported_timeframe');
  const timeframe = value.trim();
  if (!isSupportedTimeframe(timeframe)) {
    throw new CloudConnectionError('unsupported_timeframe');
  }
  return timeframe;
}

function normalizedDimension(value: unknown, minimum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > 10000) {
    return invalidImage();
  }
  return value;
}

function normalizedRoles(timeframes: readonly string[]): readonly StoredCaptureDescriptor['role'][] {
  const rolesByDuration: readonly StoredCaptureDescriptor['role'][] = timeframes.length === 1
    ? [null]
    : timeframes.length === 2
      ? ['context', 'setup_and_trigger']
      : ['context', 'setup', 'trigger'];
  const orderedIndices = timeframes
    .map((_, index) => index)
    .sort((left, right) => (
      timeframeDurations[timeframes[right] as keyof typeof timeframeDurations]
      - timeframeDurations[timeframes[left] as keyof typeof timeframeDurations]
    ));
  const roles: StoredCaptureDescriptor['role'][] = Array(timeframes.length).fill(null);
  orderedIndices.forEach((captureIndex, roleIndex) => {
    roles[captureIndex] = rolesByDuration[roleIndex] ?? null;
  });
  return roles;
}

export function areCanonicalStoredCaptureDescriptors(
  captures: readonly StoredCaptureDescriptor[],
): boolean {
  if (captures.length < 1 || captures.length > 3) return false;
  const timeframes = captures.map((capture) => capture.timeframe);
  if (
    timeframes.some((timeframe) => !isSupportedTimeframe(timeframe))
    || new Set(timeframes).size !== timeframes.length
  ) {
    return false;
  }
  const roles = normalizedRoles(timeframes);
  return captures.every((capture, index) => (
    capture.captureId === captureIdForIndex(index)
    && capture.role === roles[index]
  ));
}

export function describeCloudCaptures(
  captures: readonly AnalysisCapture[],
): readonly StoredCaptureDescriptor[] {
  if (captures.length < 1 || captures.length > 3) return invalidImage();
  const timeframes = captures.map((capture) => normalizedTimeframe(capture.context.timeframe));
  if (new Set(timeframes).size !== timeframes.length) {
    throw new CloudConnectionError('unsupported_timeframe');
  }
  const roles = normalizedRoles(timeframes);
  return captures.map((capture, index) => {
    const pageType = capture.context.pageType ?? null;
    if (pageType !== null && !pageTypes.has(pageType)) return invalidImage();
    return Object.freeze({
      captureId: captureIdForIndex(index),
      timeframe: timeframes[index]!,
      role: roles[index]!,
      instrument: normalizedOptionalString(capture.context.instrument, 120),
      site: normalizedOptionalString(capture.context.site, 80),
      exchange: normalizedOptionalString(capture.context.exchange, 120),
      pageType,
      width: normalizedDimension(capture.image.width, 320),
      height: normalizedDimension(capture.image.height, 180),
    });
  });
}
