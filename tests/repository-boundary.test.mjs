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
const withExplicitGlobalFetch = (sources) => sources.map((source) => (
  source.replaceAll('fetch(', 'globalThis.fetch(')
));

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

test('allows only the exact Stage 3 provider and session module paths and imports', () => {
  const approvedFiles = [
    ['extension/src/providers/provider-types.ts', 'export interface VisionProvider {}\nexport type ProviderConfig = {};'],
    ['extension/src/providers/provider-errors.ts', 'export class ProviderError extends Error {}'],
    ['extension/src/providers/model-catalog.ts', 'export const models = [];'],
    ['extension/src/providers/response-parser.ts', 'import type { ProviderConfig } from "./provider-types";'],
    ['extension/src/providers/provider-registry.ts', 'import type { VisionProvider } from "./provider-types";\nexport const providerRegistry = {};'],
    ['extension/src/storage/provider-session.ts', 'import type { ProviderConfig } from "../providers/provider-types";'],
  ];

  for (const [file, source] of approvedFiles) {
    assert.deepEqual(findForbiddenCapabilities(source, file), [], `approved Stage 3 module must pass: ${file}`);
  }

  const approvedConsumers = [
    'import { providerRegistry } from "../providers/provider-registry";',
    'import { loadProviderConfig } from "../storage/provider-session";',
  ];
  for (const source of approvedConsumers) {
    assert.deepEqual(
      findForbiddenCapabilities(source, 'extension/src/future/consumer.ts'),
      [],
      `exact approved Stage 3 import must pass: ${source}`,
    );
  }
});

test('permits one exact OpenRouter fetch only in the approved transport file', () => {
  const source = [
    'const openRouterUrl = "https://openrouter.ai/api/v1/chat/completions";',
    'export class OpenRouterProvider {',
    '  analyze(init) { return globalThis.fetch(openRouterUrl, init); }',
    '}',
  ].join('\n');

  assert.deepEqual(
    findForbiddenCapabilities(source, 'extension/src/providers/openrouter-provider.ts'),
    [],
  );
  assert.ok(
    findForbiddenCapabilities(source, 'extension/src/providers/openrouter-provider-copy.ts')
      .includes('network behavior'),
  );
  assert.ok(
    findForbiddenCapabilities(source, 'extension/src/future/openrouter-provider.ts')
      .includes('network behavior'),
  );

  const productionFile = 'extension/src/providers/openrouter-provider.ts';
  const productionSource = readFileSync(path.join(repositoryRoot, productionFile), 'utf8');
  assert.deepEqual(
    findForbiddenCapabilities(productionSource, productionFile),
    [],
    'the real OpenRouter transport must satisfy the same structural exception',
  );
});

test('rejects every non-approved transport mutation inside the OpenRouter file', () => {
  const file = 'extension/src/providers/openrouter-provider.ts';
  const cases = [
    'fetch(endpoint);',
    'fetch("https://evil.test/api");',
    'function send() { const openRouterUrl = "https://evil.test/api"; fetch(openRouterUrl); } const openRouterUrl = "https://openrouter.ai/api/v1/chat/completions";',
    'for (const openRouterUrl = "https://evil.test/api"; ready;) { fetch(openRouterUrl); } const openRouterUrl = "https://openrouter.ai/api/v1/chat/completions";',
    'const url = "https://openrouter.ai/api/v1/chat/completions"; fetch(url); fetch(url);',
    'new WebSocket("wss://openrouter.ai/socket");',
    'new XMLHttpRequest();',
    'new EventSource("https://openrouter.ai/api/stream");',
    'navigator.sendBeacon("https://openrouter.ai/api/track", body);',
    'import("./transport-helper");',
  ];

  for (const source of cases) {
    assert.ok(
      findForbiddenCapabilities(source, file).includes('network behavior'),
      `unapproved OpenRouter transport behavior must fail: ${source}`,
    );
  }
});

