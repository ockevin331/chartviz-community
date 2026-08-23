import pytest

from chartviz_community.repository import SQLiteTaskRepository
from factories import make_report


ANALYSIS_ID = "c_20260823_0123456789abcdef0123456789abcdef"
SECOND_ID = "c_20260823_fedcba9876543210fedcba9876543210"
IMAGE_PATH = f"images/{ANALYSIS_ID}/original.png"


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_repository_persists_a_completed_task_across_instances(tmp_path) -> None:
    database_path = tmp_path / "community.sqlite3"
    repository = SQLiteTaskRepository(database_path)
    await repository.initialize()
    await repository.create(
        analysis_id=ANALYSIS_ID,
        context={"language": "en", "timeframe": "15m"},
        image_path=IMAGE_PATH,
    )

    claimed = await repository.claim_next()
    assert claimed is not None
    assert claimed.task.status == "processing"
    assert claimed.image_path == IMAGE_PATH
    await repository.complete(claimed.task.requestId, make_report())

    reopened = SQLiteTaskRepository(database_path)
    await reopened.initialize()
    completed = await reopened.get(ANALYSIS_ID)
    assert completed is not None
    assert completed.status == "completed"
    assert completed.report == make_report()
    assert completed.context == {"language": "en", "timeframe": "15m"}


@pytest.mark.anyio
async def test_repository_recovers_processing_tasks_but_not_cancellations(tmp_path) -> None:
    repository = SQLiteTaskRepository(tmp_path / "community.sqlite3")
    await repository.initialize()
    await repository.create(
        analysis_id=ANALYSIS_ID,
        context={"language": "en"},
        image_path=IMAGE_PATH,
    )
    claimed = await repository.claim_next()
    assert claimed is not None
    await repository.create(
        analysis_id=SECOND_ID,
        context={"language": "zh-CN"},
        image_path=f"images/{SECOND_ID}/original.png",
    )
    await repository.request_cancel(SECOND_ID)

    await repository.recover_interrupted()

    first = await repository.get(ANALYSIS_ID)
    second = await repository.get(SECOND_ID)
    assert first is not None and first.status == "pending"
    assert second is not None and second.status == "cancelled"
    reclaimed = await repository.claim_next()
    assert reclaimed is not None and reclaimed.task.requestId == ANALYSIS_ID
    assert await repository.claim_next() is None


@pytest.mark.anyio
async def test_repository_keeps_progress_events_in_append_order(tmp_path) -> None:
    repository = SQLiteTaskRepository(tmp_path / "community.sqlite3")
    await repository.initialize()
    await repository.create(
        analysis_id=ANALYSIS_ID,
        context={"language": "en"},
        image_path=IMAGE_PATH,
    )

    await repository.append_progress(ANALYSIS_ID, "preparing")
    await repository.append_progress(ANALYSIS_ID, "reading_chart")
    await repository.append_progress(ANALYSIS_ID, "preparing_result")

    task = await repository.get(ANALYSIS_ID)
    assert task is not None
    assert [event.code for event in task.progressEvents] == [
        "preparing",
        "reading_chart",
        "preparing_result",
    ]
