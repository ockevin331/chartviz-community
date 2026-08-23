#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "Usage: $0 OUTPUT_DIRECTORY" >&2
  exit 2
fi

output_directory=$1
version=$(node -p "require('./package.json').version")
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "package.json contains an invalid release version" >&2
  exit 2
fi

pnpm zip
pnpm zip:edge

chrome_source="dist/chrome/chartviz-v${version}-community.zip"
edge_source="dist/edge/chartviz-v${version}-community.zip"
chrome_target="$output_directory/chartviz-community-v${version}-chrome.zip"
edge_target="$output_directory/chartviz-community-v${version}-edge.zip"

for source in "$chrome_source" "$edge_source"; do
  if [[ ! -f "$source" || -L "$source" ]]; then
    echo "Expected extension archive was not generated: $source" >&2
    exit 1
  fi
done

if [[ -L "$output_directory" ]]; then
  echo "Output directory must not be a symbolic link" >&2
  exit 1
fi
mkdir -p "$output_directory"
if [[ ! -d "$output_directory" ]]; then
  echo "Output path is not a directory: $output_directory" >&2
  exit 1
fi
for target in "$chrome_target" "$edge_target"; do
  if [[ -e "$target" || -L "$target" ]]; then
    echo "Refusing to overwrite release archive: $target" >&2
    exit 1
  fi
done

install -m 0644 "$chrome_source" "$chrome_target"
install -m 0644 "$edge_source" "$edge_target"
printf '%s\n%s\n' "$chrome_target" "$edge_target"
