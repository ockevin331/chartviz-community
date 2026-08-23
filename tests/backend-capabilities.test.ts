import { describe, expect, it } from 'vitest';

import { parseCompatibleCapabilities } from '../src/api/backend-capabilities';

const communityPayload = {
  edition: 'community',
  apiVersion: '1',
  reportSchemaVersion: '1.3',
  limits: { maxImages: 1, maxTimeframes: 1 },
  features: {
    multiTimeframe: false,
    marketDataFusion: false,
    advancedAnnotations: false,
    cloudAuthentication: false,
    billing: false,
  },
};

const cloudPayload = {
  edition: 'cloud',
  apiVersion: '1',
  reportSchemaVersion: '1.3',
  limits: { maxImages: 3, maxTimeframes: 3 },
  features: {
    multiTimeframe: true,
    marketDataFusion: true,
    advancedAnnotations: true,
    cloudAuthentication: true,
    billing: true,
  },
};

describe('backend capability compatibility', () => {
  it('accepts the Community contract for a Community extension', () => {
    expect(parseCompatibleCapabilities(communityPayload, 'community')).toEqual(communityPayload);
  });

  it('accepts the Cloud contract for a Cloud extension', () => {
    expect(parseCompatibleCapabilities(cloudPayload, 'cloud')).toEqual(cloudPayload);
  });

  it('ignores forward-compatible unknown keys', () => {
    const parsed = parseCompatibleCapabilities({
      ...communityPayload,
      futureTopLevel: true,
      features: { ...communityPayload.features, futureFeature: true },
    }, 'community');

    expect(parsed).toEqual(communityPayload);
    expect(parsed.features).not.toHaveProperty('futureFeature');
  });

  it('reports API and report-schema incompatibility with stable codes', () => {
    expect(() => parseCompatibleCapabilities({
      ...communityPayload,
      apiVersion: '2',
    }, 'community')).toThrow('incompatible_api_version');
    expect(() => parseCompatibleCapabilities({
      ...communityPayload,
      reportSchemaVersion: '2.0',
    }, 'community')).toThrow('incompatible_report_schema');
  });

  it('rejects a valid backend from the other edition', () => {
    expect(() => parseCompatibleCapabilities(cloudPayload, 'community'))
      .toThrow('unexpected_backend_edition');
  });

  it('maps malformed payloads to one safe error code', () => {
    expect(() => parseCompatibleCapabilities({ edition: 'community' }, 'community'))
      .toThrow('invalid_capability_response');
  });
});
