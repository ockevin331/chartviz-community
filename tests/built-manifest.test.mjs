import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(root, 'extension', '.output');
const browsers = ['chrome-mv3', 'edge-mv3'];
const providerOrigins = [
  'https://openrouter.ai/api/*',
  'https://api.openai.com/v1/*',
  'https://generativelanguage.googleapis.com/*',
];
const chartHosts = [
  'https://*.tradingview.com/*', 'https://*.binance.com/*', 'https://*.okx.com/*',
  'https://*.bybit.com/*', 'https://app.hyperliquid.xyz/*', 'https://*.coinbase.com/*',
  'https://*.bitget.com/*', 'https://*.gate.com/*', 'https://*.gate.io/*',
  'https://*.kucoin.com/*', 'https://*.mexc.com/*', 'https://*.htx.com/*',
  'https://*.upbit.com/*', 'https://stockpage.10jqka.com.cn/*', 'https://vergex.trade/*',
];
const contentMatches = [
  'https://*.tradingview.com/chart/*', 'https://*.binance.com/*/trade/*',
  'https://*.binance.com/*/futures/*', 'https://*.binance.com/*/stocks/*',
  'https://web3.binance.com/*/token/*', 'https://*.okx.com/*', 'https://*.bybit.com/*',
  'https://app.hyperliquid.xyz/*', 'https://*.coinbase.com/*', 'https://*.bitget.com/*',
  'https://*.gate.com/*', 'https://*.gate.io/*', 'https://*.kucoin.com/*',
  'https://*.mexc.com/*', 'https://*.htx.com/*', 'https://*.upbit.com/exchange*',
  'https://stockpage.10jqka.com.cn/*', 'https://vergex.trade/chart*',
].sort();

for (const browser of browsers) {
  test(`${browser} built manifest has the floating-panel permission boundary`, () => {
    const browserOutputRoot = path.join(outputRoot, browser);
    const manifest = JSON.parse(readFileSync(path.join(browserOutputRoot, 'manifest.json'), 'utf8'));

    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.name, 'ChartViz');
    assert.deepEqual(manifest.permissions, ['activeTab', 'storage', 'scripting']);
    assert.deepEqual(manifest.host_permissions, [...providerOrigins, ...chartHosts]);
    assert.equal(manifest.optional_host_permissions, undefined);
    assert.deepEqual(manifest.content_scripts, [{ matches: contentMatches, js: ['content-scripts/content.js'] }]);
    assert.equal(manifest.action.default_popup, undefined);
    assert.equal(JSON.stringify(manifest).includes('<all_urls>'), false);
    assert.deepEqual(manifest.web_accessible_resources, [{
      resources: ['panel.html'],
      matches: ['http://*/*', 'https://*/*'],
      use_dynamic_url: true,
    }]);
    assert.equal(existsSync(path.join(browserOutputRoot, 'content-scripts/content.js')), true);

    for (const entry of manifest.web_accessible_resources) {
      for (const resource of entry.resources) {
        assert.equal(
          existsSync(path.join(browserOutputRoot, resource)),
          true,
          `${browser} is missing declared web-accessible resource ${resource}`,
        );
      }
    }
  });
}
