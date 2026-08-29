import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifier = path.join(root, 'scripts', 'verify-package.mjs');
const outputRoot = path.join(root, 'extension', '.output');
const expectedPermissions = ['activeTab', 'storage', 'scripting', 'clipboardWrite'];
const expectedProviderOrigins = [
  'https://openrouter.ai/api/*',
  'https://api.openai.com/v1/*',
  'https://generativelanguage.googleapis.com/*',
];
const expectedCloudOrigins = ['https://www.chartviz.xyz/*'];
const expectedChartHosts = [
  'https://*.tradingview.com/*', 'https://*.binance.com/*', 'https://*.okx.com/*',
  'https://*.bybit.com/*', 'https://app.hyperliquid.xyz/*', 'https://*.coinbase.com/*',
  'https://*.bitget.com/*', 'https://*.gate.com/*', 'https://*.gate.io/*',
  'https://*.kucoin.com/*', 'https://*.mexc.com/*', 'https://*.htx.com/*',
  'https://*.upbit.com/*', 'https://stockpage.10jqka.com.cn/*', 'https://vergex.trade/*',
];
const expectedContentMatches = [
  'https://*.tradingview.com/chart/*', 'https://*.binance.com/*/trade/*',
  'https://*.binance.com/*/futures/*', 'https://*.binance.com/*/stocks/*',
  'https://web3.binance.com/*/token/*', 'https://*.okx.com/*', 'https://*.bybit.com/*',
  'https://app.hyperliquid.xyz/*', 'https://*.coinbase.com/*', 'https://*.bitget.com/*',
  'https://*.gate.com/*', 'https://*.gate.io/*', 'https://*.kucoin.com/*',
  'https://*.mexc.com/*', 'https://*.htx.com/*', 'https://*.upbit.com/exchange*',
  'https://stockpage.10jqka.com.cn/*', 'https://vergex.trade/chart*',
].sort();
const expectedCsp = "script-src 'self'; object-src 'self';";
const expectedIcons = {
  16: 'icons/chartviz-16.png',
  32: 'icons/chartviz-32.png',
  48: 'icons/chartviz-48.png',
  128: 'icons/chartviz-128.png',
};

function expectedManifest() {
  return {
    manifest_version: 3,
    name: 'ChartViz',
    description: 'Chart education in your browser.',
    version: '1.0.2',
    icons: expectedIcons,
    permissions: expectedPermissions,
    host_permissions: [...expectedProviderOrigins, ...expectedCloudOrigins, ...expectedChartHosts],
    action: { default_icon: expectedIcons },
    web_accessible_resources: [{
      resources: ['panel.html', 'chunks/*', 'assets/*'],
      matches: ['http://*/*', 'https://*/*'],
      use_dynamic_url: true,
    }],
    background: { service_worker: 'background.js' },
    content_scripts: [{ matches: expectedContentMatches, js: ['content-scripts/content.js'] }],
    content_security_policy: { extension_pages: expectedCsp },
  };
}

function artifactFiles(extraEntries = {}) {
  return {
    'manifest.json': `${JSON.stringify(expectedManifest())}\n`,
    'background.js': 'export {};\n',
    'content-scripts/content.js': 'export {};\n',
    'panel.html': '<!doctype html><title>ChartViz</title>\n',
    'icons/chartviz-16.png': Buffer.from([16]),
    'icons/chartviz-32.png': Buffer.from([32]),
    'icons/chartviz-48.png': Buffer.from([48]),
    'icons/chartviz-128.png': Buffer.from([128]),
    'chunks/panel.js': 'export {};\n',
    'assets/panel.css': ':root {}\n',
    ...extraEntries,
  };
}

function writeArtifact(directory, files = artifactFiles()) {
  for (const [entry, contents] of Object.entries(files)) {
    const target = path.join(directory, entry);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
}

function crc32(input) {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeStoredZip(target, files) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const [entry, contents] of Object.entries(files)) {
    const name = Buffer.from(entry);
    const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + data.length;
  }

  const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localOffset, 16);
  writeFileSync(target, Buffer.concat([...localParts, ...centralParts, end]));
}

function runVerifier(chromePath, edgePath) {
  return spawnSync(process.execPath, [verifier, chromePath, edgePath], {
    cwd: root,
    encoding: 'utf8',
  });
}

