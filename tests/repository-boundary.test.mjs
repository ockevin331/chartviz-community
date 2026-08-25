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
  assert.equal(classifyRuntimeFile('extension/lib/future/runtime.cjs'), true);
  assert.equal(classifyRuntimeFile('extension/tests/fixtures/forbidden.ts'), false);
  assert.equal(classifyRuntimeFile('README.md'), false);

  for (const file of runtimeFiles) {
    const source = readFileSync(path.join(repositoryRoot, file), 'utf8');
    assert.deepEqual(findForbiddenCapabilities(source, file), [], `${file} must not contain forbidden runtime behavior`);
  }
});

test('rejects deterministic Stage 1 capability gates in extension runtime code', () => {
  const cases = [
    ['cloud token or account', 'class CloudAccount {}'],
    ['multi-timeframe', 'class MultiTimeframeController {}'],
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

test('rejects computed destructuring and reflective acquisition of network primitives', () => {
  const cases = [
    'const { ["fetch"]: request } = globalThis; request(endpoint);',
    "const { ['WebSocket']: Socket } = window; new Socket(endpoint);",
    'const { ["sendBeacon"]: beacon } = navigator; beacon(endpoint, payload);',
    'const request = Reflect.get(globalThis, "fetch"); request(endpoint);',
    "const Socket = Reflect.get(window, 'WebSocket'); new Socket(endpoint);",
    'const beacon = Reflect.get(navigator, "sendBeacon"); beacon(endpoint, payload);',
    'const request = Reflect?.get(globalThis, "fetch"); request(endpoint);',
  ];

  for (const source of cases) {
    assert.ok(
      findForbiddenCapabilities(source, 'extension/src/future/runtime.ts').includes('network behavior'),
      `network primitive acquisition must be rejected: ${source}`,
    );
  }
});

test('parses TypeScript, TSX, optional chains, dynamic imports, and template expressions structurally', () => {
  const cases = [
    ['extension/src/future/runtime.ts', 'const request: typeof fetch = fetch; request(endpoint);'],
    ['extension/src/future/runtime.tsx', 'const view = <button onClick={() => window?.fetch?.(endpoint)}>Go</button>;'],
    ['extension/src/future/runtime.ts', 'const modulePromise = import\n  ("./future-module");'],
    ['extension/src/future/runtime.ts', 'const note = `policy ${Reflect.get(globalThis, "fetch")(endpoint)}`;'],
  ];

  for (const [file, source] of cases) {
    assert.ok(
      findForbiddenCapabilities(source, file).includes('network behavior'),
      `${file} must reject structurally executable network syntax: ${source}`,
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

test('parses comment-interleaved static module syntax without textual extraction gaps', () => {
  const sources = [
    'import /* stage */ "../backend/client";',
    'import { client } /* stage */ from /* boundary */ "../backend/client";',
    'import {\n  client,\n} from // boundary\n  "../backend/client";',
    'export /* stage */ { client } from /* boundary */ "../backend/client";',
    'import /* stage */ type { Client } from /* boundary */ "../backend/client";',
    'const client = require(/* boundary */ "../backend/client");',
    'import Client = require(/* boundary */ "../backend/client");',
  ];

  for (const source of sources) {
    assert.ok(
      findForbiddenCapabilities(source, 'extension/src/future/runtime.ts').includes('forbidden module/import'),
      `comment-interleaved module syntax must be rejected: ${source}`,
    );
  }
});

test('rejects exact static module.require specifiers across equivalent AST call forms', () => {
  const sources = [
    'module.require("../backend/client");',
    'module?.require?.("../history/store");',
    'module["require"]("../news/search");',
    'module?.["require"]?.("../analytics/client");',
    'module\n  /* stage */\n  .\n  require\n  (\n    "../providers/openai/client"\n  );',
    'module /* stage */ . /* property */ require /* call */ (/* specifier */ "../storage/session");',
    'module.require(`../capture/service`);',
  ];

  for (const source of sources) {
    assert.ok(
      findForbiddenCapabilities(source, 'extension/src/future/runtime.ts').includes('forbidden module/import'),
      `static module.require specifier must be rejected: ${source}`,
    );
  }
});

test('returns a bounded syntax-error finding for malformed JS, JSX, TS, and TSX', () => {
  const cases = [
    ['extension/src/future/runtime.js', 'const broken = ;'],
    ['extension/src/future/runtime.jsx', 'const view = <button>'],
    ['extension/src/future/runtime.ts', 'interface Broken { value: ; }'],
    ['extension/src/future/runtime.ts', 'function broken(value: string { return value; }'],
    ['extension/src/future/runtime.tsx', 'const view = <button>'],
  ];

  for (const [file, source] of cases) {
    assert.deepEqual(
      findForbiddenCapabilities(source, file),
      ['syntax error'],
      `${file} must fail closed without exposing source text`,
    );
  }
});

test('accepts valid TS/TSX and ignores malformed-looking policy prose or dynamic module specifiers', () => {
  const cases = [
    ['extension/src/future/runtime.ts', 'interface Good { value: string } const good: Good = { value: "ok" };'],
    ['extension/src/future/runtime.tsx', 'const view = <button type="button">Go</button>;'],
    ['extension/src/future/runtime.jsx', 'const view = <section aria-label="chart">Ready</section>;'],
    ['extension/src/analysis/source-policy.ts', 'const note = "const broken = ; module.require(../backend/client)";'],
    ['extension/src/analysis/source-policy.ts', 'const note = `const view = <button> module.require("../history/store")`;'],
    ['extension/src/analysis/source-policy.ts', '// const broken = ; module.require("../news/search")\nconst valid = true;'],
    ['extension/src/analysis/source-policy.ts', 'const prohibited = /const broken = ;|module[.]require/;'],
    ['extension/src/future/runtime.ts', 'module.require(moduleName);'],
  ];

  for (const [file, source] of cases) {
    assert.deepEqual(
      findForbiddenCapabilities(source, file),
      [],
      `${file} valid/static-policy control must remain accepted: ${source}`,
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

test('allows Cloud and network policy prose while retaining executable Cloud stage gates', () => {
  const policySource = [
    'const note = "Never use a ChartViz Cloud token or account";',
    'const guidance = `Never use CloudAccount, fetch, or backend imports`;',
    '// Never use a ChartViz Cloud token or account.',
    '/* CloudAccount and fetch are forbidden runtime capabilities. */',
    'const prohibited = /ChartViz Cloud token|CloudAccount|fetch|backend/i;',
  ].join('\n');

  assert.deepEqual(
    findForbiddenCapabilities(policySource, 'extension/src/analysis/source-policy.ts'),
    [],
  );
  assert.ok(
    findForbiddenCapabilities('class CloudAccount {}', 'extension/src/analysis/source-policy.ts')
      .includes('cloud token or account'),
  );
});

test('limits non-JavaScript inspection to paths and static remote HTML scripts', () => {
  assert.ok(
    findForbiddenCapabilities(
      '<script src="https://example.test/runtime.js"></script>',
      'extension/entrypoints/panel/index.html',
    ).includes('remote JavaScript'),
  );
  assert.deepEqual(
    findForbiddenCapabilities(
      '<p>CloudAccount, fetch, and ../backend/client are policy prose.</p>',
      'extension/entrypoints/panel/index.html',
    ),
    [],
  );
  assert.deepEqual(
    findForbiddenCapabilities(
      '{"policy":"CloudAccount fetch ../backend/client"}',
      'extension/package.json',
    ),
    [],
  );
  assert.deepEqual(
    findForbiddenCapabilities(
      '/* CloudAccount fetch ../backend/client */ .policy::after { content: "fetch"; }',
      'extension/entrypoints/panel/style.css',
    ),
    [],
  );
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