test('stops exact-origin resolution at every nearer runtime binding', () => {
  const file = 'extension/src/providers/openrouter-provider.ts';
  const approved = 'https://openrouter.ai/api/v1/chat/completions';
  const shadowedSources = withExplicitGlobalFetch([
    `const openRouterUrl = "${approved}"; function send(openRouterUrl) { fetch(openRouterUrl); }`,
    `const openRouterUrl = "${approved}"; const send = (openRouterUrl) => fetch(openRouterUrl);`,
    `const openRouterUrl = "${approved}"; function send(openRouterUrl = "${approved}") { fetch(openRouterUrl); }`,
    `const openRouterUrl = "${approved}"; function send({ openRouterUrl }) { fetch(openRouterUrl); }`,
    `const openRouterUrl = "${approved}"; function send(...openRouterUrl) { fetch(openRouterUrl); }`,
    `const openRouterUrl = "${approved}"; { let openRouterUrl = endpoint; fetch(openRouterUrl); }`,
    `const openRouterUrl = "${approved}"; function send() { fetch(openRouterUrl); var openRouterUrl = endpoint; }`,
    `const openRouterUrl = "${approved}"; function send() { if (ready) { var openRouterUrl = endpoint; } fetch(openRouterUrl); }`,
    `const openRouterUrl = "${approved}"; try { run(); } catch (openRouterUrl) { fetch(openRouterUrl); }`,
    `const openRouterUrl = "${approved}"; for (let openRouterUrl = endpoint; ready;) { fetch(openRouterUrl); }`,
    `const openRouterUrl = "${approved}"; for (const openRouterUrl in endpoints) { fetch(openRouterUrl); }`,
    `const openRouterUrl = "${approved}"; for (const openRouterUrl of endpoints) { fetch(openRouterUrl); }`,
    `const openRouterUrl = "${approved}"; { const openRouterUrl = endpoint; fetch(openRouterUrl); }`,
    'import { openRouterUrl } from "./provider-types"; fetch(openRouterUrl);',
    `const openRouterUrl = "${approved}"; { class openRouterUrl {} fetch(openRouterUrl); }`,
    `const openRouterUrl = "${approved}"; { function openRouterUrl() {} fetch(openRouterUrl); }`,
  ]);

  for (const source of shadowedSources) {
    assert.ok(
      findForbiddenCapabilities(source, file).includes('network behavior'),
      `nearer runtime binding must stop fixed-origin resolution: ${source}`,
    );
  }

  const allowedSources = withExplicitGlobalFetch([
    `const openRouterUrl = "${approved}"; fetch(openRouterUrl);`,
    `const openRouterUrl = "${approved}"; { fetch(openRouterUrl); }`,
    `const openRouterUrl = "${approved}"; try { run(); } catch (openRouterUrl) { consume(openRouterUrl); } fetch(openRouterUrl);`,
    `const openRouterUrl = "https://evil.test/api"; { const openRouterUrl = "${approved}"; fetch(openRouterUrl); }`,
  ]);
  for (const source of allowedSources) {
    assert.deepEqual(findForbiddenCapabilities(source, file), [], `provable nearest const must pass: ${source}`);
  }

  assert.ok(
    findForbiddenCapabilities(
      `const openRouterUrl = "${approved}"; { const openRouterUrl = "https://evil.test/api"; fetch(openRouterUrl); }`,
      file,
    ).includes('network behavior'),
  );
});

test('models TypeScript runtime value bindings as exact-origin shadow barriers', () => {
  const file = 'extension/src/providers/openrouter-provider.ts';
  const approved = 'https://openrouter.ai/api/v1/chat/completions';
  const shadowedSources = withExplicitGlobalFetch([
    `const u = "${approved}"; { enum u { Value } void String(u); fetch(u as unknown as string); }`,
    `const u = "${approved}"; { fetch(u as unknown as string); enum u { Value } }`,
    `const u = "${approved}"; function send() { enum u { Value } fetch(u as unknown as string); }`,
    `const u = "${approved}"; { namespace u { export function toString() { return "other"; } } fetch(u as unknown as string); }`,
    `const u = "${approved}"; { module u { export const value = 1; } fetch(u as unknown as string); }`,
    `const u = "${approved}"; { namespace u { export const first = 1; } namespace u { export const second = 2; } fetch(u as unknown as string); }`,
    `const u = "${approved}"; { enum u { Value } namespace u { export const extra = 1; } fetch(u as unknown as string); }`,
    `const u = "${approved}"; namespace u.v { export const value = 1; } fetch(u as unknown as string);`,
    `const u = "${approved}"; { using u = resource; fetch(u as unknown as string); }`,
    `const u = "${approved}"; { fetch(u as unknown as string); using u = resource; }`,
    `const u = "${approved}"; async function send() { await using u = resource; fetch(u as unknown as string); }`,
    `const u = "${approved}"; async function send() { fetch(u as unknown as string); await using u = resource; }`,
  ]);

  for (const source of shadowedSources) {
    assert.ok(
      findForbiddenCapabilities(source, file).includes('network behavior'),
      `runtime TypeScript binding must stop fixed-origin resolution: ${source}`,
    );
  }

  const exportedRuntimeSources = withExplicitGlobalFetch([
    'export enum u { Value } fetch(u as unknown as string);',
    'export namespace u { export const value = 1; } fetch(u as unknown as string);',
    'export module u { export const value = 1; } fetch(u as unknown as string);',
  ]);
  for (const source of exportedRuntimeSources) {
    assert.ok(
      findForbiddenCapabilities(source, file).includes('network behavior'),
      `exported runtime TypeScript binding must remain unapproved: ${source}`,
    );
  }
});

