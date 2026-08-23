import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { deriveExtensionFeatures } from '../src/domain/extension-features';

describe('Community extension build boundary', () => {
  it('ships documented builds and a packaged-manifest audit', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(existsSync('scripts/check-community-extension-artifact.mjs')).toBe(true);
    expect(Object.values(packageJson.scripts)).toContain('wxt build --mode community');
    expect(readFileSync('services/community/README.md', 'utf8')).toContain('ChartViz Community extension');
  });

  it('keeps secrets out of public extension configuration', () => {
    const extensionEnvironment = existsSync('.env.example')
      ? readFileSync('.env.example', 'utf8')
      : '';
    expect(extensionEnvironment).not.toMatch(
      /CHARTVIZ_LOCAL_API_TOKEN\s*=\s*\S+/,
    );
    expect(readFileSync('services/community/.env.example', 'utf8')).toMatch(
      /^CHARTVIZ_LLM_API_KEY=\s*$/m,
    );
  });

  it('projects no Cloud account surfaces for the public backend', () => {
    const features = deriveExtensionFeatures('community', {
      edition: 'community', apiVersion: '1', reportSchemaVersion: '1.3',
      limits: { maxImages: 1, maxTimeframes: 1 },
      features: {
        multiTimeframe: false, marketDataFusion: false, advancedAnnotations: false,
        cloudAuthentication: false, billing: false,
      },
    });

    expect(features).toMatchObject({
      cloudAccount: false, billing: false, modelSelection: false, analysisList: false,
    });
  });
});
