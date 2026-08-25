import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const trackedFiles = () => execFileSync('git', ['ls-files'], { cwd: repositoryRoot, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const forbiddenSourcePatterns = [
  /chartviz\s*cloud/i,
  /multi[-\s]?timeframe/i,
  /news[-\s]?search/i,
];

test('contains the Stage 1 extension configuration without legacy product directories', () => {
  assert.equal(existsSync(path.join(repositoryRoot, 'extension', 'package.json')), true);
  assert.equal(existsSync(path.join(repositoryRoot, 'extension', 'wxt.config.ts')), true);
  assert.equal(existsSync(path.join(repositoryRoot, 'server')), false);
  assert.equal(existsSync(path.join(repositoryRoot, 'compose.yaml')), false);
  assert.equal(existsSync(path.join(repositoryRoot, 'extension', 'src', 'api')), false);
});

test('runtime source excludes forbidden product behavior', () => {
  for (const file of trackedFiles().filter((candidate) => candidate.startsWith('extension/entrypoints/') || candidate === 'extension/wxt.config.ts')) {
    const source = readFileSync(path.join(repositoryRoot, file), 'utf8');
    for (const pattern of forbiddenSourcePatterns) {
      assert.equal(pattern.test(source), false, `${file} must not contain ${pattern}`);
    }
  }
});
