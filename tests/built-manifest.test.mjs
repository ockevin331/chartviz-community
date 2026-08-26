import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(root, 'extension', '.output');
const browsers = ['chrome-mv3', 'edge-mv3'];

for (const browser of browsers) {
  test(`${browser} built manifest has the declared Community permissions and popup`, () => {
    const browserOutputRoot = path.join(outputRoot, browser);
    const manifest = JSON.parse(readFileSync(path.join(browserOutputRoot, 'manifest.json'), 'utf8'));

    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions, ['activeTab', 'storage', 'scripting']);
    assert.deepEqual(manifest.host_permissions, [
      'https://openrouter.ai/api/*',
      'https://api.openai.com/v1/*',
      'https://generativelanguage.googleapis.com/*',
    ]);
    assert.equal(manifest.optional_host_permissions, undefined);
    assert.equal(JSON.stringify(manifest).includes('<all_urls>'), false);
    assert.equal(existsSync(path.join(browserOutputRoot, manifest.action.default_popup)), true);
  });
}
