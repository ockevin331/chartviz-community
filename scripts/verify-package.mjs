#!/usr/bin/env node

import assert from 'node:assert/strict';
import { lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const expectedPermissions = ['activeTab', 'storage', 'scripting', 'clipboardWrite'];
const expectedProviderOrigins = [
  'https://openrouter.ai/api/*',
  'https://api.openai.com/v1/*',
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
const expectedManifestKeys = [
  'action',
  'background',
  'content_scripts',
  'content_security_policy',
  'description',
  'host_permissions',
  'icons',
  'manifest_version',
  'name',
  'permissions',
  'version',
  'web_accessible_resources',
];
const allowedRootFiles = new Set(['background.js', 'manifest.json', 'panel.html']);
const allowedRootDirectories = new Set(['assets', 'chunks', 'content-scripts', 'icons']);
const forbiddenSegments = new Set([
  '.git',
  '.github',
  'backend',
  'docs',
  'node_modules',
  'release',
  'scripts',
  'server',
  'src',
  'tests',
]);

function fail(message) {
  throw new Error(message);
}

function validateEntryName(entry, { directory = false } = {}) {
  if (!entry || entry.includes('\0')) {
    fail(`Unsafe empty or NUL package entry: ${JSON.stringify(entry)}`);
  }
  if (entry.includes('\\')) {
    fail(`Unsafe non-canonical package entry uses backslashes: ${entry}`);
  }
  if (entry.startsWith('/') || /^[a-zA-Z]:\//.test(entry)) {
    fail(`Unsafe absolute package entry: ${entry}`);
  }

  const comparable = directory && entry.endsWith('/') ? entry.slice(0, -1) : entry;
  const segments = comparable.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    fail(`Unsafe traversal or non-canonical package entry: ${entry}`);
  }
  if (path.posix.normalize(comparable) !== comparable) {
    fail(`Unsafe non-canonical package entry: ${entry}`);
  }

  const lower = comparable.toLowerCase();
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  if (lower.endsWith('.map')) {
    fail(`Forbidden source map in extension artifact: ${entry}`);
  }
  if (lower.includes('.env')) {
    fail(`Forbidden environment file in extension artifact: ${entry}`);
  }
  const forbidden = lowerSegments.find((segment) => forbiddenSegments.has(segment));
  if (forbidden) {
    fail(`Forbidden repository or backend path in extension artifact: ${entry}`);
  }

  const [root, ...rest] = segments;
  if (directory) {
    if (!allowedRootDirectories.has(root.toLowerCase())) {
      fail(`Package directory is not allowed at the extension root: ${entry}`);
    }
    return comparable;
  }
  if (rest.length === 0) {
    if (!allowedRootFiles.has(comparable)) {
      fail(`Package file is not allowed at the extension root: ${entry}`);
    }
  } else if (!allowedRootDirectories.has(root.toLowerCase())) {
    fail(`Package entry is outside the extension artifact roots: ${entry}`);
  }
  return comparable;
}

function readDirectoryArtifact(sourcePath) {
  const entries = new Map();

  function visit(directory, relativeDirectory = '') {
    for (const directoryEntry of readdirSync(directory, { withFileTypes: true })) {
      const relative = relativeDirectory
        ? `${relativeDirectory}/${directoryEntry.name}`
        : directoryEntry.name;
      const absolute = path.join(directory, directoryEntry.name);
      const metadata = lstatSync(absolute);
      if (metadata.isSymbolicLink()) {
        fail(`Forbidden symbolic link in extension artifact: ${relative}`);
      }
      if (metadata.isDirectory()) {
        validateEntryName(`${relative}/`, { directory: true });
        visit(absolute, relative);
      } else if (metadata.isFile()) {
        const canonical = validateEntryName(relative);
        entries.set(canonical, { read: () => readFileSync(absolute) });
      } else {
        fail(`Forbidden non-file package entry: ${relative}`);
      }
    }
  }

  visit(sourcePath);
  return entries;
}

function findEndOfCentralDirectory(archive) {
  const minimumOffset = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  fail('Unsafe or invalid ZIP: missing end-of-central-directory record');
}

function readZipArtifact(sourcePath) {
  const archive = readFileSync(sourcePath);
  const endOffset = findEndOfCentralDirectory(archive);
  const disk = archive.readUInt16LE(endOffset + 4);
  const centralDisk = archive.readUInt16LE(endOffset + 6);
  const diskEntries = archive.readUInt16LE(endOffset + 8);
  const totalEntries = archive.readUInt16LE(endOffset + 10);
  const centralSize = archive.readUInt32LE(endOffset + 12);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    fail('Unsafe or unsupported multi-disk ZIP archive');
  }
  if (centralOffset + centralSize > endOffset) {
    fail('Unsafe or invalid ZIP central directory bounds');
  }

  const entries = new Map();
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) {
      fail('Unsafe or invalid ZIP central directory entry');
    }
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > archive.length) {
      fail('Unsafe or invalid ZIP entry bounds');
    }
    const entryName = archive.subarray(nameStart, nameEnd).toString('utf8');
    const directory = entryName.endsWith('/');
    const canonical = validateEntryName(entryName, { directory });
    offset = nameEnd + extraLength + commentLength;
    if (directory) continue;
    if ((flags & 1) !== 0) fail(`Forbidden encrypted ZIP entry: ${entryName}`);
    if (method !== 0 && method !== 8) fail(`Unsupported ZIP compression for ${entryName}`);
    if (entries.has(canonical)) fail(`Unsafe duplicate ZIP entry: ${entryName}`);

    entries.set(canonical, {
      read() {
        if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== 0x04034b50) {
          fail(`Unsafe or invalid ZIP local header for ${entryName}`);
        }
        const localFlags = archive.readUInt16LE(localOffset + 6);
        const localMethod = archive.readUInt16LE(localOffset + 8);
        const localNameLength = archive.readUInt16LE(localOffset + 26);
        const localExtraLength = archive.readUInt16LE(localOffset + 28);
        const localNameStart = localOffset + 30;
        const localNameEnd = localNameStart + localNameLength;
        const localName = archive.subarray(localNameStart, localNameEnd).toString('utf8');
        if (localName !== entryName || localFlags !== flags || localMethod !== method) {
          fail(`Unsafe mismatched ZIP headers for ${entryName}`);
        }
        const dataStart = localNameEnd + localExtraLength;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd > archive.length) fail(`Unsafe ZIP data bounds for ${entryName}`);
        const compressed = archive.subarray(dataStart, dataEnd);
        const data = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
        if (data.length !== uncompressedSize) fail(`Unsafe ZIP size mismatch for ${entryName}`);
        return data;
      },
    });
  }
  if (offset !== centralOffset + centralSize) {
    fail('Unsafe or invalid ZIP central directory size');
  }
  return entries;
}

