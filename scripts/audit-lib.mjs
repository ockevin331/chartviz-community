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
  { capability: 'multi-timeframe', pattern: /multi[-\s]?timeframe/i },
  { capability: 'compatibility adapter', pattern: /compatib(?:ility|le)[-\s]?(?:adapter|report)|legacy[-\s]?(?:adapter|report)|\b(?:communityreport|analysisreport)(?:adapter|adaptor)\b/i, sourceView: 'executable' },
  { capability: 'analytics', pattern: /\b(?:analytics|telemetry)\b/i, sourceView: 'executable' },
  { capability: 'report behavior', pattern: /\banalysisreport\b/i, sourceView: 'executable' },
  { capability: 'provider behavior', pattern: /\b(?:visionprovider|providerregistry|providerconfig)\b/i, sourceView: 'executable' },
  { capability: 'capture behavior', pattern: /\b(?:capturevisibletab|tradingviewcapture|captureservice)\b/i, sourceView: 'executable' },
  { capability: 'annotation behavior', pattern: /\b(?:renderannotations|annotationrenderer|annotatedimage)\b/i, sourceView: 'executable' },
];

function maskNonExecutableJavaScript(source) {
  const output = source.split('');
  const mask = (index) => {
    if (source[index] !== '\n' && source[index] !== '\r') output[index] = ' ';
  };
  const maskPair = (index) => {
    mask(index);
    if (index + 1 < source.length) mask(index + 1);
  };

  const isRegexStart = (index) => {
    let previous = index - 1;
    while (previous >= 0 && /\s/.test(source[previous])) previous -= 1;
    if (previous < 0) return true;
    if (/[[\](){},:=;!?&|+*%^~>-]/.test(source[previous])) return true;
    return /(?:^|[^\w$])(?:return|throw|case|delete|void|typeof|instanceof|in|of|yield|await)\s*$/u.test(source.slice(0, index));
  };

  const scanQuoted = (start, quote) => {
    mask(start);
    let index = start + 1;
    while (index < source.length) {
      mask(index);
      if (source[index] === '\\') {
        index += 1;
        if (index < source.length) mask(index);
      } else if (source[index] === quote) {
        return index + 1;
      }
      index += 1;
    }
    return index;
  };

  const scanLineComment = (start) => {
    maskPair(start);
    let index = start + 2;
    while (index < source.length && source[index] !== '\n') {
      mask(index);
      index += 1;
    }
    return index;
  };

  const scanBlockComment = (start) => {
    maskPair(start);
    let index = start + 2;
    while (index < source.length) {
      if (source[index] === '*' && source[index + 1] === '/') {
        maskPair(index);
        return index + 2;
      }
      mask(index);
      index += 1;
    }
    return index;
  };

  const scanRegex = (start) => {
    mask(start);
    let index = start + 1;
    let inCharacterClass = false;
    while (index < source.length) {
      mask(index);
      if (source[index] === '\\') {
        index += 1;
        if (index < source.length) mask(index);
      } else if (source[index] === '[') {
        inCharacterClass = true;
      } else if (source[index] === ']') {
        inCharacterClass = false;
      } else if (source[index] === '/' && !inCharacterClass) {
        index += 1;
        while (index < source.length && /[a-z]/i.test(source[index])) {
          mask(index);
          index += 1;
        }
        return index;
      }
      index += 1;
    }
    return index;
  };

  let scanCode;
  const scanTemplate = (start) => {
    mask(start);
    let index = start + 1;
    while (index < source.length) {
      if (source[index] === '\\') {
        maskPair(index);
        index += 2;
      } else if (source[index] === '`') {
        mask(index);
        return index + 1;
      } else if (source[index] === '$' && source[index + 1] === '{') {
        maskPair(index);
        index = scanCode(index + 2, true);
      } else {
        mask(index);
        index += 1;
      }
    }
    return index;
  };

  scanCode = (start, stopAtTemplateBrace = false) => {
    let index = start;
    let braceDepth = stopAtTemplateBrace ? 1 : 0;
    while (index < source.length) {
      const current = source[index];
      const next = source[index + 1];
      if (current === "'" || current === '"') {
        index = scanQuoted(index, current);
      } else if (current === '`') {
        index = scanTemplate(index);
      } else if (current === '/' && next === '/') {
        index = scanLineComment(index);
      } else if (current === '/' && next === '*') {
        index = scanBlockComment(index);
      } else if (current === '/' && isRegexStart(index)) {
        index = scanRegex(index);
      } else if (stopAtTemplateBrace && current === '{') {
        braceDepth += 1;
        index += 1;
      } else if (stopAtTemplateBrace && current === '}') {
        braceDepth -= 1;
        if (braceDepth === 0) {
          mask(index);
          return index + 1;
        }
        index += 1;
      } else {
        index += 1;
      }
    }
    return index;
  };

  scanCode(0);
  return output.join('');
}

