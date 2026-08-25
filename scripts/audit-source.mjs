import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const approvedPermissions = ['activeTab', 'storage', 'scripting'];
const approvedOrigins = [
  'https://openrouter.ai/api/*',
  'https://api.openai.com/v1/*',
  'https://generativelanguage.googleapis.com/*',
];
const forbiddenRuntimePatterns = [
  /chartviz\s*cloud/i,
  /multi[-\s]?timeframe/i,
  /news[-\s]?search/i,
  /\b(server|backend|history)\b/i,
];

function fail(message) {
  throw new Error(`Source audit failed: ${message}`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((file) => file.startsWith('extension/entrypoints/') || file === 'extension/wxt.config.ts');

for (const file of files) {
  const source = readFileSync(path.join(root, file), 'utf8');
  for (const pattern of forbiddenRuntimePatterns) {
    if (pattern.test(source)) fail(`${file} contains forbidden runtime behavior (${pattern})`);
  }
}

for (const browser of ['chrome-mv3', 'edge-mv3']) {
  const manifestPath = path.join(root, 'extension', '.output', browser, 'manifest.json');
  if (!existsSync(manifestPath)) fail(`missing ${browser} build manifest`);
  const manifest = readJson(manifestPath);
  if (JSON.stringify(manifest).includes('<all_urls>')) fail(`${browser} manifest contains broad host access`);
  if ('optional_host_permissions' in manifest) fail(`${browser} manifest has optional host permissions`);
  if (JSON.stringify(manifest.permissions ?? []) !== JSON.stringify(approvedPermissions)) {
    fail(`${browser} manifest permissions are not the approved minimum`);
  }
  if (JSON.stringify(manifest.host_permissions ?? []) !== JSON.stringify(approvedOrigins)) {
    fail(`${browser} manifest host permissions are not the approved provider origins`);
  }
}

console.log(`Source audit passed for ${files.length} runtime files and Chrome/Edge manifests.`);
