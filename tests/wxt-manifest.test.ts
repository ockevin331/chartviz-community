import { describe, expect, it } from 'vitest';
import type { ConfigEnv, UserManifest } from 'wxt';

import config from '../wxt.config';

async function manifestFor(mode: string): Promise<UserManifest> {
  const manifest = config.manifest;
  if (typeof manifest !== 'function') return manifest ?? {};

  return manifest({
    mode,
    command: mode === 'development' ? 'serve' : 'build',
    browser: 'chrome',
    manifestVersion: 3,
  } satisfies ConfigEnv);
}

describe('WXT manifest', () => {
  it('omits the development key from production packages', async () => {
    expect(await manifestFor('production')).not.toHaveProperty('key');
  });

  it('keeps a stable extension ID during local development', async () => {
    expect(await manifestFor('development')).toHaveProperty('key');
  });

  it('keeps Cloud identity and host permissions in the default build', async () => {
    const cloud = await manifestFor('production');
    const retiredHost = `chartviz.${'octopus31.com'}`;

    expect(cloud.name).toBe('ChartViz');
    expect(cloud.host_permissions).toContain('https://www.chartviz.xyz/*');
    expect(cloud.host_permissions).not.toContain(`https://${retiredHost}/*`);
    expect(cloud.permissions).toContain('identity');
  });

  it('omits Cloud identity and host permissions from Community builds', async () => {
    const community = await manifestFor('community');
    const retiredHost = `chartviz.${'octopus31.com'}`;

    expect(community.name).toBe('ChartViz Community');
    expect(community.host_permissions).not.toContain(`https://${retiredHost}/*`);
    expect(community.host_permissions).not.toContain('https://chartviz.xyz/*');
    expect(community.host_permissions).not.toContain('https://www.chartviz.xyz/*');
    expect(community.optional_host_permissions).toContain('<all_urls>');
    expect(community.permissions).not.toContain('identity');
    expect(community).not.toHaveProperty('key');
  });

  it('does not expose unused extension assets to every website', async () => {
    const manifest = await manifestFor('production');
    const resources = manifest.web_accessible_resources ?? [];

    expect(resources).not.toContainEqual(
      expect.objectContaining({ matches: expect.arrayContaining(['<all_urls>']) }),
    );
  });
});
