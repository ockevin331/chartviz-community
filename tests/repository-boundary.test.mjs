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
    assert.deepEqual(findForbiddenCapabilities(source, file), [], `${file} must not contain forbidden runtime behavior`);
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
    ['report behavior', 'class AnalysisReport {}'],
    ['provider behavior', 'class VisionProvider {}'],
    ['capture behavior', 'function captureVisibleTab() {}'],
    ['annotation behavior', 'function renderAnnotations() {}'],
  ];

  for (const [category, source] of cases) {
    assert.ok(findForbiddenCapabilities(source).includes(category), `${category} must be rejected`);
  }
});

test('allows legitimate Stage 2 report identifiers and source-policy literals', () => {
  assert.deepEqual(
    findForbiddenCapabilities(
      'import type { CommunityReport } from "../analysis/community-report";',
      'extension/src/ui/report.ts',
    ),
    [],
  );
  assert.deepEqual(
    findForbiddenCapabilities(
      'export const communityReportSchema = {}; export type CommunityReport = {};',
      'extension/src/analysis/community-report.ts',
    ),
    [],
  );
  assert.deepEqual(
    findForbiddenCapabilities(
      'const policy = /exchange api|binance api|calculated feed|web search|news reports/i;',
      'extension/src/analysis/source-policy.ts',
    ),
    [],
  );
  assert.deepEqual(
    findForbiddenCapabilities(
      'const instruction = "Do not use exchange APIs, calculated feeds, news search, or web search";',
      'extension/src/analysis/community-prompt.ts',
    ),
    [],
  );
});

test('rejects prohibited behavior without erasing matching tokens in approved files', () => {
  assert.ok(
    findForbiddenCapabilities(
      'const policy = "Binance API";',
      'extension/src/providers/binance.ts',
    ).includes('exchange data'),
  );

  const prohibitedInsideApprovedFiles = [
    ['extension/src/analysis/community-report.ts', 'class VisionProvider {}', 'provider behavior'],
    ['extension/src/analysis/community-report.ts', 'type AnalysisReport = {}', 'report behavior'],
    ['extension/src/analysis/community-report.ts', 'class CommunityReportAdapter {}', 'compatibility adapter'],
    ['extension/src/analysis/source-policy.ts', 'async function fetchExternalData() {}', 'exchange data'],
    ['extension/src/analysis/source-policy.ts', 'fetch("https://api.binance.com/api/v3/ticker/price")', 'exchange data'],
    ['extension/src/analysis/source-policy.ts', 'const candles = "OHLCV history";', 'exchange data'],
    ['extension/src/analysis/community-prompt.ts', 'const endpoint = "backend history";', 'server or history behavior'],
  ];

  for (const [file, source, category] of prohibitedInsideApprovedFiles) {
    assert.ok(findForbiddenCapabilities(source, file).includes(category), `${file} must still reject ${category}`);
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
