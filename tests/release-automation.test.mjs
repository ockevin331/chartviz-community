import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'prepare-release-assets.mjs');

function run(...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('v1.0.13 release metadata uses canonical Chrome and Edge asset names', () => {
  const result = run('--tag', 'v1.0.13', '--dry-run');

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    version: '1.0.13',
    tag: 'v1.0.13',
    assets: [
      'chartviz-extension-v1.0.13-chrome.zip',
      'chartviz-extension-v1.0.13-edge.zip',
    ],
  });
});

test('release metadata rejects a tag that differs from the extension version', () => {
  const result = run('--tag', 'v1.0.0', '--dry-run');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /tag v1\.0\.0 does not match extension version 1\.0\.13/i);
});

test('release metadata writes GitHub outputs for source and public asset names', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'chartviz-release-'));
  const output = path.join(temp, 'github-output.txt');

  try {
    const result = run('--tag', 'v1.0.13', '--github-output', output);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, 'utf8'), [
      'version=1.0.13',
      'chrome_source=extension/.output/chartviz-community-extension-1.0.13-chrome.zip',
      'edge_source=extension/.output/chartviz-community-extension-1.0.13-edge.zip',
      'chrome_asset=chartviz-extension-v1.0.13-chrome.zip',
      'edge_asset=chartviz-extension-v1.0.13-edge.zip',
      '',
    ].join('\n'));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
