#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
community_root="$project_root/services/community"
core_root="$community_root/core"

private_imports='from[[:space:]]+chartviz_api|import[[:space:]]+chartviz_api'
credential_patterns='BEGIN[[:space:]]+PRIVATE[[:space:]]+KEY|postgresql'
credential_patterns+='://[^[:space:]]+:[^[:space:]@]+@|redis'
credential_patterns+='://[^[:space:]]+:[^[:space:]@]+@|sk-[A-Za-z0-9_-]{20,}'
provider_key_assignments='(OPENROUTER_API_KEY|CHARTVIZ_LLM_API_KEY)[[:space:]]*=[[:space:]]*[^[:space:]#]+'
extension_key_assignments='(OPENROUTER_API_KEY|CHARTVIZ_LLM_API_KEY|CHARTVIZ_LOCAL_API_TOKEN)[[:space:]]*=[[:space:]]*[^[:space:]#]+'

if findings=$(rg -n --glob '*.py' "$private_imports" "$community_root"); then
  echo "Community boundary check found private runtime imports:" >&2
  echo "$findings" >&2
  exit 1
fi

if findings=$(rg -n --hidden --glob '!uv.lock' --glob '!.venv/**' "$credential_patterns" "$community_root"); then
  echo "Community boundary check found credential-like content:" >&2
  echo "$findings" >&2
  exit 1
fi

if findings=$(rg -n --hidden --glob '!uv.lock' --glob '!.venv/**' "$provider_key_assignments" "$community_root"); then
  echo "Community boundary check found a non-empty provider key assignment:" >&2
  echo "$findings" >&2
  exit 1
fi

if findings=$(rg -n --hidden "$extension_key_assignments" \
  "$project_root/src" "$project_root/entrypoints" \
  "$project_root/wxt.config.ts" "$project_root/.env.example"); then
  echo "Community boundary check found a populated extension credential assignment:" >&2
  echo "$findings" >&2
  exit 1
fi

uv run --project "$core_root" python -m compileall -q "$core_root/src"
uv run --project "$core_root" --extra test pytest "$core_root/tests" -q
uv run --project "$community_root" python -m compileall -q "$community_root/src"
uv run --project "$community_root" --extra test pytest "$community_root/tests" -q