function assertManifestContract(browser) {
  const artifactRoot = path.join(outputRoot, browser);
  const manifest = JSON.parse(readFileSync(path.join(artifactRoot, 'manifest.json'), 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'ChartViz');
  assert.equal(manifest.version, '1.0.2');
  assert.deepEqual(manifest.permissions, expectedPermissions);
  assert.deepEqual(manifest.host_permissions, [
    ...expectedProviderOrigins,
    ...expectedCloudOrigins,
    ...expectedChartHosts,
  ]);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.deepEqual(manifest.content_scripts, [{ matches: expectedContentMatches, js: ['content-scripts/content.js'] }]);
  assert.deepEqual(manifest.content_security_policy, { extension_pages: expectedCsp });
  assert.deepEqual(manifest.action, { default_icon: expectedIcons });
  assert.deepEqual(manifest.icons, expectedIcons);
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: ['panel.html', 'chunks/*', 'assets/*'],
    matches: ['http://*/*', 'https://*/*'],
    use_dynamic_url: true,
  }]);

  const referencedFiles = [
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((entry) => entry.js),
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons),
    ...manifest.web_accessible_resources
      .flatMap((entry) => entry.resources)
      .filter((entry) => !entry.endsWith('/*')),
  ];
  for (const entry of referencedFiles) {
    assert.doesNotThrow(
      () => readFileSync(path.join(artifactRoot, entry)),
      `${browser} is missing referenced extension file ${entry}`,
    );
  }
  for (const resource of manifest.web_accessible_resources
    .flatMap((entry) => entry.resources)
    .filter((entry) => entry.endsWith('/*'))) {
    const directory = resource.slice(0, -2);
    assert.equal(
      readdirSync(path.join(artifactRoot, directory)).length > 0,
      true,
      `${browser} is missing packaged files for ${resource}`,
    );
  }
  return manifest;
}

test('generated Chrome and Edge manifests have the exact v1 release contract and parity', () => {
  const chrome = assertManifestContract('chrome-mv3');
  const edge = assertManifestContract('edge-mv3');
  assert.deepEqual(edge, chrome);
});

test('package verifier accepts explicit artifact directories and ZIP archives', (t) => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'chartviz-package-'));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const chromeDirectory = path.join(temporaryRoot, 'chrome-mv3');
  const edgeArchive = path.join(temporaryRoot, 'edge-mv3.zip');
  writeArtifact(chromeDirectory);
  writeStoredZip(edgeArchive, artifactFiles());

  const result = runVerifier(chromeDirectory, edgeArchive);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /verified Chrome and Edge extension artifacts/i);
});

test('package verifier rejects undeclared capability keys with external origins', (t) => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'chartviz-package-'));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const chromeArchive = path.join(temporaryRoot, 'chrome-mv3.zip');
  const edgeDirectory = path.join(temporaryRoot, 'edge-mv3');
  const broadManifest = {
    ...expectedManifest(),
    externally_connectable: { matches: ['https://undeclared.example/*'] },
  };
  const broadFiles = artifactFiles({ 'manifest.json': `${JSON.stringify(broadManifest)}\n` });
  writeStoredZip(chromeArchive, broadFiles);
  writeArtifact(edgeDirectory, broadFiles);

  const result = runVerifier(chromeArchive, edgeDirectory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /capability|manifest key|externally_connectable|origin/i);
});

const forbiddenEntries = [
  'chunks/panel.js.map',
  '.env',
  'assets/.env.production',
  'tests/package.test.js',
  'server/index.js',
  'node_modules/dependency/index.js',
  'README.md',
  '../escape.js',
  '/absolute.js',
  'C:/absolute.js',
  'chunks/../server/index.js',
  'chunks\\..\\server\\index.js',
  'extension/manifest.json',
];

for (const forbiddenEntry of forbiddenEntries) {
  test(`package verifier rejects forbidden or non-canonical entry ${JSON.stringify(forbiddenEntry)}`, (t) => {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'chartviz-package-'));
    t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
    const badArchive = path.join(temporaryRoot, 'bad.zip');
    const goodDirectory = path.join(temporaryRoot, 'edge-mv3');
    writeStoredZip(badArchive, artifactFiles({ [forbiddenEntry]: 'forbidden\n' }));
    writeArtifact(goodDirectory);

    const result = runVerifier(badArchive, goodDirectory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsafe|forbidden|not allowed|outside|canonical|absolute|traversal/i);
  });
}