test('keeps using declarations lexical and type-only declarations out of runtime resolution', () => {
  const file = 'extension/src/providers/openrouter-provider.ts';
  const approved = 'https://openrouter.ai/api/v1/chat/completions';
  const allowedSources = withExplicitGlobalFetch([
    `function send() { const u = "${approved}"; { using u = resource; consume(u); } fetch(u); }`,
    `async function send() { const u = "${approved}"; { await using u = resource; consume(u); } fetch(u); }`,
    `const u = "${approved}"; { enum shadow { Value } consume(shadow); } fetch(u);`,
    `const u = "${approved}"; { namespace shadow { export const value = 1; } consume(shadow); } fetch(u);`,
    `import type { u } from "./provider-types"; const u = "${approved}"; fetch(u);`,
    `import { type u } from "./provider-types"; const u = "${approved}"; fetch(u);`,
    `import type u from "./provider-types"; const u = "${approved}"; fetch(u);`,
    `import type * as u from "./provider-types"; const u = "${approved}"; fetch(u);`,
    `import type u = require("./provider-types"); const u = "${approved}"; fetch(u);`,
    `const u = "${approved}"; interface u { value: string } fetch(u);`,
    `const u = "${approved}"; type u = string; fetch(u);`,
    `declare module "u" { export type Value = string; } const u = "${approved}"; fetch(u);`,
    `declare namespace u.v { type Value = string; } const u = "${approved}"; fetch(u);`,
    `declare enum u { Value } const u = "${approved}"; fetch(u);`,
    `declare const u: string; const u = "${approved}"; fetch(u);`,
    `declare function u(): void; const u = "${approved}"; fetch(u);`,
    `declare class u {} const u = "${approved}"; fetch(u);`,
  ]);

  for (const source of allowedSources) {
    assert.deepEqual(
      findForbiddenCapabilities(source, file),
      [],
      `type-only or disjoint lexical declaration must not shadow the approved value: ${source}`,
    );
  }
});

test('scopes runtime namespace import aliases to their enclosing module block', () => {
  const file = 'extension/src/providers/openrouter-provider.ts';
  const approved = 'https://openrouter.ai/api/v1/chat/completions';
  const shadowedSources = withExplicitGlobalFetch([
    `const u = "${approved}"; namespace inner { import u = value.path; fetch(u as unknown as string); }`,
    `const u = "${approved}"; namespace inner { fetch(u as unknown as string); import u = value.path; }`,
    `const u = "${approved}"; namespace inner { export import u = value.path; fetch(u as unknown as string); }`,
    `const u = "${approved}"; namespace inner { import u = require("./provider-types"); fetch(u as unknown as string); }`,
    `const u = "${approved}"; namespace outer { namespace inner { import u = value.path; fetch(u as unknown as string); } }`,
    `const u = "${approved}"; namespace outer.inner { import u = value.path; fetch(u as unknown as string); }`,
    `const u = "${approved}"; namespace inner { import u = value.first; fetch(u as unknown as string); } namespace inner { import u = value.second; consume(u); }`,
  ]);

  for (const source of shadowedSources) {
    assert.ok(
      findForbiddenCapabilities(source, file).includes('network behavior'),
      `namespace-local runtime import must stop fixed-origin resolution: ${source}`,
    );
  }

  const disjointSources = withExplicitGlobalFetch([
    `const u = "${approved}"; namespace inner { import u = value.path; consume(u); } fetch(u);`,
    `const u = "${approved}"; namespace inner { export import u = value.path; consume(u); } fetch(u);`,
    `const u = "${approved}"; namespace inner { import u = require("./provider-types"); consume(u); } fetch(u);`,
    `const u = "${approved}"; namespace outer { namespace inner { import u = value.path; consume(u); } fetch(u); }`,
    `const u = "${approved}"; namespace inner { import u = value.path; consume(u); } namespace inner { const other = 1; } fetch(u);`,
  ]);

  for (const source of disjointSources) {
    assert.deepEqual(
      findForbiddenCapabilities(source, file),
      [],
      `namespace-local import must not pollute an outer approved binding: ${source}`,
    );
  }

  assert.ok(
    findForbiddenCapabilities(
      'import { u } from "./provider-types"; fetch(u as unknown as string);',
      file,
    ).includes('network behavior'),
    'a top-level runtime import must remain a SourceFile binding barrier',
  );
});

