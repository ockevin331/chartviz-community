import { describe, expect, it } from 'vitest';
import { createManifest } from '../wxt.config';

describe('extension manifest', () => {
  it('uses only the approved temporary-tab permissions without broad page access', () => {
    const manifest = createManifest();

    expect(manifest.permissions).toEqual(['activeTab', 'storage', 'scripting']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.action.default_popup).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toContain('<all_urls>');
    expect(manifest.optional_host_permissions).toBeUndefined();
  });

  it('exposes only the floating panel as a dynamic HTTP(S) web resource', () => {
    const manifest = createManifest();

    expect(manifest.web_accessible_resources).toEqual([{
      resources: ['panel.html'],
      matches: ['http://*/*', 'https://*/*'],
      use_dynamic_url: true,
    }]);
  });
});
