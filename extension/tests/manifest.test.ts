import { describe, expect, it } from 'vitest';
import { approvedHostPermissions, createManifest } from '../wxt.config';
import {
  isSupportedChartHost,
  supportedChartHosts,
  supportedContentMatches,
  supportedSites,
} from '../src/sites/supported-sites';

describe('extension manifest', () => {
  it('grants auto-opened chart panels permission to capture the visible tab', () => {
    const manifest = createManifest();

    expect(manifest.name).toBe('ChartViz');
    expect(manifest.permissions).toEqual(['activeTab', 'storage', 'scripting', 'clipboardWrite']);
    expect(manifest.host_permissions).toEqual(approvedHostPermissions);
    expect('content_scripts' in manifest).toBe(false);
    expect(manifest.action.default_popup).toBeUndefined();
    expect(manifest.host_permissions).toContain('<all_urls>');
    expect(manifest.optional_host_permissions).toBeUndefined();
    expect(manifest.host_permissions).toContain('https://www.chartviz.xyz/*');
    expect(manifest.host_permissions).not.toContain('https://generativelanguage.googleapis.com/*');
    expect(manifest.host_permissions).not.toContain('https://*.chartviz.xyz/*');
    expect(manifest.host_permissions).not.toContain('http://www.chartviz.xyz/*');
  });

  it('limits the static content bridge to the supported chart URL patterns', () => {
    expect(supportedContentMatches).toEqual(supportedSites.flatMap((site) => site.contentMatches));
    expect(supportedChartHosts).toEqual(supportedSites.flatMap((site) => site.hostPermissions));
    expect(new Set(supportedContentMatches).size).toBe(supportedContentMatches.length);
    expect(new Set(supportedChartHosts).size).toBe(supportedChartHosts.length);
    expect(supportedContentMatches).toContain('https://*.tradingview.com/chart/*');
    expect(supportedContentMatches).toContain('https://*.binance.com/*/trade/*');
    expect(supportedContentMatches).toContain('https://vergex.trade/chart*');
    expect(supportedContentMatches).not.toContain('http://*/*');
    expect(supportedContentMatches).not.toContain('https://*/*');
    expect(JSON.stringify(supportedContentMatches)).not.toContain('<all_urls>');
  });

  it('identifies unsupported domains without loading a page collector', () => {
    expect(isSupportedChartHost('https://www.tradingview.com/chart/abc')).toBe(true);
    expect(isSupportedChartHost('https://app.hyperliquid.xyz/trade/BTC')).toBe(true);
    expect(isSupportedChartHost('https://gmgn.ai/sol/token/example')).toBe(false);
    expect(isSupportedChartHost('not a URL')).toBe(false);
  });

  it('exposes the floating panel and its generated dependencies as dynamic HTTP(S) web resources', () => {
    const manifest = createManifest();

    expect(manifest.web_accessible_resources).toEqual([{
      resources: ['panel.html', 'chunks/*', 'assets/*'],
      matches: ['http://*/*', 'https://*/*'],
      use_dynamic_url: true,
    }]);
  });
});
