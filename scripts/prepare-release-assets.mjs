#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const tag = readOption('--tag');
const githubOutput = readOption('--github-output');
const dryRun = process.argv.includes('--dry-run');

if (!tag) {
  throw new Error('Missing required --tag value.');
}

const packageJson = JSON.parse(readFileSync(path.join(root, 'extension', 'package.json'), 'utf8'));
const version = packageJson.version;
const expectedTag = `v${version}`;

if (tag !== expectedTag) {
  throw new Error(`Tag ${tag} does not match extension version ${version}.`);
}

const metadata = {
  version,
  tag,
  assets: [
    `chartviz-extension-v${version}-chrome.zip`,
    `chartviz-extension-v${version}-edge.zip`,
  ],
};

if (githubOutput) {
  const lines = [
    `version=${version}`,
    `chrome_source=extension/.output/${packageJson.name}-${version}-chrome.zip`,
    `edge_source=extension/.output/${packageJson.name}-${version}-edge.zip`,
    `chrome_asset=${metadata.assets[0]}`,
    `edge_asset=${metadata.assets[1]}`,
    '',
  ];
  appendFileSync(githubOutput, lines.join('\n'));
}

if (dryRun || !githubOutput) {
  process.stdout.write(`${JSON.stringify(metadata)}\n`);
}
