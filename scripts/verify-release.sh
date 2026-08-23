#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/verify-release.sh [--container]

Runs the complete ChartViz Community public-tree audit, tests, TypeScript
compile, Chrome/Edge extension builds, generated-metadata comparison, and
optionally the Community server container build.
EOF
}

build_container=false
case "${1:-}" in
  "") ;;
  --container) build_container=true ;;
  --help|-h) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$project_root"

uv run --python 3.12 python scripts/audit_community_release.py .

pnpm install --frozen-lockfile
pnpm exec wxt prepare
pnpm test
pnpm compile
pnpm build
pnpm build:edge

chrome_artifact=$(find dist/chrome -mindepth 1 -maxdepth 1 -type d -name '*community' -print -quit)
edge_artifact=$(find dist/edge -mindepth 1 -maxdepth 1 -type d -name '*community' -print -quit)
test -n "$chrome_artifact"
test -n "$edge_artifact"
node scripts/check-community-extension-artifact.mjs "$chrome_artifact" "$edge_artifact"

uv run --project services/community/core --extra test pytest services/community/core/tests -q
uv run --project services/community --extra test pytest services/community/tests -q

metadata_dir=$(mktemp -d "${TMPDIR:-/tmp}/chartviz-community-metadata.XXXXXX")
test -d "$metadata_dir"
test ! -L "$metadata_dir"
uv run --project services/community python scripts/generate_community_openapi.py \
  --output "$metadata_dir/openapi-v1.json"
uv run --project services/community python scripts/generate_community_license_inventory.py \
  --repo "$project_root" \
  --output "$metadata_dir/THIRD_PARTY_LICENSES.json"
cmp api/openapi-v1.json "$metadata_dir/openapi-v1.json"
cmp THIRD_PARTY_LICENSES.json "$metadata_dir/THIRD_PARTY_LICENSES.json"

if $build_container; then
  if command -v podman >/dev/null 2>&1; then
    container_engine=podman
  elif command -v docker >/dev/null 2>&1; then
    container_engine=docker
  else
    echo "Podman or Docker is required for --container." >&2
    exit 1
  fi
  "$container_engine" build \
    -t chartviz-community:verify \
    -f services/community/Containerfile \
    services/community
fi

echo "ChartViz Community release verification passed."
