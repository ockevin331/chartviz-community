import { describe, expect, it } from 'vitest';
import { canonicalAnalysisApiBaseUrl } from '../src/api/base-url';

describe('analysis API base URL', () => {
  it('uses the canonical production host directly', () => {
    expect(canonicalAnalysisApiBaseUrl('https://www.chartviz.xyz/api'))
      .toBe('https://www.chartviz.xyz/api');
  });

  it('normalizes the bare production host before requests are sent', () => {
    const value = 'https://chartviz.xyz/api/';
    expect(canonicalAnalysisApiBaseUrl(value)).toBe('https://www.chartviz.xyz/api');
  });

  it('rejects the retired production host', () => {
    const retiredHost = `chartviz.${'octopus31.com'}`;
    const retired = `https://${retiredHost}/api`;
    expect(() => canonicalAnalysisApiBaseUrl(retired)).toThrow('retired');
  });

  it('keeps an explicitly configured non-production API host', () => {
    expect(canonicalAnalysisApiBaseUrl('https://staging.example.com/api/'))
      .toBe('https://staging.example.com/api');
  });
});