test('erases ambient import bindings without weakening static module gates', () => {
  const file = 'extension/src/providers/openrouter-provider.ts';
  const approved = 'https://openrouter.ai/api/v1/chat/completions';
  const allowedSources = withExplicitGlobalFetch([
    `declare namespace ambientScope { import u = value.path; } const u = "${approved}"; fetch(u);`,
    `declare namespace ambientScope { export import u = value.path; } const u = "${approved}"; fetch(u);`,
    `declare namespace outer { namespace inner { import u = value.path; } } const u = "${approved}"; fetch(u);`,
    `declare module "pkg" { import u = require("./provider-types"); } const u = "${approved}"; fetch(u);`,
    `declare module "pkg" { import u from "./provider-types"; } const u = "${approved}"; fetch(u);`,
    `declare module "pkg" { import { value as u } from "./provider-types"; } const u = "${approved}"; fetch(u);`,
    `declare module "pkg" { import * as u from "./provider-types"; } const u = "${approved}"; fetch(u);`,
    `declare module "pkg" { import type { u } from "./provider-types"; } const u = "${approved}"; fetch(u);`,
  ]);

  for (const source of allowedSources) {
    assert.deepEqual(
      findForbiddenCapabilities(source, file),
      [],
      `ambient-erased import must not create a runtime binding: ${source}`,
    );
  }

  const forbiddenAmbientSpecifiers = [
    'declare module "pkg" { import type { Client } from "../backend/client"; }',
    'declare module "pkg" { import Client from "../backend/client"; }',
    'declare module "pkg" { import Client = require("../backend/client"); }',
  ];
  for (const source of forbiddenAmbientSpecifiers) {
    assert.ok(
      findForbiddenCapabilities(source, file).includes('forbidden module/import'),
      `ambient imports must retain the independent forbidden-specifier gate: ${source}`,
    );
  }

  assert.ok(
    findForbiddenCapabilities(
      'namespace inner { import { u from "./provider-types"; fetch(u); }',
      file,
    ).includes('syntax error'),
    'malformed nested import syntax must remain fail closed',
  );
});

test('keeps provider and storage path gates closed outside the exact Stage 3 allowlist', () => {
  const cases = [
    ['extension/src/providers/openrouter-provider-copy.ts', 'export class OpenRouterProvider {}'],
    ['extension/src/storage/provider-local.ts', 'export const store = {};'],
    ['extension/src/future/consumer.ts', 'import "../storage/provider-local";'],
  ];

  for (const [file, source] of cases) {
    assert.ok(
      findForbiddenCapabilities(source, file).includes('forbidden module/import'),
      `unapproved Stage 3 path/import must remain closed: ${file} ${source}`,
    );
  }
});

test('allows only the exact Stage 4 adapter paths with their approved endpoint shapes', () => {
  const approvedSources = [
    [
      'extension/src/providers/openai-provider.ts',
      'const endpoint = "https://api.openai.com/v1/responses"; globalThis.fetch(endpoint, init);',
    ],
    [
      'extension/src/providers/gemini-provider.ts',
      'globalThis.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, init);',
    ],
  ];
  for (const [file, source] of approvedSources) {
    assert.deepEqual(findForbiddenCapabilities(source, file), [], `${file} must allow its one exact endpoint shape`);
  }

  const productionFiles = approvedSources.map(([file]) => file);
  for (const file of productionFiles) {
    const source = readFileSync(path.join(repositoryRoot, file), 'utf8');
    assert.deepEqual(findForbiddenCapabilities(source, file), [], `${file} production source must pass the narrow exception`);
  }

  assert.deepEqual(
    findForbiddenCapabilities(
      'import { openAiProvider } from "../providers/openai-provider"; import { geminiProvider } from "../providers/gemini-provider";',
      'extension/src/future/consumer.ts',
    ),
    [],
  );
  for (const file of [
    'extension/src/providers/openai-provider-copy.ts',
    'extension/src/providers/gemini-provider-copy.ts',
    'extension/src/future/openai-provider.ts',
    'extension/src/future/gemini-provider.ts',
  ]) {
    assert.ok(
      findForbiddenCapabilities('globalThis.fetch("https://example.test", init);', file).includes('network behavior'),
      `renamed adapter path must not receive network capability: ${file}`,
    );
  }
});

