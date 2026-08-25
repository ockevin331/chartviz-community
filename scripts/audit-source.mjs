import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyRuntimeFile, findForbiddenCapabilities, validateBuiltOutputs } from './audit-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(classifyRuntimeFile);

for (const file of files) {
  const source = readFileSync(path.join(root, file), 'utf8');
  const capabilities = findForbiddenCapabilities(source);
  if (capabilities.length > 0) throw new Error(`Source audit failed: ${file} contains ${capabilities.join(', ')}`);
}

validateBuiltOutputs(root);

console.log(`Source audit passed for ${files.length} runtime files and Chrome/Edge manifests.`);