// Stage 2 is network-free. Stage 3 may narrow this blanket gate only for a
// separately approved provider-transport module; manifest origins alone never grant runtime behavior.
const networkPrimitivePattern = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b|\bimport\s*\(/;
const computedNetworkMemberPattern = /\b([$A-Z_a-z][$\w]*)\s*(?:\?\.)?\[\s*(['"])(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\2\s*\]/g;
const forbiddenModuleTokens = new Set([
  'cloud',
  'backend',
  'server',
  'history',
  'news',
  'compatibility',
  'analytics',
  'telemetry',
  'provider',
  'providers',
  'storage',
  'capture',
  'annotation',
  'annotations',
  'network',
  'transport',
  'http',
  'https',
  'axios',
  'got',
  'ky',
]);
const forbiddenModuleTokenPairs = [
  ['exchange', 'api'],
  ['local', 'model'],
];

function hasNetworkBehavior(source, executableSource) {
  if (networkPrimitivePattern.test(executableSource)) return true;
  return [...source.matchAll(computedNetworkMemberPattern)].some((match) => (
    executableKeywordAt(executableSource, match.index, match[1])
  ));
}

function moduleTokens(value) {
  return value
    .replaceAll('\\', '/')
    .toLowerCase()
    .split(/[/:._-]+/)
    .filter(Boolean);
}

function hasForbiddenModuleSegment(value) {
  const tokens = moduleTokens(value);
  if (tokens.some((token) => forbiddenModuleTokens.has(token))) return true;
  return forbiddenModuleTokenPairs.some(([first, second]) => tokens.some((token, index) => (
    token === first && tokens[index + 1] === second
  )));
}

function executableKeywordAt(executableSource, index, keyword) {
  return executableSource.slice(index, index + keyword.length) === keyword;
}

function staticModuleSpecifiers(source, executableSource) {
  const specifiers = new Set();
  const patterns = [
    {
      pattern: /\b(import|export)\b[^;]{0,2000}?\bfrom\s*(['"])([^'"\r\n]+)\2/g,
      specifierGroup: 3,
    },
    {
      pattern: /\b(import)\s*(['"])([^'"\r\n]+)\2/g,
      specifierGroup: 3,
    },
    {
      pattern: /\b(require)\s*\(\s*(['"])([^'"\r\n]+)\2\s*\)/g,
      specifierGroup: 3,
    },
  ];

  for (const { pattern, specifierGroup } of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (executableKeywordAt(executableSource, match.index, match[1])) {
        specifiers.add(match[specifierGroup]);
      }
    }
  }
  return [...specifiers];
}

export function classifyRuntimeFile(file) {
  const normalized = file.replaceAll('\\', '/');
  if (!normalized.startsWith('extension/')) return false;
  if (excludedExtensionPaths.some((prefix) => normalized.startsWith(prefix))) return false;
  return runtimeExtensions.has(path.extname(normalized)) || normalized === 'extension/package.json';
}

export function findForbiddenCapabilities(source, file = '') {
  const normalizedFile = file.replaceAll('\\', '/');
  const executableSource = maskNonExecutableJavaScript(source);
  const moduleSpecifiers = staticModuleSpecifiers(source, executableSource);
  const matches = [];

  if (hasNetworkBehavior(source, executableSource)) matches.push('network behavior');
  if (hasForbiddenModuleSegment(normalizedFile)
    || moduleSpecifiers.some(hasForbiddenModuleSegment)) {
    matches.push('forbidden module/import');
  }
  if (moduleSpecifiers.some((specifier) => /^https?:\/\//i.test(specifier))) {
    matches.push('remote JavaScript');
  }

  matches.push(...forbiddenCapabilities
    .filter(({ pattern, sourceView }) => {
      const inspectedSource = sourceView === 'executable' ? executableSource : source;
      return pattern.test(inspectedSource);
    })
    .map(({ capability }) => capability));
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
