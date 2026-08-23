import type { SupportedCaptureTimeframe } from '../domain/messages';

export const MULTI_FRAME_STORAGE_KEY = 'chartviz:multi-frame';
export const DEFAULT_MULTI_TIMEFRAMES: SupportedCaptureTimeframe[] = ['4h', '1h', '15m'];
export const MULTI_TIMEFRAME_ROLE_OPTIONS = {
  context: ['4h', '1d'],
  setup: ['1h', '4h'],
  trigger: ['5m', '15m'],
} as const satisfies Record<string, readonly SupportedCaptureTimeframe[]>;
export const MULTI_TIMEFRAME_OPTIONS: SupportedCaptureTimeframe[] = ['5m', '15m', '1h', '4h', '1d'];

export function validMultiTimeframes(value: unknown): SupportedCaptureTimeframe[] | null {
  if (!Array.isArray(value) || value.length !== 3 || new Set(value).size !== 3) return null;
  if (!value.every((item): item is SupportedCaptureTimeframe =>
    typeof item === 'string' && MULTI_TIMEFRAME_OPTIONS.includes(item as SupportedCaptureTimeframe))) return null;
  if (!MULTI_TIMEFRAME_ROLE_OPTIONS.context.includes(value[0] as '4h' | '1d')
    || !MULTI_TIMEFRAME_ROLE_OPTIONS.setup.includes(value[1] as '1h' | '4h')
    || !MULTI_TIMEFRAME_ROLE_OPTIONS.trigger.includes(value[2] as '5m' | '15m')) return null;
  return [...value];
}
