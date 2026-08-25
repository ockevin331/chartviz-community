import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifyRuntimeFile, findForbiddenCapabilities, validateBuiltOutputs } from '../scripts/audit-lib.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const trackedFiles = () => execFileSync('git', ['ls-files'], { cwd: repositoryRoot, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

test('contains the Stage 1 extension configuration without legacy product directories', () => {
  assert.equal(existsSync(path.join(repositoryRoot, 'extension', 'package.json')), true);
  assert.equal(existsSync(path.join(repositoryRoot, 'extension', 'wxt.config.ts')), true);
  assert.equal(existsSync(path.join(repositoryRoot, 'server')), false);
  assert.equal(existsSync(path.join(repositoryRoot, 'compose.yaml')), false);
  assert.equal(existsSync(path.join(repositoryRoot, 'extension', 'src', 'api')), false);
});

test('recursively scans every tracked extension runtime or config file', () => {
  const runtimeFiles = trackedFiles().filter(classifyRuntimeFile);

  assert.ok(runtimeFiles.includes('extension/entrypoints/panel/App.tsx'));
  assert.equal(classifyRuntimeFile('extension/src/future/runtime.ts'), true);
  assert.equal(classifyRuntimeFile('extension/lib/future/runtime.ts'), true);
  assert.equal(classifyRuntimeFile('extension/tests/fixtures/forbidden.ts'), false);
  assert.equal(classifyRuntimeFile('README.md'), false);

  for (const file of runtimeFiles) {
    const source = readFileSync(path.join(repositoryRoot, file), 'utf8');
    assert.deepEqual(findForbiddenCapabilities(source), [], `${file} must not contain forbidden runtime behavior`);
  }
});

test('rejects every prohibited capability category in extension runtime code', () => {
  const cases = [
    ['cloud token or account', 'const token = "ChartViz Cloud token";'],
    ['server or history behavior', 'const endpoint = "backend history";'],
    ['multi-timeframe', 'const view = "multi-timeframe";'],
    ['news search', 'const query = "news-search";'],
    ['exchange data', 'const feed = "Binance OHLCV";'],
    ['local model', 'const model = "local model";'],
    ['compatibility adapter', 'const adapter = "compatibility adapter";'],
    ['remote JavaScript', 'import "https://example.test/runtime.js";'],
    ['analytics', 'const client = "analytics";'],
    ['report behavior', 'class CommunityReport {}'],
    ['provider behavior', 'class VisionProvider {}'],
    ['capture behavior', 'function captureVisibleTab() {}'],
    ['annotation behavior', 'function renderAnnotations() {}'],
  ];

  for (const [category, source] of cases) {
    assert.ok(findForbiddenCapabilities(source).includes(category), `${category} must be rejected`);
  }
});

test('built manifests resolve their action popup artifacts after build and audit', () => {
  const output = validateBuiltOutputs(repositoryRoot);
  assert.deepEqual(output.browsers, ['chrome-mv3', 'edge-mv3']);
  for (const browser of output.browsers) {
    const manifest = JSON.parse(readFileSync(path.join(repositoryRoot, 'extension', '.output', browser, 'manifest.json'), 'utf8'));
    assert.equal(manifest.action.default_popup, 'panel.html');
    assert.equal(existsSync(path.join(repositoryRoot, 'extension', '.output', browser, manifest.action.default_popup)), true);
  }
});