function readArtifact(sourcePath) {
  const resolved = path.resolve(sourcePath);
  const metadata = statSync(resolved);
  if (metadata.isDirectory()) return readDirectoryArtifact(resolved);
  if (metadata.isFile()) return readZipArtifact(resolved);
  fail(`Artifact path is neither a directory nor a ZIP file: ${sourcePath}`);
}

function assertReferencedFile(entries, entry, label) {
  validateEntryName(entry);
  assert.equal(entries.has(entry), true, `${label} is missing referenced extension file ${entry}`);
}

function assertReferencedResource(entries, resource, label) {
  if (!resource.endsWith('/*')) {
    assertReferencedFile(entries, resource, label);
    return;
  }

  const directory = resource.slice(0, -1);
  validateEntryName(directory, { directory: true });
  assert.equal(
    [...entries.keys()].some((entry) => entry.startsWith(directory)),
    true,
    `${label} has no packaged files for web-accessible resource ${resource}`,
  );
}

function verifyManifest(entries, label) {
  const manifestEntry = entries.get('manifest.json');
  assert.ok(manifestEntry, `${label} is missing manifest.json`);
  const manifest = JSON.parse(manifestEntry.read().toString('utf8'));

  assert.deepEqual(
    Object.keys(manifest).sort(),
    expectedManifestKeys,
    `${label} has an unexpected capability-bearing manifest key`,
  );
  assert.equal(manifest.manifest_version, 3, `${label} must use Manifest V3`);
  assert.equal(manifest.name, 'ChartViz', `${label} has an unexpected name`);
  assert.equal(manifest.version, '1.0.14', `${label} has an unexpected version`);
  assert.deepEqual(manifest.permissions, expectedPermissions, `${label} has unexpected permissions`);
  assert.deepEqual(
    manifest.host_permissions,
    ['<all_urls>', ...expectedProviderOrigins, ...expectedCloudOrigins, ...expectedChartHosts],
    `${label} has unexpected provider, Cloud, or chart origins`,
  );
  assert.equal(manifest.optional_host_permissions, undefined, `${label} must not declare optional origins`);
  assert.equal(manifest.host_permissions.includes('<all_urls>'), true, `${label} must allow visible-tab capture after URL auto-open`);
  assert.deepEqual(
    manifest.content_scripts,
    [{ matches: expectedContentMatches, js: ['content-scripts/content.js'] }],
    `${label} has unexpected content-script scope`,
  );
  assert.deepEqual(
    manifest.content_security_policy,
    { extension_pages: expectedCsp },
    `${label} has an unexpected extension CSP`,
  );
  assert.deepEqual(manifest.action, { default_icon: expectedIcons }, `${label} has an unexpected action`);
  assert.deepEqual(manifest.icons, expectedIcons, `${label} has unexpected extension icons`);
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: ['panel.html', 'chunks/*', 'assets/*'],
    matches: ['http://*/*', 'https://*/*'],
    use_dynamic_url: true,
  }], `${label} has unexpected web-accessible origins or resources`);
  assert.deepEqual(manifest.background, { service_worker: 'background.js' }, `${label} has an unexpected background entry`);

  for (const entry of Object.values(manifest.action.default_icon)) assertReferencedFile(entries, entry, label);
  for (const entry of Object.values(manifest.icons)) assertReferencedFile(entries, entry, label);
  for (const resource of manifest.web_accessible_resources.flatMap((entry) => entry.resources)) {
    assertReferencedResource(entries, resource, label);
  }
  assertReferencedFile(entries, manifest.background.service_worker, label);
  for (const script of manifest.content_scripts.flatMap((entry) => entry.js)) {
    assertReferencedFile(entries, script, label);
  }
  return manifest;
}

export function verifyPackagePair(chromePath, edgePath) {
  if (!chromePath || !edgePath) {
    fail('Usage: node scripts/verify-package.mjs <chrome-artifact-or-zip> <edge-artifact-or-zip>');
  }
  const chromeManifest = verifyManifest(readArtifact(chromePath), 'Chrome artifact');
  const edgeManifest = verifyManifest(readArtifact(edgePath), 'Edge artifact');
  assert.deepEqual(edgeManifest, chromeManifest, 'Chrome and Edge manifests must have exact parity');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    verifyPackagePair(process.argv[2], process.argv[3]);
    process.stdout.write('Verified Chrome and Edge extension artifacts.\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Package verification failed: ${message}\n`);
    process.exitCode = 1;
  }
}
