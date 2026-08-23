import asyncio

import pytest

from chartviz_community.analyzer import AnalysisService
from chartviz_community.image_store import LocalImageStore
from chartviz_community.provider import (
    ProviderFailure,
    ProviderResponseInvalid,
    ProviderTimeout,
)
from chartviz_community.repository import SQLiteTaskRepository
from chartviz_community.validation import ImageValidationError, validate_image
from factories import make_report
from test_validation import png


class FakeProvider:
    def __init__(self, outcome=None) -> None:
        self.calls = 0
        self.outcome = make_report() if outcome is None else outcome

    async def analyze(self, image, context):
        self.calls += 1
        if isinstance(self.outcome, BaseException):
            raise self.outcome
        return self.outcome


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


async def build_service(tmp_path, provider: FakeProvider):
    repository = SQLiteTaskRepository(tmp_path / "community.sqlite3")
    await repository.initialize()
    return (
        AnalysisService(
            repository=repository,
            image_store=LocalImageStore(tmp_path),
            provider=provider,
            max_image_bytes=1_000_000,
            max_image_pixels=1_000_000,
        ),
        repository,
    )


@pytest.mark.anyio
async def test_analysis_service_runs_one_provider_call_and_persists_progress(
    tmp_path,
) -> None:
    provider = FakeProvider()
    service, repository = await build_service(tmp_path, provider)
    image = validate_image(png(), max_bytes=1_000_000, max_pixels=1_000_000)

    submitted = await service.submit(
        image,
        {"language": "en", "instrument": "BTCUSDT", "timeframe": "15m"},
    )
    assert submitted.status == "pending"
    assert await service.process_one() is True

    task = await repository.get(submitted.requestId)
    assert task is not None
    assert provider.calls == 1
    assert task.status == "completed"
    assert [event.code for event in task.progressEvents] == [
        "preparing",
        "reading_chart",
        "preparing_result",
    ]

    reopened = SQLiteTaskRepository(tmp_path / "community.sqlite3")
    await reopened.initialize()
    persisted = await reopened.get(submitted.requestId)
    assert persisted is not None and persisted.report == make_report()


@pytest.mark.anyio
async def test_cancelling_a_pending_task_never_calls_the_provider(tmp_path) -> None:
    provider = FakeProvider()
    service, repository = await build_service(tmp_path, provider)
    submitted = await service.submit(
        validate_image(png(), max_bytes=1_000_000, max_pixels=1_000_000),
        {"language": "en"},
    )

    cancelled = await service.cancel(submitted.requestId)

    assert cancelled.status == "cancelled"
    assert cancelled.errorCode == "CV_CANCELLED"
    assert await service.process_one() is False
    assert provider.calls == 0
    assert (await repository.get(submitted.requestId)).status == "cancelled"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("outcome", "error_code"),
    [
        (ImageValidationError("bad image"), "CV_IMAGE_INVALID"),
        (ProviderTimeout("timeout"), "CV_PROVIDER_TIMEOUT"),
        (ProviderFailure("failed"), "CV_PROVIDER_ERROR"),
        (ProviderResponseInvalid("invalid"), "CV_RESPONSE_INVALID"),
        (RuntimeError("unexpected internal detail"), "CV_INTERNAL_ERROR"),
    ],
)
async def test_analysis_service_maps_failures_to_stable_localized_errors(
    tmp_path,
    outcome: BaseException,
    error_code: str,
) -> None:
    english_provider = FakeProvider(outcome)
    english_service, english_repository = await build_service(
        tmp_path / "en", english_provider
    )
    english_task = await english_service.submit(
        validate_image(png(), max_bytes=1_000_000, max_pixels=1_000_000),
        {"language": "en"},
    )
    await english_service.process_one()

    chinese_provider = FakeProvider(outcome)
    chinese_service, chinese_repository = await build_service(
        tmp_path / "zh", chinese_provider
    )
    chinese_task = await chinese_service.submit(
        validate_image(png(), max_bytes=1_000_000, max_pixels=1_000_000),
        {"language": "zh-CN"},
    )
    await chinese_service.process_one()

    english = await english_repository.get(english_task.requestId)
    chinese = await chinese_repository.get(chinese_task.requestId)
    assert english is not None and chinese is not None
    assert english.errorCode == chinese.errorCode == error_code
    assert english.status == chinese.status == "failed"
    assert english.error and chinese.error and english.error != chinese.error
    assert "unexpected internal detail" not in english.error
    assert "unexpected internal detail" not in chinese.error


@pytest.mark.anyio
async def test_provider_cancellation_marks_the_analysis_cancelled(tmp_path) -> None:
    provider = FakeProvider(asyncio.CancelledError())
    service, repository = await build_service(tmp_path, provider)
    submitted = await service.submit(
        validate_image(png(), max_bytes=1_000_000, max_pixels=1_000_000),
        {"language": "en"},
    )

    await service.process_one()

    task = await repository.get(submitted.requestId)
    assert task is not None
    assert task.status == "cancelled"
    assert task.errorCode == "CV_CANCELLED"
