import time

from fastapi.testclient import TestClient

from chartviz_community.api import create_app
from chartviz_community.config import Settings
from factories import make_report
from test_validation import png


TOKEN = "local-token-with-32-characters-000"
AUTH_HEADER = {"Authorization": f"Bearer {TOKEN}"}


class FakeProvider:
    def __init__(self, delay: float = 0) -> None:
        self.calls = 0
        self.delay = delay

    async def analyze(self, image, context):
        if self.delay:
            import asyncio

            await asyncio.sleep(self.delay)
        self.calls += 1
        return make_report()


def settings(tmp_path) -> Settings:
    return Settings(
        llm_base_url="https://provider.test/v1",
        llm_api_key="secret-test-key",
        llm_model="test-model",
        local_api_token=TOKEN,
        data_dir=tmp_path,
        timeout_seconds=10,
        max_image_bytes=1_000_000,
        max_image_pixels=1_000_000,
    )


def test_public_routes_and_protected_model_catalog(tmp_path) -> None:
    with TestClient(create_app(settings(tmp_path), provider=FakeProvider())) as client:
        assert client.get("/health").json() == {
            "status": "ok",
            "edition": "community",
        }
        assert client.get("/v1/capabilities").json()["edition"] == "community"
        assert client.get("/v1/models").status_code == 401
        assert client.get(
            "/v1/models",
            headers=AUTH_HEADER,
        ).json() == {
            "models": [{"id": "test-model", "provider": "openai-compatible"}]
        }


def test_incorrect_bearer_tokens_have_one_safe_error_shape(tmp_path) -> None:
    with TestClient(create_app(settings(tmp_path), provider=FakeProvider())) as client:
        missing = client.get("/v1/models")
        malformed = client.get(
            "/v1/models", headers={"Authorization": "Basic something"}
        )
        incorrect = client.get(
            "/v1/models", headers={"Authorization": "Bearer incorrect-token"}
        )

    assert missing.status_code == malformed.status_code == incorrect.status_code == 401
    assert missing.json() == malformed.json() == incorrect.json()
    assert missing.headers["www-authenticate"] == "Bearer"
    assert TOKEN not in str(missing.json())


def test_analysis_api_completes_one_uploaded_chart(tmp_path) -> None:
    provider = FakeProvider()
    with TestClient(create_app(settings(tmp_path), provider=provider)) as client:
        response = client.post(
            "/v1/analyses",
            headers=AUTH_HEADER,
            files={"image": ("chart.png", png(), "image/png")},
            data={"context": '{"language":"en","timeframe":"15m"}'},
        )
        assert response.status_code == 202
        analysis_id = response.json()["requestId"]

        task = response.json()
        for _ in range(100):
            task_response = client.get(
                f"/v1/analyses/{analysis_id}", headers=AUTH_HEADER
            )
            assert task_response.status_code == 200
            task = task_response.json()
            if task["status"] in {"completed", "failed", "cancelled"}:
                break
            time.sleep(0.01)

    assert task["status"] == "completed"
    assert task["report"]["schemaVersion"] == "1.3"
    assert provider.calls == 1


def test_analysis_api_rejects_multiple_images_or_timeframes(tmp_path) -> None:
    with TestClient(create_app(settings(tmp_path), provider=FakeProvider())) as client:
        multiple_images = client.post(
            "/v1/analyses",
            headers=AUTH_HEADER,
            files=[
                ("image", ("first.png", png(), "image/png")),
                ("image", ("second.png", png(), "image/png")),
            ],
            data={"context": '{"language":"en","timeframe":"15m"}'},
        )
        multiple_timeframes = client.post(
            "/v1/analyses",
            headers=AUTH_HEADER,
            files={"image": ("chart.png", png(), "image/png")},
            data={"context": '{"language":"en","timeframes":["15m","4h"]}'},
        )

    assert multiple_images.status_code == 422
    assert multiple_images.json()["detail"]["code"] == "CV_IMAGE_INVALID"
    assert multiple_timeframes.status_code == 422


def test_analysis_api_cancels_or_requests_cancellation(tmp_path) -> None:
    with TestClient(
        create_app(settings(tmp_path), provider=FakeProvider(delay=0.2))
    ) as client:
        created = client.post(
            "/v1/analyses",
            headers=AUTH_HEADER,
            files={"image": ("chart.png", png(), "image/png")},
            data={"context": '{"language":"en","timeframe":"15m"}'},
        )
        analysis_id = created.json()["requestId"]
        cancelled = client.delete(
            f"/v1/analyses/{analysis_id}", headers=AUTH_HEADER
        )

    assert cancelled.status_code == 202
    assert cancelled.json()["status"] in {"cancel_requested", "cancelled"}
