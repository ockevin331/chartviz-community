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
  { capability: 'cloud token or account', pattern: /chartviz\s*cloud|cloud\s*(?:token|account|auth)|\b(?:login|accounts?|quotas?|payments?)\b/i },
  { capability: 'server or history behavior', pattern: /\b(?:server|backend|history)\b/i },
  { capability: 'multi-timeframe', pattern: /multi[-\s]?timeframe/i },
  { capability: 'news search', pattern: /news[-\s]?(?:search|reports?)|web[-\s]?search/i, allowStage2Literals: true },
  { capability: 'exchange data', pattern: /\b(?:binance|okx|hyperliquid|ohlcv|exchange[-\s]?(?:api|data|feed)|calculated[-\s]?(?:data|feed)|external[-\s]?data)\b/i, allowStage2Literals: true },
  { capability: 'exchange data', pattern: /(?:fetch|XMLHttpRequest|WebSocket)\s*\([\s\S]{0,240}(?:binance|okx|hyperliquid|exchange|klines)|https?:\/\/[^\s'"`]*(?:binance|okx|hyperliquid)[^\s'"`]*/i },
  { capability: 'local model', pattern: /local[-\s]?models?/i },
  { capability: 'compatibility adapter', pattern: /compatib(?:ility|le)[-\s]?(?:adapter|report)|legacy[-\s]?(?:adapter|report)/i },
  { capability: 'remote JavaScript', pattern: /https?:\/\/[^\s'"`]+\.js(?:[?#][^\s'"`]*)?|import\s*(?:\(|[^;]*?from\s*)['"]https?:\/\//i },
  { capability: 'analytics', pattern: /\b(?:analytics|telemetry)\b/i },
  { capability: 'report behavior', pattern: /\b(?:communityreport|analysisreport)\b/i, allowStage2Literals: true },
  { capability: 'provider behavior', pattern: /\b(?:visionprovider|providerregistry|providerconfig)\b/i },
  { capability: 'capture behavior', pattern: /\b(?:capturevisibletab|tradingviewcapture|captureservice)\b/i },
  { capability: 'annotation behavior', pattern: /\b(?:renderannotations|annotationrenderer|annotatedimage)\b/i },
];

const approvedStage2Literals = [
  {
    capability: 'report behavior',
    paths: new Set(['extension/src/analysis/community-report.ts']),
    pattern: /communityreport/gi,
  },
  {
    capability: 'exchange data',
    paths: new Set([
      'extension/src/analysis/community-prompt.ts',
      'extension/src/analysis/source-policy.ts',
    ]),
    pattern: /\b(?:binance|okx|hyperliquid|exchange[-\s]?(?:api|data|feed)s?|calculated[-\s]?(?:data|feed)s?|external[-\s]?data)\b/gi,
  },
  {
    capability: 'news search',
    paths: new Set([
      'extension/src/analysis/community-prompt.ts',
      'extension/src/analysis/source-policy.ts',
    ]),
    pattern: /news[-\s]?(?:search|reports?)|web[-\s]?search/gi,
  },
];

export function classifyRuntimeFile(file) {
  const normalized = file.replaceAll('\\', '/');
  if (!normalized.startsWith('extension/')) return false;
  if (excludedExtensionPaths.some((prefix) => normalized.startsWith(prefix))) return false;
  return runtimeExtensions.has(path.extname(normalized)) || normalized === 'extension/package.json';
}

export function findForbiddenCapabilities(source, file = '') {
  const normalizedFile = file.replaceAll('\\', '/');
  const matches = forbiddenCapabilities
    .filter(({ capability, pattern, allowStage2Literals }) => {
      const inspectedSource = allowStage2Literals
        ? approvedStage2Literals
          .filter((approval) => approval.capability === capability && approval.paths.has(normalizedFile))
          .reduce((text, approval) => text.replace(approval.pattern, ''), source)
        : source;
      return pattern.test(inspectedSource);
    })
    .map(({ capability }) => capability);
  return [...new Set(matches)];
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
