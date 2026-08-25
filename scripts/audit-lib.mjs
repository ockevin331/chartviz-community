import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const approvedPermissions = ['activeTab', 'storage', 'scripting'];
export const approvedOrigins = [
  'https://openrouter.ai/api/*',
  'https://api.openai.com/v1/*',
  'https://generativelanguage.googleapis.com/*',
];

const runtimeExtensions = new Set(['.css', '.cts', '.html', '.js', '.json', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const excludedExtensionPaths = [
  'extension/tests/',
  'extension/test/',
  'extension/__tests__/',
  'extension/__fixtures__/',
  'extension/fixtures/',
];
const forbiddenCapabilities = [
  ['cloud token or account', /chartviz\s*cloud|cloud\s*(?:token|account|auth)|\b(?:login|accounts?|quotas?|payments?)\b/i],
  ['server or history behavior', /\b(?:server|backend|history)\b/i],
  ['multi-timeframe', /multi[-\s]?timeframe/i],
  ['news search', /news[-\s]?search/i],
  ['exchange data', /\b(?:binance|okx|hyperliquid|ohlcv|exchange[-\s]?data)\b/i],
  ['local model', /local[-\s]?models?/i],
  ['compatibility adapter', /compatib(?:ility|le)[-\s]?(?:adapter|report)|legacy[-\s]?(?:adapter|report)/i],
  ['remote JavaScript', /https?:\/\/[^\s'"`]+\.js(?:[?#][^\s'"`]*)?|import\s*(?:\(|[^;]*?from\s*)['"]https?:\/\//i],
  ['analytics', /\b(?:analytics|telemetry)\b/i],
  ['report behavior', /\b(?:communityreport|analysisreport)\b/i],
  ['provider behavior', /\b(?:visionprovider|providerregistry|providerconfig)\b/i],
  ['capture behavior', /\b(?:capturevisibletab|tradingviewcapture|captureservice)\b/i],
  ['annotation behavior', /\b(?:renderannotations|annotationrenderer|annotatedimage)\b/i],
];

export function classifyRuntimeFile(file) {
  const normalized = file.replaceAll('\\', '/');
  if (!normalized.startsWith('extension/')) return false;
  if (excludedExtensionPaths.some((prefix) => normalized.startsWith(prefix))) return false;
  return runtimeExtensions.has(path.extname(normalized)) || normalized === 'extension/package.json';
}

export function findForbiddenCapabilities(source) {
  return forbiddenCapabilities
    .filter(([, pattern]) => pattern.test(source))
    .map(([capability]) => capability);
}

function fail(message) {
  throw new Error(`Source audit failed: ${message}`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function validateBuiltOutputs(root) {
  const browsers = ['chrome-mv3', 'edge-mv3'];
  for (const browser of browsers) {
    const outputDirectory = path.join(root, 'extension', '.output', browser);
    const manifestPath = path.join(outputDirectory, 'manifest.json');
    if (!existsSync(manifestPath)) fail(`missing ${browser} build manifest`);
    const manifest = readJson(manifestPath);
    const popup = manifest.action?.default_popup;
    if (popup !== 'panel.html') fail(`${browser} manifest action popup must be panel.html`);
    if (!existsSync(path.join(outputDirectory, popup))) fail(`${browser} popup artifact is missing: ${popup}`);
    if (JSON.stringify(manifest).includes('<all_urls>')) fail(`${browser} manifest contains broad host access`);
    if ('optional_host_permissions' in manifest) fail(`${browser} manifest has optional host permissions`);
    if (JSON.stringify(manifest.permissions ?? []) !== JSON.stringify(approvedPermissions)) {
      fail(`${browser} manifest permissions are not the approved minimum`);
    }
    if (JSON.stringify(manifest.host_permissions ?? []) !== JSON.stringify(approvedOrigins)) {
      fail(`${browser} manifest host permissions are not the approved provider origins`);
    }
  }
  return { browsers };
}
