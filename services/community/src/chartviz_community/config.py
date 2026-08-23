from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping
from urllib.parse import urlparse


@dataclass(frozen=True)
class Settings:
    llm_base_url: str
    llm_api_key: str
    llm_model: str
    local_api_token: str
    data_dir: Path
    timeout_seconds: float = 120.0
    max_image_bytes: int = 10_000_000
    max_image_pixels: int = 24_000_000

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "Settings":
        values = os.environ if environ is None else environ

        def required(name: str) -> str:
            value = values.get(name, "").strip()
            if not value:
                raise ValueError(f"{name} is required")
            return value

        base_url = required("CHARTVIZ_LLM_BASE_URL").rstrip("/")
        parsed = urlparse(base_url)
        local_hosts = {"127.0.0.1", "localhost", "host.docker.internal"}
        if parsed.scheme != "https" and not (
            parsed.scheme == "http" and parsed.hostname in local_hosts
        ):
            raise ValueError(
                "CHARTVIZ_LLM_BASE_URL must use HTTPS or an allowed local host"
            )

        local_token = required("CHARTVIZ_LOCAL_API_TOKEN")
        if len(local_token) < 24:
            raise ValueError(
                "CHARTVIZ_LOCAL_API_TOKEN must contain at least 24 characters"
            )

        return cls(
            llm_base_url=base_url,
            llm_api_key=required("CHARTVIZ_LLM_API_KEY"),
            llm_model=required("CHARTVIZ_LLM_MODEL"),
            local_api_token=local_token,
            data_dir=Path(required("CHARTVIZ_DATA_DIR")).expanduser().resolve(),
        )
