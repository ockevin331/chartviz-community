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

test('rejects deterministic Stage 1 capability gates in extension runtime code', () => {
  const cases = [
    ['cloud token or account', 'const token = "ChartViz Cloud token";'],
    ['multi-timeframe', 'const view = "multi-timeframe";'],
    ['compatibility adapter', 'class CommunityReportAdapter {}'],
    ['remote JavaScript', 'import "https://example.test/runtime.js";'],
    ['analytics', 'const analytics = {};'],
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

test('ignores raw policy phrases in strings, templates, comments, and policy regexes', () => {
  const policySource = [
    'const quoted = "Do not use exchange APIs or calculated feeds";',
    'const template = `Reject fetch, XMLHttpRequest, WebSocket, EventSource, sendBeacon, and dynamic import claims`;',
    '// fetch(endpoint), new WebSocket(url), and import("../backend/client") are prohibited',
    '/* Never call navigator.sendBeacon or window.fetch. */',
    'const prohibited = /fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|import[(]/i;',
  ].join('\n');

  assert.deepEqual(
    findForbiddenCapabilities(policySource, 'extension/src/analysis/source-policy.ts'),
    [],
  );
});

test('rejects every Stage 2 network primitive reference, construction, or call', () => {
  const cases = [
    'const latestExchangeData =\n  await\n  fetch(endpoint);',
    'const response = await globalThis.fetch(endpoint);',
    'const response = await window.fetch(endpoint);',
    'const response = await transport.fetch(endpoint);',
    'const request = fetch;\nconst response = await request(endpoint);',
    'const request = globalThis.fetch;\nconst response = await request(endpoint);',
    'const { fetch: request } = globalThis;\nconst response = await request(endpoint);',
    'const request = globalThis["fetch"];\nconst response = await request(endpoint);',
    "const Socket = window['WebSocket'];\nconst socket = new Socket(endpoint);",
    'const socket = new WebSocket(endpoint);',
    'const request = new XMLHttpRequest();',
    'const stream = new EventSource(endpoint);',
    'navigator.sendBeacon(endpoint, payload);',
    'navigator["sendBeacon"](endpoint, payload);',
    'const NativeSocket = globalThis.WebSocket;\nconst socket = new NativeSocket(endpoint);',
    'const transport = import("./future/provider-transport");',
    'const note = `policy text ${await fetch(endpoint)}`;',
  ];

  for (const source of cases) {
    assert.ok(
      findForbiddenCapabilities(source, 'extension/src/analysis/source-policy.ts').includes('network behavior'),
      `Stage 2 runtime must reject network behavior: ${source}`,
    );
  }
});

test('rejects forbidden runtime module paths independent of source naming', () => {
  const files = [
    'extension/src/cloud/client.ts',
    'extension/src/backend/client.ts',
    'extension/src/features/server/runtime.ts',
    'extension/src/history/store.ts',
    'extension/src/services/chart-history.ts',
    'extension/src/news/search.ts',
    'extension/src/services/runtime-news-client.ts',
    'extension/src/data/exchange-api.ts',
    'extension/src/data/runtime_exchange_api_client.ts',
    'extension/src/models/local_model/runner.ts',
    'extension/src/models/embedded-local-model.ts',
    'extension/src/compatibility/adapter.ts',
    'extension/src/analytics/client.ts',
    'extension/src/providers/openai/transport.ts',
    'extension/src/storage/session.ts',
    'extension/src/capture/service.ts',
    'extension/src/annotations/renderer.ts',
    'extension\\src\\features\\news-feed\\runtime.ts',
  ];

  for (const file of files) {
    assert.ok(
      findForbiddenCapabilities('export const value = 1;', file).includes('forbidden module/import'),
      `Stage 2 runtime path must be rejected: ${file}`,
    );
  }
});

test('rejects static imports and re-exports from forbidden runtime modules', () => {
  const sources = [
    'import { client } from "../backend/client";',
    'import "../news/search";',
    'import {\n  loadHistory,\n} from "../../history/store.js";',
    'import { history } from "../services/chart-history";',
    'import { news } from "../services/runtime-news-client";',
    'export { analyze } from "@/exchange-api/client";',
    'export { analyze } from "@/services/runtime_exchange_api_client";',
    'export type { LocalModel } from "../local_model/runtime";',
    'export type { LocalModel } from "../models/embedded-local-model";',
    'import analytics from "@chartviz/analytics/client";',
    'import { transport } from "../providers/openai/transport";',
    'const store = require("../storage/session");',
    'import { capture } from "../capture/service";',
    'import { render } from "../annotations/renderer";',
  ];

  for (const source of sources) {
    assert.ok(
      findForbiddenCapabilities(source, 'extension/src/analysis/community-report.ts').includes('forbidden module/import'),
      `Stage 2 import boundary must reject: ${source}`,
    );
  }
});

test('allows non-network identifiers and non-executable policy or module text', () => {
  const allowed = [
    'const latestExchangeData = cachedValue;',
    'const cached_market_feed = snapshot;',
    'const normalizedExternalFeed = localFixture;',
    'const liveBinanceDataSnapshot = screenshotLabel;',
    'const latestData = value; const marketLabel = label; const exchangeName = visibleName;',
    'function fetchExternalData() { return cachedValue; }',
    'const moduleExample = "import ../backend/client and ../news/search";',
    'const architecture = `backend history exchange-api local-model compatibility analytics`;',
    '// import "../providers/openai/transport"; fetch(endpoint);',
    'const modulePattern = /import.*backend|fetch\(endpoint\)/;',
    'import type { CommunityReport } from "../analysis/community-report";',
  ];

  for (const source of allowed) {
    assert.deepEqual(findForbiddenCapabilities(
      source,
      'extension/src/analysis/source-policy.ts',
    ), [], `non-network source must remain allowed: ${source}`);
  }
});

test('retains legacy symbol stage gates while network behavior is structural', () => {

  const prohibitedInsideApprovedFiles = [
    ['extension/src/analysis/community-report.ts', 'class VisionProvider {}', 'provider behavior'],
    ['extension/src/analysis/community-report.ts', 'type AnalysisReport = {}', 'report behavior'],
    ['extension/src/analysis/community-report.ts', 'class CommunityReportAdapter {}', 'compatibility adapter'],
    ['extension/src/analysis/source-policy.ts', 'async function fetchExternalData() { return fetch(endpoint); }', 'network behavior'],
    ['extension/src/analysis/source-policy.ts', 'fetch("https://api.binance.com/api/v3/ticker/price")', 'network behavior'],
    ['extension/src/analysis/community-prompt.ts', 'function captureVisibleTab() {}', 'capture behavior'],
    ['extension/src/analysis/community-prompt.ts', 'function renderAnnotations() {}', 'annotation behavior'],
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