test('rejects every OpenAI endpoint and transport mutation inside its approved adapter', () => {
  const file = 'extension/src/providers/openai-provider.ts';
  const cases = [
    'globalThis.fetch("https://api.openai.com/v1/chat/completions", init);',
    'globalThis.fetch("https://api.openai.com/v1/responses?key=secret", init);',
    'globalThis.fetch(config.endpoint, init);',
    'globalThis.fetch(endpoint, init);',
    'window.fetch("https://api.openai.com/v1/responses", init);',
    'transport.fetch("https://api.openai.com/v1/responses", init);',
    'const request = globalThis.fetch; request("https://api.openai.com/v1/responses", init);',
    'globalThis.fetch("https://api.openai.com/v1/responses", init); globalThis.fetch("https://api.openai.com/v1/responses", init);',
    'globalThis.fetch("https://api.openai.com/v1/responses", init); new WebSocket(socketUrl);',
    'globalThis.fetch("https://api.openai.com/v1/responses", init); import("./helper");',
  ];

  for (const source of cases) {
    assert.ok(
      findForbiddenCapabilities(source, file).includes('network behavior'),
      `OpenAI transport mutation must fail: ${source}`,
    );
  }
});

test('requires Gemini fixed template boundaries and exact model encoding', () => {
  const file = 'extension/src/providers/gemini-provider.ts';
  const cases = [
    'globalThis.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`, init);',
    'globalThis.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURI(config.model)}:generateContent`, init);',
    'globalThis.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(other.model)}:generateContent`, init);',
    'globalThis.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config["model"])}:generateContent`, init);',
    'const encodeURIComponent = (value) => value; globalThis.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, init);',
    'function send(encodeURIComponent) { globalThis.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, init); }',
    'import { encodeURIComponent } from "./provider-types"; globalThis.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, init);',
    'globalThis.fetch(`${config.origin}/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, init);',
    'globalThis.fetch(`https://evil.test/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, init);',
    'globalThis.fetch(`https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(config.model)}:generateContent`, init);',
    'globalThis.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:streamGenerateContent`, init);',
    'globalThis.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=secret`, init);',
    'const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`; globalThis.fetch(endpoint, init);',
    'window.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, init);',
    'globalThis.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, init); globalThis.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, init);',
    'globalThis.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, init); navigator.sendBeacon(beaconUrl, body);',
  ];

  for (const source of cases) {
    assert.ok(
      findForbiddenCapabilities(source, file).includes('network behavior'),
      `Gemini transport mutation must fail: ${source}`,
    );
  }
});

test('requires an unshadowed globalThis binding for every approved provider fetch', () => {
  const transports = [
    [
      'extension/src/providers/openrouter-provider.ts',
      'const endpoint = "https://openrouter.ai/api/v1/chat/completions";',
      'globalThis.fetch(endpoint, init);',
    ],
    [
      'extension/src/providers/openai-provider.ts',
      '',
      'globalThis.fetch("https://api.openai.com/v1/responses", init);',
    ],
    [
      'extension/src/providers/gemini-provider.ts',
      '',
      'globalThis.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, init);',
    ],
  ];

  for (const [file, setup, call] of transports) {
    const shadowedSources = [
      `${setup} function send(globalThis) { ${call} }`,
      `${setup} const send = (globalThis) => { ${call} };`,
      `${setup} function send(globalThis = window) { ${call} }`,
      `${setup} function send({ globalThis }) { ${call} }`,
      `${setup} function send(...globalThis) { ${call} }`,
      `${setup} { let globalThis = window; ${call} }`,
      `${setup} { ${call} let globalThis = window; }`,
      `${setup} { const globalThis = window; ${call} }`,
      `${setup} function send() { ${call} var globalThis = window; }`,
      `import { globalThis } from "./provider-types"; ${setup} ${call}`,
      `${setup} try { run(); } catch (globalThis) { ${call} }`,
      `${setup} for (const globalThis of globals) { ${call} }`,
      `${setup} { class globalThis {} ${call} }`,
      `${setup} { function globalThis() {} ${call} }`,
      `${setup} { enum globalThis { Value } ${call} }`,
      `${setup} { ${call} enum globalThis { Value } }`,
      `${setup} { namespace globalThis { export const fetch = other; } ${call} }`,
    ];
    for (const source of shadowedSources) {
      assert.ok(
        findForbiddenCapabilities(source, file).includes('network behavior'),
        `${file} must reject a shadowed globalThis fetch: ${source}`,
      );
    }
  }
});

