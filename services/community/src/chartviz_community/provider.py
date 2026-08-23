from __future__ import annotations

import base64
import json
from typing import Protocol

import httpx
from pydantic import ValidationError

from chartviz_community_core import AnalysisReport
from .validation import ValidatedImage


class ProviderTimeout(RuntimeError):
    pass


class ProviderFailure(RuntimeError):
    pass


class ProviderResponseInvalid(RuntimeError):
    pass


class ChartAnalysisProvider(Protocol):
    async def analyze(
        self,
        image: ValidatedImage,
        context: dict,
    ) -> AnalysisReport:
        raise NotImplementedError


_SYSTEM_PROMPT = """You are ChartViz Community, an educational candlestick-chart reader.
Analyze only the evidence visible in the supplied screenshot. Explain price action, volume,
visible indicators, support and resistance, conditional long/short/wait scenarios, entry
signals, and chart patterns in plain language. Never promise profit, invent a price or time,
or treat later candles as evidence for an earlier signal. Return exactly one JSON object that
matches the supplied AnalysisReport schema. Use schemaVersion 1.3."""


class OpenAICompatibleProvider:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout_seconds: float,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._client = client

    async def analyze(
        self,
        image: ValidatedImage,
        context: dict,
    ) -> AnalysisReport:
        data_url = (
            f"data:{image.mime_type};base64,"
            + base64.b64encode(image.data).decode("ascii")
        )
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Analyze this chart using this optional user context: "
                                + json.dumps(context, ensure_ascii=False, sort_keys=True)
                            ),
                        },
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ],
            "stream": False,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "AnalysisReport",
                    "strict": True,
                    "schema": AnalysisReport.model_json_schema(),
                },
            },
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient()
        try:
            response = await client.post(
                f"{self._base_url}/chat/completions",
                headers=headers,
                json=payload,
                timeout=self._timeout_seconds,
            )
            response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise ProviderTimeout("The model provider timed out.") from exc
        except httpx.HTTPError as exc:
            raise ProviderFailure("The model provider request failed.") from exc
        finally:
            if owns_client:
                await client.aclose()

        try:
            content = response.json()["choices"][0]["message"]["content"]
            if isinstance(content, list):
                content = "".join(
                    str(item.get("text", ""))
                    for item in content
                    if isinstance(item, dict)
                )
            parsed = json.loads(content) if isinstance(content, str) else content
            return AnalysisReport.model_validate(parsed)
        except (
            KeyError,
            IndexError,
            TypeError,
            ValueError,
            ValidationError,
        ) as exc:
            raise ProviderResponseInvalid(
                "The model response did not match the ChartViz report schema."
            ) from exc
