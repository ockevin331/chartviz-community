import json

import httpx
import pytest

from chartviz_community.provider import (
    OpenAICompatibleProvider,
    ProviderFailure,
    ProviderResponseInvalid,
    ProviderTimeout,
)
from chartviz_community.validation import validate_image
from factories import make_report
from test_validation import png


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_provider_sends_one_schema_constrained_multimodal_request() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={
            "choices": [{
                "message": {
                    "content": json.dumps(make_report().model_dump(mode="json"))
                }
            }]
        })

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = OpenAICompatibleProvider(
        base_url="https://provider.test/v1",
        api_key="secret-test-key",
        model="test-model",
        timeout_seconds=10,
        client=client,
    )
    image = validate_image(png(), max_bytes=1_000_000, max_pixels=1_000_000)

    result = await provider.analyze(
        image,
        {"language": "en", "instrument": "BTCUSDT", "timeframe": "15m"},
    )

    assert result.schemaVersion == "1.3"
    assert len(requests) == 1
    request = requests[0]
    payload = json.loads(request.content)
    assert request.url == "https://provider.test/v1/chat/completions"
    assert request.headers["authorization"] == "Bearer secret-test-key"
    assert payload["model"] == "test-model"
    assert payload["messages"][1]["content"][1]["type"] == "image_url"
    assert payload["messages"][1]["content"][1]["image_url"]["url"].startswith(
        "data:image/png;base64,"
    )
    assert payload["response_format"]["type"] == "json_schema"
    await client.aclose()


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("response", "expected_error"),
    [
        (httpx.Response(503, text="secret-test-key upstream"), ProviderFailure),
        (
            httpx.Response(200, json={
                "choices": [{"message": {"content": json.dumps({})}}]
            }),
            ProviderResponseInvalid,
        ),
    ],
)
async def test_provider_maps_failures_without_leaking_the_api_key(
    response: httpx.Response,
    expected_error: type[Exception],
) -> None:
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: response)
    )
    provider = OpenAICompatibleProvider(
        base_url="https://provider.test/v1",
        api_key="secret-test-key",
        model="test-model",
        timeout_seconds=10,
        client=client,
    )

    with pytest.raises(expected_error) as caught:
        await provider.analyze(
            validate_image(png(), max_bytes=1_000_000, max_pixels=1_000_000),
            {"language": "en"},
        )

    assert "secret-test-key" not in str(caught.value)
    await client.aclose()


@pytest.mark.anyio
async def test_provider_maps_http_timeout() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("provider timed out", request=request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = OpenAICompatibleProvider(
        base_url="https://provider.test/v1",
        api_key="secret-test-key",
        model="test-model",
        timeout_seconds=10,
        client=client,
    )

    with pytest.raises(ProviderTimeout):
        await provider.analyze(
            validate_image(png(), max_bytes=1_000_000, max_pixels=1_000_000),
            {"language": "en"},
        )

    await client.aclose()