test('rejects writes to approved global transport primitives anywhere in provider files', () => {
  const transports = [
    [
      'extension/src/providers/openrouter-provider.ts',
      'const endpoint = "https://openrouter.ai/api/v1/chat/completions"; globalThis.fetch(endpoint, init);',
    ],
    [
      'extension/src/providers/openai-provider.ts',
      'globalThis.fetch("https://api.openai.com/v1/responses", init);',
    ],
    [
      'extension/src/providers/gemini-provider.ts',
      'globalThis.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, init);',
    ],
  ];
  const fetchMutations = [
    'globalThis.fetch = replacement;',
    'globalThis["fetch"] = replacement;',
    'window.fetch = replacement;',
    'Reflect.set(globalThis, "fetch", replacement);',
    'Reflect.defineProperty(globalThis, "fetch", { value: replacement });',
    'Reflect.deleteProperty(globalThis, "fetch");',
    'Object.defineProperty(globalThis, "fetch", { value: replacement });',
    'Object.defineProperties(globalThis, { fetch: { value: replacement } });',
    'Object.assign(globalThis, { fetch: replacement });',
    'delete globalThis.fetch;',
    'globalThis.fetch++;',
    'const root = globalThis; Reflect.set(root, "fetch", replacement);',
    'const root = window; root["fetch"] = replacement;',
    'function mutate() { const root = globalThis; Object.defineProperty(root, "fetch", { value: replacement }); }',
  ];

  for (const [file, call] of transports) {
    for (const mutation of fetchMutations) {
      for (const source of [`${mutation} ${call}`, `${call} ${mutation}`]) {
        assert.ok(
          findForbiddenCapabilities(source, file).includes('network behavior'),
          `${file} must reject fetch primitive mutation: ${source}`,
        );
      }
    }
  }

  const geminiFile = 'extension/src/providers/gemini-provider.ts';
  const geminiCall = 'globalThis.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, init);';
  const encoderMutations = [
    'encodeURIComponent = replacement;',
    'globalThis.encodeURIComponent = replacement;',
    'globalThis["encodeURIComponent"] = replacement;',
    'window.encodeURIComponent = replacement;',
    'Reflect.set(globalThis, "encodeURIComponent", replacement);',
    'Reflect.defineProperty(globalThis, "encodeURIComponent", { value: replacement });',
    'Reflect.deleteProperty(globalThis, "encodeURIComponent");',
    'Object.defineProperty(window, "encodeURIComponent", { value: replacement });',
    'Object.defineProperties(globalThis, { encodeURIComponent: { value: replacement } });',
    'Object.assign(window, { encodeURIComponent: replacement });',
    'delete globalThis.encodeURIComponent;',
    'globalThis.encodeURIComponent++;',
    'const root = globalThis; Reflect.set(root, "encodeURIComponent", replacement);',
    'const root = window; root.encodeURIComponent = replacement;',
    'function mutate() { const root = globalThis; Object.defineProperty(root, "encodeURIComponent", { value: replacement }); }',
  ];
  for (const mutation of encoderMutations) {
    for (const source of [`${mutation} ${geminiCall}`, `${geminiCall} ${mutation}`]) {
      assert.ok(
        findForbiddenCapabilities(source, geminiFile).includes('network behavior'),
        `Gemini must reject encoder mutation: ${source}`,
      );
    }
  }

  assert.ok(
    findForbiddenCapabilities(
      `globalThis = fakeGlobal; ${geminiCall}`,
      geminiFile,
    ).includes('network behavior'),
    'assigning the globalThis binding itself must fail closed',
  );
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
