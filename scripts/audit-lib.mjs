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
const approvedOpenRouterTransportPath = 'extension/src/providers/openrouter-provider.ts';
const approvedStage3RuntimePaths = new Set([
  'extension/assets/provider-test-card.png?inline',
  approvedOpenRouterTransportPath,
  'extension/src/providers/model-catalog.ts',
  'extension/src/providers/provider-errors.ts',
  'extension/src/providers/provider-registry.ts',
  'extension/src/providers/provider-types.ts',
  'extension/src/providers/response-parser.ts',
  'extension/src/storage/provider-session.ts',
]);
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

function withoutScriptExtension(value) {
  return value.replace(/\.(?:c|m)?(?:j|t)sx?$/i, '');
}

function isApprovedStage3ModulePath(value) {
  const normalized = value.replaceAll('\\', '/');
  return [...approvedStage3RuntimePaths].some((approved) => (
    withoutScriptExtension(normalized) === withoutScriptExtension(approved)
  ));
}

function isApprovedStage3ModuleSpecifier(file, specifier) {
  if (!specifier.startsWith('.')) return false;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  return isApprovedStage3ModulePath(resolved);
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

function unwrapExpression(expression) {
  let current = expression;
  while (typeScriptAst.isParenthesizedExpression(current)
    || typeScriptAst.isNonNullExpression(current)
    || typeScriptAst.isAsExpression(current)
    || typeScriptAst.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

function isStaticRequireCallee(expression) {
  const callee = unwrapExpression(expression);
  if (typeScriptAst.isIdentifier(callee)) return callee.text === 'require';

  if (typeScriptAst.isPropertyAccessExpression(callee)) {
    const receiver = unwrapExpression(callee.expression);
    return typeScriptAst.isIdentifier(receiver)
      && receiver.text === 'module'
      && callee.name.text === 'require';
  }
  if (typeScriptAst.isElementAccessExpression(callee)) {
    const receiver = unwrapExpression(callee.expression);
    return typeScriptAst.isIdentifier(receiver)
      && receiver.text === 'module'
      && literalText(callee.argumentExpression) === 'require';
  }
  return false;
}

function networkPrimitiveFromExpression(expression) {
  const target = unwrapExpression(expression);
  if (typeScriptAst.isIdentifier(target) && networkPrimitives.has(target.text)) return target.text;
  if (typeScriptAst.isPropertyAccessExpression(target) && networkPrimitives.has(target.name.text)) {
    return target.name.text;
  }
  if (typeScriptAst.isElementAccessExpression(target)) {
    const property = literalText(target.argumentExpression);
    return networkPrimitives.has(property) ? property : null;
  }
  return null;
}

function isDirectNetworkCallReference(node) {
  const parent = node.parent;
  if (typeScriptAst.isCallExpression(parent) && unwrapExpression(parent.expression) === node) return true;
  if ((typeScriptAst.isPropertyAccessExpression(parent) && parent.name === node)
    || (typeScriptAst.isElementAccessExpression(parent) && parent.argumentExpression === node)) {
    return typeScriptAst.isCallExpression(parent.parent)
      && unwrapExpression(parent.parent.expression) === parent;
  }
  return false;
}

function isModuleSyntaxIdentifier(node, sourceFile) {
  for (let ancestor = node.parent; ancestor && ancestor !== sourceFile; ancestor = ancestor.parent) {
    if (typeScriptAst.isImportDeclaration(ancestor)
      || typeScriptAst.isImportEqualsDeclaration(ancestor)
      || typeScriptAst.isExportDeclaration(ancestor)) return true;
  }
  return false;
}

function isLexicalScopeNode(node) {
  return typeScriptAst.isBlock(node)
    || typeScriptAst.isModuleBlock(node)
    || typeScriptAst.isFunctionLikeDeclaration(node)
    || typeScriptAst.isCatchClause(node)
    || typeScriptAst.isClassLikeDeclaration(node)
    || node.kind === typeScriptAst.SyntaxKind.SourceFile
    || node.kind === typeScriptAst.SyntaxKind.CaseBlock
    || node.kind === typeScriptAst.SyntaxKind.ForStatement
    || node.kind === typeScriptAst.SyntaxKind.ForInStatement
    || node.kind === typeScriptAst.SyntaxKind.ForOfStatement;
}

function nearestVarScope(node) {
  for (let current = node; current; current = current.parent) {
    if (typeScriptAst.isFunctionLikeDeclaration(current)
      || current.kind === typeScriptAst.SyntaxKind.SourceFile) return current;
  }
  return null;
}

function bindingNames(name) {
  if (typeScriptAst.isIdentifier(name)) return [name.text];
  if (typeScriptAst.isObjectBindingPattern(name)
    || typeScriptAst.isArrayBindingPattern(name)) {
    return name.elements.flatMap((element) => (
      typeScriptAst.isBindingElement(element) ? bindingNames(element.name) : []
    ));
  }
  return [];
}

function nearestLexicalScope(node) {
  for (let current = node; current; current = current.parent) {
    if (isLexicalScopeNode(current)) return current;
  }
  return null;
}

function isAmbientDeclaration(node) {
  for (let current = node; current; current = current.parent) {
    if ((current.flags & typeScriptAst.NodeFlags.Ambient) !== 0) return true;
    if (current.kind === typeScriptAst.SyntaxKind.SourceFile) return false;
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
  let snapshot;

  try {
    snapshot = getParserApi().updateSnapshot({ openFiles: [virtualFile] });
    const project = snapshot.getDefaultProjectForFile(virtualFile);
    const sourceFile = project?.program.getSourceFile(virtualFile);
    if (!sourceFile) throw new Error(`Source audit parser failed to load ${file || virtualFile}`);
    const diagnostics = project.program.getSyntacticDiagnostics(virtualFile);
    if (!Array.isArray(diagnostics)) throw new Error('Source audit parser returned invalid diagnostics');
    const syntaxDiagnostics = diagnostics.map((diagnostic) => ({
      category: Number.isInteger(diagnostic.category) ? diagnostic.category : null,
      code: Number.isInteger(diagnostic.code) ? diagnostic.code : null,
      end: Number.isInteger(diagnostic.end) ? diagnostic.end : null,
      start: Number.isInteger(diagnostic.pos) ? diagnostic.pos : null,
    }));

    const moduleSpecifiers = new Set();
    const identifiers = new Set();
    const bindingsByScope = new Map();
    const networkCalls = [];
    let networkBehavior = false;
    let networkReferenceOutsideCalls = false;
    let dynamicImport = false;

    const addModuleSpecifier = (node) => {
      const specifier = literalText(node);
      if (specifier !== null) moduleSpecifiers.add(specifier);
    };

    const addBinding = (scope, name, staticText = null) => {
      if (scope === null) return;
      const bindings = bindingsByScope.get(scope) ?? new Map();
      bindings.set(name, bindings.has(name) ? null : staticText);
      bindingsByScope.set(scope, bindings);
    };

    const collectBindings = (node) => {
      if (typeScriptAst.isVariableDeclaration(node)
        && typeScriptAst.isVariableDeclarationList(node.parent)
        && !isAmbientDeclaration(node)) {
        const flags = node.parent.flags;
        const declarationKind = flags & typeScriptAst.NodeFlags.BlockScoped;
        const isConst = declarationKind === typeScriptAst.NodeFlags.Const;
        const isVar = declarationKind === typeScriptAst.NodeFlags.None;
        const scope = isVar ? nearestVarScope(node.parent) : nearestLexicalScope(node.parent);
        const staticText = isConst && typeScriptAst.isIdentifier(node.name) && node.initializer
          ? literalText(node.initializer)
          : null;
        for (const name of bindingNames(node.name)) addBinding(scope, name, staticText);
      }

      if (typeScriptAst.isFunctionLikeDeclaration(node)) {
        for (const parameter of node.parameters) {
          for (const name of bindingNames(parameter.name)) addBinding(node, name);
        }
        if (typeScriptAst.isFunctionExpression(node) && node.name) addBinding(node, node.name.text);
      }

      if (typeScriptAst.isFunctionDeclaration(node) && node.name && !isAmbientDeclaration(node)) {
        addBinding(nearestLexicalScope(node.parent), node.name.text);
      }
      if (typeScriptAst.isClassDeclaration(node) && node.name && !isAmbientDeclaration(node)) {
        addBinding(nearestLexicalScope(node.parent), node.name.text);
      }
      if (typeScriptAst.isClassExpression(node) && node.name) addBinding(node, node.name.text);

      if (typeScriptAst.isEnumDeclaration(node) && !isAmbientDeclaration(node)) {
        addBinding(nearestLexicalScope(node.parent), node.name.text);
      }
      if (typeScriptAst.isModuleDeclaration(node)
        && typeScriptAst.isIdentifier(node.name)
        && !(typeScriptAst.isModuleDeclaration(node.parent) && node.parent.body === node)
        && !isAmbientDeclaration(node)) {
        addBinding(nearestLexicalScope(node.parent), node.name.text);
      }

      if (typeScriptAst.isCatchClause(node) && node.variableDeclaration) {
        for (const name of bindingNames(node.variableDeclaration.name)) addBinding(node, name);
      }

      if (typeScriptAst.isImportDeclaration(node)
        && node.importClause
        && !node.importClause.isTypeOnly
        && !isAmbientDeclaration(node)) {
        const scope = nearestLexicalScope(node.parent);
        if (node.importClause.name) addBinding(scope, node.importClause.name.text);
        const namedBindings = node.importClause.namedBindings;
        if (namedBindings && typeScriptAst.isNamespaceImport(namedBindings)) {
          addBinding(scope, namedBindings.name.text);
        } else if (namedBindings && typeScriptAst.isNamedImports(namedBindings)) {
          for (const element of namedBindings.elements) {
            if (!element.isTypeOnly) addBinding(scope, element.name.text);
          }
        }
      }
      if (typeScriptAst.isImportEqualsDeclaration(node)
        && !node.isTypeOnly
        && !isAmbientDeclaration(node)) {
        addBinding(nearestLexicalScope(node.parent), node.name.text);
      }

      node.forEachChild(collectBindings);
    };
    collectBindings(sourceFile);

    const resolvedStaticText = (node) => {
      const direct = literalText(node);
      if (direct !== null) return direct;
      const expression = unwrapExpression(node);
      if (!typeScriptAst.isIdentifier(expression)) return null;
      for (let current = expression.parent; current; current = current.parent) {
        if (isLexicalScopeNode(current)) {
          const bindings = bindingsByScope.get(current);
          if (bindings?.has(expression.text)) return bindings.get(expression.text);
        }
      }
      return null;
    };

    const visit = (node) => {
      if (typeScriptAst.isIdentifier(node)) {
        if (!isModuleSyntaxIdentifier(node, sourceFile)) identifiers.add(node.text);
        if (isRuntimeNetworkIdentifier(node, sourceFile)) {
          networkBehavior = true;
          if (!isDirectNetworkCallReference(node)) networkReferenceOutsideCalls = true;
        }
      }

      if (typeScriptAst.isPropertyAccessExpression(node)
        && networkPrimitives.has(node.name.text)) {
        networkBehavior = true;
        if (!(typeScriptAst.isCallExpression(node.parent)
          && unwrapExpression(node.parent.expression) === node)) networkReferenceOutsideCalls = true;
      }
      if (typeScriptAst.isElementAccessExpression(node)
        && networkPrimitives.has(literalText(node.argumentExpression))) {
        networkBehavior = true;
        if (!(typeScriptAst.isCallExpression(node.parent)
          && unwrapExpression(node.parent.expression) === node)) networkReferenceOutsideCalls = true;
      }
      if (typeScriptAst.isBindingElement(node)
        && networkPrimitives.has(propertyNameText(node.propertyName ?? node.name))) {
        networkBehavior = true;
        networkReferenceOutsideCalls = true;
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
          dynamicImport = true;
          addModuleSpecifier(node.arguments[0]);
        } else if (isReflectGet(node.expression)
          && networkPrimitives.has(literalText(node.arguments[1]))) {
          networkBehavior = true;
          networkReferenceOutsideCalls = true;
        } else if (isStaticRequireCallee(node.expression)) {
          addModuleSpecifier(node.arguments[0]);
        }
        const primitive = networkPrimitiveFromExpression(node.expression);
        if (primitive !== null) {
          networkCalls.push({ primitive, target: resolvedStaticText(node.arguments[0]) });
        }
      }

      node.forEachChild(visit);
    };

    visit(sourceFile);
    return {
      identifiers: [...identifiers],
      moduleSpecifiers: [...moduleSpecifiers],
      dynamicImport,
      networkCalls,
      networkBehavior,
      networkReferenceOutsideCalls,
      syntaxDiagnostics,
    };
  } catch {
    throw new Error(`Source audit parser failed for ${file || '<inline source>'}`);
  } finally {
    snapshot?.dispose();
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
    : {
      dynamicImport: false,
      identifiers: [],
      moduleSpecifiers: [],
      networkBehavior: false,
      networkCalls: [],
      networkReferenceOutsideCalls: false,
      syntaxDiagnostics: [],
    };
  const matches = [];

  if (syntax.syntaxDiagnostics.length > 0) matches.push('syntax error');
  const approvedOpenRouterNetwork = normalizedFile === approvedOpenRouterTransportPath
    && syntax.networkBehavior
    && !syntax.dynamicImport
    && !syntax.networkReferenceOutsideCalls
    && syntax.networkCalls.length === 1
    && syntax.networkCalls[0].primitive === 'fetch'
    && syntax.networkCalls[0].target === 'https://openrouter.ai/api/v1/chat/completions';
  if (syntax.networkBehavior && !approvedOpenRouterNetwork) matches.push('network behavior');
  const forbiddenFilePath = hasForbiddenModuleSegment(normalizedFile)
    && !isApprovedStage3ModulePath(normalizedFile);
  const forbiddenSpecifier = syntax.moduleSpecifiers.some((specifier) => (
    hasForbiddenModuleSegment(specifier)
    && !isApprovedStage3ModuleSpecifier(normalizedFile, specifier)
  ));
  if (forbiddenFilePath || forbiddenSpecifier) {
    matches.push('forbidden module/import');
  }
  if (syntax.moduleSpecifiers.some((specifier) => /^https?:\/\//i.test(specifier))
    || hasRemoteHtmlScript(source, normalizedFile)) {
    matches.push('remote JavaScript');
  }
  const legacyMatches = legacyIdentifierCapabilities(syntax.identifiers).filter((category) => (
    category !== 'provider behavior' || !isApprovedStage3ModulePath(normalizedFile)
  ));
  matches.push(...legacyMatches);
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
