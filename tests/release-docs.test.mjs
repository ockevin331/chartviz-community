import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

test('release documentation describes the approved Cloud and Direct boundary', () => {
  const readme = read('README.md');
  const contributing = read('CONTRIBUTING.md');
  const security = read('SECURITY.md');

  assert.match(readme, /new installation.+ChartViz Cloud/is);
  assert.match(readme, /revocable access token/is);
  assert.match(readme, /Direct.+three sequential requests/is);
  assert.match(readme, /Context.+4h.+Setup.+1h.+Trigger.+15m/is);
  assert.doesNotMatch(readme, /accepts one uploaded image|manual upload/i);

  assert.match(contributing, /Direct.+single-timeframe/is);
  assert.match(contributing, /multi-timeframe.+Cloud/is);
  assert.doesNotMatch(contributing, /do not add.+multi-timeframe behavior/is);

  assert.match(security, /three sequential provider requests/i);
  assert.match(security, /Cloud client validates.+task.+report/is);
});

test('manual smoke checklist covers supported and unsupported page guidance', () => {
  const smoke = read('docs/manual-smoke-test.md');

  assert.match(smoke, /tradingview\.com\/chart/i);
  assert.match(smoke, /tradingview\.com\/symbols/i);
  assert.match(smoke, /gmgn\.ai/i);
  assert.match(smoke, /chartviz\.xyz/i);
  assert.match(smoke, /Chrome/i);
  assert.match(smoke, /Edge/i);
  assert.doesNotMatch(smoke, /manual upload/i);
});

test('README offers release downloads, illustrated features, and linked supported sites', () => {
  const readme = read('README.md');

  assert.match(readme, /github\.com\/ockevin331\/chartviz-community\/releases\/latest/i);
  assert.match(readme, /chartviz-extension-v1\.0\.6-chrome\.zip/i);
  assert.match(readme, /chartviz-extension-v1\.0\.6-edge\.zip/i);
  assert.match(readme, /unzip.+Developer mode.+Load unpacked/is);

  for (const image of [
    'docs/images/chartviz-analysis-overview.png',
    'docs/images/chartviz-support-resistance.png',
    'docs/images/chartviz-trade-signal.png',
  ]) {
    assert.equal(existsSync(path.join(root, image)), true, `missing README image: ${image}`);
    assert.match(readme, new RegExp(image.replaceAll('/', '\\/')));
  }

  for (const site of [
    'tradingview.com/chart',
    'binance.com/en/trade',
    'okx.com/trade-spot',
    'bybit.com/en/trade',
    'app.hyperliquid.xyz/trade',
    'coinbase.com/advanced-trade',
    'bitget.com/spot',
    'gate.com/trade',
    'kucoin.com/trade',
    'mexc.com/exchange',
    'htx.com/trade',
    'upbit.com/exchange',
    'stockpage.10jqka.com.cn',
    'vergex.trade/chart',
  ]) {
    assert.match(readme, new RegExp(site.replaceAll('.', '\\.'), 'i'));
  }
});
