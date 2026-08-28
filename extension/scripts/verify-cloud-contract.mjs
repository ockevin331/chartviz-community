import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleRoot = path.join(extensionRoot, 'contracts', 'extension-cloud', 'v1');
const openapiPath = path.join(bundleRoot, 'openapi.json');
const generatedPath = path.join(
  extensionRoot,
  'src',
  'cloud',
  'contracts',
  'extension-cloud-v1.generated.ts',
);

function filesBelow(directory, prefix = '') {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...filesBelow(path.join(directory, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function verifyManifest() {
  const manifest = JSON.parse(readFileSync(path.join(bundleRoot, 'manifest.json'), 'utf8'));
  const declared = Object.keys(manifest.files).sort();
  const existing = filesBelow(bundleRoot)
    .filter((entry) => entry.endsWith('.json') && entry !== 'manifest.json')
    .sort();
  if (JSON.stringify(declared) !== JSON.stringify(existing)) {
    fail(`Cloud contract manifest entries differ: ${JSON.stringify({ declared, existing })}`);
    return;
  }
  for (const relativePath of declared) {
    const actual = createHash('sha256')
      .update(readFileSync(path.join(bundleRoot, relativePath)))
      .digest('hex');
    if (actual !== manifest.files[relativePath]) {
      fail(`Cloud contract checksum mismatch: ${relativePath}`);
    }
  }
}

function verifyGeneratedTypes() {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'chartviz-cloud-contract-'));
  const temporaryOutput = path.join(temporaryRoot, 'extension-cloud-v1.generated.ts');
  try {
    const result = spawnSync(
      'pnpm',
      [
        'dlx',
        '--package=typescript@5.9.3',
        '--package=openapi-typescript@7.13.0',
        'openapi-typescript',
        openapiPath,
        '-o',
        temporaryOutput,
      ],
      { cwd: extensionRoot, encoding: 'utf8' },
    );
    if (result.status !== 0) {
      fail(result.stderr || result.stdout || 'Cloud contract type generation failed.');
      return;
    }
    if (readFileSync(temporaryOutput, 'utf8') !== readFileSync(generatedPath, 'utf8')) {
      fail('Generated Cloud contract types are stale: src/cloud/contracts/extension-cloud-v1.generated.ts');
    }
  } finally {
    const stat = lstatSync(temporaryRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Refusing to remove an invalid contract temporary directory.');
    }
    rmSync(temporaryRoot, { recursive: true });
  }
}

verifyManifest();
verifyGeneratedTypes();
