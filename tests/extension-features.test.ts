import { describe, expect, it } from 'vitest';

import { deriveExtensionFeatures } from '../src/domain/extension-features';

const communityCapabilities = {
  edition: 'community' as const, apiVersion: '1' as const, reportSchemaVersion: '1.3' as const,
  limits: { maxImages: 1, maxTimeframes: 1 },
  features: {
    multiTimeframe: false, marketDataFusion: false, advancedAnnotations: false,
    cloudAuthentication: false, billing: false,
  },
};
const cloudCapabilities = {
  edition: 'cloud' as const, apiVersion: '1' as const, reportSchemaVersion: '1.3' as const,
  limits: { maxImages: 3, maxTimeframes: 3 },
  features: {
    multiTimeframe: true, marketDataFusion: true, advancedAnnotations: true,
    cloudAuthentication: true, billing: true,
  },
};

describe('extension feature projection', () => {
  it('removes Cloud account surfaces and multi-timeframe from Community', () => {
    expect(deriveExtensionFeatures('community', communityCapabilities)).toEqual({
      cloudAccount: false,
      billing: false,
      modelSelection: false,
      analysisList: false,
      multiTimeframe: false,
      advancedAnnotations: false,
    });
  });

  it('enables Cloud features only when advertised', () => {
    expect(deriveExtensionFeatures('cloud', cloudCapabilities)).toEqual({
      cloudAccount: true,
      billing: true,
      modelSelection: true,
      analysisList: true,
      multiTimeframe: true,
      advancedAnnotations: true,
    });
  });

  it('rejects an edition/capability mismatch', () => {
    expect(() => deriveExtensionFeatures('community', cloudCapabilities))
      .toThrow('unexpected_backend_edition');
  });
});
