#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd -- "$script_dir/.." && pwd -P)
cd -- "$repo_root"

pnpm --dir extension install --frozen-lockfile
node --test tests/repository-structure.test.mjs
pnpm --dir extension test
pnpm --dir extension compile
pnpm --dir extension build
pnpm --dir extension build:edge
node --test tests/package-contents.test.mjs
node scripts/verify-package.mjs extension/.output/chrome-mv3 extension/.output/edge-mv3
git diff --check
