import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(root, 'extension', '.output');
const browsers = ['chrome-mv3', 'edge-mv3'];

for (const browser of browsers) {
  test(`${browser} built manifest has the floating-panel permission boundary`, () => {
    const browserOutputRoot = path.join(outputRoot, browser);
    const manifest = JSON.parse(readFileSync(path.join(browserOutputRoot, 'manifest.json'), 'utf8'));

    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions, ['activeTab', 'storage', 'scripting']);
    assert.equal(manifest.host_permissions, undefined);
    assert.equal(manifest.optional_host_permissions, undefined);
    assert.equal(manifest.content_scripts, undefined);
    assert.equal(manifest.action.default_popup, undefined);
    assert.equal(JSON.stringify(manifest).includes('<all_urls>'), false);
    assert.deepEqual(manifest.web_accessible_resources, [{
      resources: ['panel.html'],
      matches: ['http://*/*', 'https://*/*'],
      use_dynamic_url: true,
    }]);

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
