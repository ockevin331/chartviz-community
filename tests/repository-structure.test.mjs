import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Community repository contains only the extension product root', () => {
  assert.equal(existsSync(path.join(root, 'extension', 'package.json')), true);
  assert.equal(existsSync(path.join(root, 'extension', 'wxt.config.ts')), true);
  assert.equal(existsSync(path.join(root, 'server')), false);
  assert.equal(existsSync(path.join(root, 'compose.yaml')), false);
});
