import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const extensionRequire = createRequire(new URL('../extension/package.json', import.meta.url));
const [{ API: TypeScriptApi }, { createVirtualFileSystem }, typeScriptAst] = await Promise.all([
  import(extensionRequire.resolve('typescript/unstable/sync')),
  import(extensionRequire.resolve('typescript/unstable/fs')),
  import(extensionRequire.resolve('typescript/unstable/ast')),
]);

export const approvedPermissions = ['activeTab', 'storage', 'scripting'];
export const approvedOrigins = [
  'https://openrouter.ai/api/*',
  'https://api.openai.com/v1/*',
  'https://generativelanguage.googleapis.com/*',
];

const runtimeExtensions = new Set(['.cjs', '.css', '.cts', '.html', '.js', '.json', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const scriptExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const excludedExtensionPaths = [
  'extension/tests/',
  'extension/test/',
  'extension/__tests__/',
  'extension/__fixtures__/',
  'extension/fixtures/',
];
// Stage 2 is network-free. Stage 3 may narrow this blanket gate only for a
// separately approved provider-transport module; manifest origins alone never grant runtime behavior.
const networkPrimitives = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon']);
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
const parserFileSystem = createVirtualFileSystem({});
let parserApi = null;
let parsedSourceSequence = 0;

process.once('exit', () => parserApi?.close());

function getParserApi() {
  parserApi ??= new TypeScriptApi({ cwd: '/', fs: parserFileSystem });
  return parserApi;
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

function literalText(node) {
  if (typeScriptAst.isStringLiteral(node)
    || typeScriptAst.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

function propertyNameText(node) {
  if (!node) return null;
  if (typeScriptAst.isIdentifier(node)) return node.text;
  const directLiteral = literalText(node);
  if (directLiteral !== null) return directLiteral;
  if (typeScriptAst.isComputedPropertyName(node)) return literalText(node.expression);
  return null;
}

function isReflectGet(expression) {
  if (typeScriptAst.isPropertyAccessExpression(expression)) {
    return typeScriptAst.isIdentifier(expression.expression)
      && expression.expression.text === 'Reflect'
      && expression.name.text === 'get';
  }
  if (typeScriptAst.isElementAccessExpression(expression)) {
    return typeScriptAst.isIdentifier(expression.expression)
      && expression.expression.text === 'Reflect'
      && literalText(expression.argumentExpression) === 'get';
  }
  return false;
}

function isRuntimeNetworkIdentifier(node, sourceFile) {
  if (!networkPrimitives.has(node.text)) return false;

  for (let ancestor = node.parent; ancestor && ancestor !== sourceFile; ancestor = ancestor.parent) {
    if (typeScriptAst.isTypeNode(ancestor)) return false;
  }

  const parent = node.parent;
  if (typeScriptAst.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (typeScriptAst.isBindingElement(parent)) {
    return networkPrimitives.has(propertyNameText(parent.propertyName ?? parent.name));
  }
  if (typeScriptAst.isShorthandPropertyAssignment(parent)) return true;
  if (parent.name === node) return false;
  return true;
}

function identifierWords(identifier) {
  return identifier
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function hasWordSequence(words, sequence) {
  return words.some((word, index) => sequence.every((expected, offset) => (
    words[index + offset] === expected
  )));
}

function legacyIdentifierCapabilities(identifiers) {
  const matches = new Set();
  for (const identifier of identifiers) {
    const words = identifierWords(identifier);
    const compact = words.join('');
    const hasAny = (...values) => words.some((word) => values.includes(word));

    if ((hasAny('cloud') && hasAny('token', 'account', 'auth'))
      || hasWordSequence(words, ['chart', 'viz', 'cloud'])
      || hasAny('login', 'accounts', 'quotas', 'payments')) {
      matches.add('cloud token or account');
    }
    if (hasWordSequence(words, ['multi', 'timeframe'])) matches.add('multi-timeframe');
    if (hasAny('backend', 'server', 'history')) matches.add('server or history behavior');
    if (hasAny('news') && hasAny('search', 'report', 'reports', 'feed', 'feeds')) matches.add('news search');
    if (hasWordSequence(words, ['local', 'model'])) matches.add('local model');
    if (hasAny('analytics', 'telemetry')) matches.add('analytics');
    if (compact.includes('analysisreport')) matches.add('report behavior');
    if (compact.includes('communityreportadapter')
      || compact.includes('communityreportadaptor')
      || compact.includes('analysisreportadapter')
      || compact.includes('analysisreportadaptor')
      || (hasAny('compatibility', 'compatible', 'legacy') && hasAny('adapter', 'adaptor', 'report'))) {
      matches.add('compatibility adapter');
    }
    if (compact.includes('visionprovider')
      || compact.includes('providerregistry')
      || compact.includes('providerconfig')) {
      matches.add('provider behavior');
    }
    if (compact.includes('capturevisibletab')
      || compact.includes('tradingviewcapture')
      || compact.includes('captureservice')) {
      matches.add('capture behavior');
    }
    if (compact.includes('renderannotations')
      || compact.includes('annotationrenderer')
      || compact.includes('annotatedimage')) {
      matches.add('annotation behavior');
    }
  }
  return [...matches];
}

function inspectScriptSyntax(source, file) {
  const requestedExtension = path.extname(file).toLowerCase();
  const extension = scriptExtensions.has(requestedExtension) ? requestedExtension : '.tsx';
  const virtualFile = `/__chartviz_source_audit__/runtime-${parsedSourceSequence += 1}${extension}`;
  parserFileSystem.writeFile(virtualFile, source);
  const snapshot = getParserApi().updateSnapshot({ openFiles: [virtualFile] });

  try {
    const project = snapshot.getDefaultProjectForFile(virtualFile);
    const sourceFile = project?.program.getSourceFile(virtualFile);
    if (!sourceFile) throw new Error(`Source audit parser failed to load ${file || virtualFile}`);

    const moduleSpecifiers = new Set();
    const identifiers = new Set();
    let networkBehavior = false;

    const addModuleSpecifier = (node) => {
      const specifier = literalText(node);
      if (specifier !== null) moduleSpecifiers.add(specifier);
    };

    const visit = (node) => {
      if (typeScriptAst.isIdentifier(node)) {
        identifiers.add(node.text);
        if (isRuntimeNetworkIdentifier(node, sourceFile)) networkBehavior = true;
      }

      if (typeScriptAst.isPropertyAccessExpression(node)
        && networkPrimitives.has(node.name.text)) {
        networkBehavior = true;
      }
      if (typeScriptAst.isElementAccessExpression(node)
        && networkPrimitives.has(literalText(node.argumentExpression))) {
        networkBehavior = true;
      }
      if (typeScriptAst.isBindingElement(node)
        && networkPrimitives.has(propertyNameText(node.propertyName ?? node.name))) {
        networkBehavior = true;
      }

      if (typeScriptAst.isImportDeclaration(node)
        || typeScriptAst.isExportDeclaration(node)) {
        if (node.moduleSpecifier) addModuleSpecifier(node.moduleSpecifier);
      } else if (typeScriptAst.isImportEqualsDeclaration(node)
        && typeScriptAst.isExternalModuleReference(node.moduleReference)) {
        addModuleSpecifier(node.moduleReference.expression);
      } else if (typeScriptAst.isCallExpression(node)) {
        if (node.expression.kind === typeScriptAst.SyntaxKind.ImportKeyword) {
          networkBehavior = true;
          addModuleSpecifier(node.arguments[0]);
        } else if (isReflectGet(node.expression)
          && networkPrimitives.has(literalText(node.arguments[1]))) {
          networkBehavior = true;
        } else if (typeScriptAst.isIdentifier(node.expression)
          && node.expression.text === 'require') {
          addModuleSpecifier(node.arguments[0]);
        }
      }

      node.forEachChild(visit);
    };

    visit(sourceFile);
    return {
      identifiers: [...identifiers],
      moduleSpecifiers: [...moduleSpecifiers],
      networkBehavior,
    };
  } finally {
    snapshot.dispose();
  }
}

function hasRemoteHtmlScript(source, file) {
  if (path.extname(file).toLowerCase() !== '.html') return false;
  const executableHtml = source.replace(/<!--[\s\S]*?-->/g, '');
  return /<script\b[^>]*\bsrc\s*=\s*(?:["']https?:\/\/[^"']+["']|https?:\/\/[^\s>]+)/i.test(executableHtml);
}

export function classifyRuntimeFile(file) {
  const normalized = file.replaceAll('\\', '/');
  if (!normalized.startsWith('extension/')) return false;
  if (excludedExtensionPaths.some((prefix) => normalized.startsWith(prefix))) return false;
  return runtimeExtensions.has(path.extname(normalized)) || normalized === 'extension/package.json';
}

export function findForbiddenCapabilities(source, file = '') {
  const normalizedFile = file.replaceAll('\\', '/');
  const extension = path.extname(normalizedFile).toLowerCase();
  const inspectAsScript = normalizedFile === '' || scriptExtensions.has(extension);
  const syntax = inspectAsScript
    ? inspectScriptSyntax(source, normalizedFile)
    : { identifiers: [], moduleSpecifiers: [], networkBehavior: false };
  const matches = [];

  if (syntax.networkBehavior) matches.push('network behavior');
  if (hasForbiddenModuleSegment(normalizedFile)
    || syntax.moduleSpecifiers.some(hasForbiddenModuleSegment)) {
    matches.push('forbidden module/import');
  }
  if (syntax.moduleSpecifiers.some((specifier) => /^https?:\/\//i.test(specifier))
    || hasRemoteHtmlScript(source, normalizedFile)) {
    matches.push('remote JavaScript');
  }
  matches.push(...legacyIdentifierCapabilities(syntax.identifiers));
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
