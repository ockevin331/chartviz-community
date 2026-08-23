#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const requiredChartHosts = [
  'https://*.tradingview.com/*', 'https://*.binance.com/*',
  'https://*.okx.com/*', 'https://*.bybit.com/*',
  'https://app.hyperliquid.xyz/*', 'https://*.coinbase.com/*',
  'https://*.bitget.com/*', 'https://*.gate.com/*', 'https://*.gate.io/*',
  'https://*.kucoin.com/*', 'https://*.mexc.com/*', 'https://*.htx.com/*',
  'https://*.upbit.com/*', 'https://stockpage.10jqka.com.cn/*',
  'https://vergex.trade/*',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const artifacts = process.argv.slice(2);
assert(artifacts.length > 0, 'Pass at least one unpacked Community artifact directory.');
const packageVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version;

for (const artifact of artifacts) {
  const manifest = JSON.parse(readFileSync(resolve(artifact, 'manifest.json'), 'utf8'));
  const permissions = manifest.permissions ?? [];
  const hosts = manifest.host_permissions ?? [];
  const optionalHosts = manifest.optional_host_permissions ?? [];
  assert(manifest.name === 'ChartViz Community', `${artifact}: unexpected name`);
  assert(manifest.version === packageVersion, `${artifact}: version does not match package.json`);
  assert(!('key' in manifest), `${artifact}: development key is forbidden`);
  assert(!permissions.includes('identity'), `${artifact}: identity permission is forbidden`);
  assert(!hosts.includes('<all_urls>'), `${artifact}: <all_urls> must not be a required host`);
  assert(optionalHosts.includes('<all_urls>'), `${artifact}: optional <all_urls> permission is missing`);
  assert(!hosts.some((host) => /chartviz\.(?:xyz|octopus31\.com)/i.test(host)),
    `${artifact}: Cloud host permission is forbidden`);
  requiredChartHosts.forEach((host) => assert(hosts.includes(host), `${artifact}: missing chart host ${host}`));
  const resources = (manifest.web_accessible_resources ?? []).flatMap((entry) => entry.resources ?? []);
  assert(resources.includes('floating-panel.html'), `${artifact}: floating panel resource is missing`);
  assert(resources.includes('icons/*'), `${artifact}: icon resources are missing`);
  console.log(`${artifact}: Community manifest OK`);
}
