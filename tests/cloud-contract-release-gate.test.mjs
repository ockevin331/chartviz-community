import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('release verification rejects Cloud contract drift before build', () => {
  const script = readFileSync(path.join(root, 'scripts', 'verify-release.sh'), 'utf8');
  const contract = script.indexOf('pnpm --dir extension contracts:check');
  const tests = script.indexOf('pnpm --dir extension test');

  assert.notEqual(contract, -1);
  assert.equal(contract < tests, true);
});
