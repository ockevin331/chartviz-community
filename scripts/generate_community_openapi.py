#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
for source_root in (
    PROJECT_ROOT / "services/community/core/src",
    PROJECT_ROOT / "services/community/src",
):
    source = str(source_root)
    if source not in sys.path:
        sys.path.insert(0, source)

from chartviz_community.api import create_app  # noqa: E402
from chartviz_community.config import Settings  # noqa: E402


def build_openapi() -> dict[str, object]:
    settings = Settings(
        llm_base_url="https://example.invalid/v1",
        llm_api_key="openapi-generation-placeholder",
        llm_model="openai-compatible/example-model",
        local_api_token="openapi-generation-token-00000000",
        data_dir=Path("/tmp/chartviz-community-openapi"),
    )
    return create_app(settings).openapi()


def write_openapi(output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(build_openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate the Community OpenAPI document")
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    write_openapi(args.output)
    print(f"Wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
