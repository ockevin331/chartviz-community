import { describe, expect, it } from 'vitest';
import { approvedHostPermissions, createManifest } from '../wxt.config';
import { supportedContentMatches } from '../src/sites/supported-sites';

describe('extension manifest', () => {
  it('uses only the approved temporary-tab permissions and exact provider origins', () => {
    const manifest = createManifest();

    expect(manifest.name).toBe('ChartViz');
    expect(manifest.permissions).toEqual(['activeTab', 'storage', 'scripting']);
    expect(manifest.host_permissions).toEqual(approvedHostPermissions);
    expect('content_scripts' in manifest).toBe(false);
    expect(manifest.action.default_popup).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toContain('<all_urls>');
    expect(manifest.optional_host_permissions).toBeUndefined();
  });

  it('limits the static content bridge to the supported chart URL patterns', () => {
    expect(supportedContentMatches).toContain('https://*.tradingview.com/chart/*');
    expect(supportedContentMatches).toContain('https://*.binance.com/*/trade/*');
    expect(supportedContentMatches).toContain('https://vergex.trade/chart*');
    expect(supportedContentMatches).not.toContain('http://*/*');
    expect(supportedContentMatches).not.toContain('https://*/*');
    expect(JSON.stringify(supportedContentMatches)).not.toContain('<all_urls>');
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
