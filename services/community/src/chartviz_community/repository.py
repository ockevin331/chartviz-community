from __future__ import annotations

import asyncio
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from chartviz_community_core import (
    AnalysisErrorCode,
    AnalysisProgressEvent,
    AnalysisReport,
    AnalysisTask,
)


ProgressCode = Literal["preparing", "reading_chart", "preparing_result"]


@dataclass(frozen=True)
class ClaimedTask:
    task: AnalysisTask
    image_path: str


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SQLiteTaskRepository:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path.expanduser().resolve()
        self._lock = asyncio.Lock()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 10000")
        return connection

    async def initialize(self) -> None:
        self._database_path.parent.mkdir(parents=True, exist_ok=True)

        def operation() -> None:
            with self._connect() as connection:
                connection.execute("PRAGMA journal_mode = WAL")
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS analysis_tasks (
                      request_id TEXT PRIMARY KEY,
                      status TEXT NOT NULL,
                      context_json TEXT NOT NULL,
                      image_path TEXT NOT NULL,
                      report_json TEXT,
                      error_code TEXT,
                      error_message TEXT,
                      progress_json TEXT NOT NULL DEFAULT '[]',
                      created_at TEXT NOT NULL,
                      updated_at TEXT NOT NULL
                    )
                    """
                )

        async with self._lock:
            await asyncio.to_thread(operation)

    async def create(
        self,
        *,
        analysis_id: str,
        context: dict,
        image_path: str,
    ) -> AnalysisTask:
        created_at = _now()

        def operation() -> None:
            with self._connect() as connection:
                connection.execute(
                    """
                    INSERT INTO analysis_tasks (
                      request_id, status, context_json, image_path, progress_json,
                      created_at, updated_at
                    ) VALUES (?, 'pending', ?, ?, '[]', ?, ?)
                    """,
                    (
                        analysis_id,
                        json.dumps(context, ensure_ascii=False),
                        image_path,
                        created_at,
                        created_at,
                    ),
                )

        async with self._lock:
            await asyncio.to_thread(operation)
        task = await self.get(analysis_id)
        if task is None:
            raise RuntimeError("The task was not persisted.")
        return task

    async def get(self, analysis_id: str) -> AnalysisTask | None:
        def operation() -> sqlite3.Row | None:
            with self._connect() as connection:
                return connection.execute(
                    "SELECT * FROM analysis_tasks WHERE request_id = ?",
                    (analysis_id,),
                ).fetchone()

        async with self._lock:
            row = await asyncio.to_thread(operation)
        return self._task_from_row(row) if row is not None else None

    async def claim_next(self) -> ClaimedTask | None:
        def operation() -> tuple[sqlite3.Row, str] | None:
            connection = self._connect()
            try:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    """
                    SELECT * FROM analysis_tasks
                    WHERE status = 'pending'
                    ORDER BY created_at, request_id
                    LIMIT 1
                    """
                ).fetchone()
                if row is None:
                    connection.commit()
                    return None
                connection.execute(
                    "UPDATE analysis_tasks SET status = 'processing', updated_at = ? WHERE request_id = ?",
                    (_now(), row["request_id"]),
                )
                updated = connection.execute(
                    "SELECT * FROM analysis_tasks WHERE request_id = ?",
                    (row["request_id"],),
                ).fetchone()
                connection.commit()
                return updated, str(updated["image_path"])
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.close()

        async with self._lock:
            result = await asyncio.to_thread(operation)
        if result is None:
            return None
        row, image_path = result
        return ClaimedTask(task=self._task_from_row(row), image_path=image_path)

    async def append_progress(
        self,
        analysis_id: str,
        code: ProgressCode,
    ) -> AnalysisTask:
        event = AnalysisProgressEvent(code=code, createdAt=_now())

        def operation() -> None:
            connection = self._connect()
            try:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    "SELECT progress_json FROM analysis_tasks WHERE request_id = ?",
                    (analysis_id,),
                ).fetchone()
                if row is None:
                    raise KeyError(analysis_id)
                progress = json.loads(row["progress_json"])
                progress.append(event.model_dump(mode="json"))
                connection.execute(
                    "UPDATE analysis_tasks SET progress_json = ?, updated_at = ? WHERE request_id = ?",
                    (json.dumps(progress, ensure_ascii=False), _now(), analysis_id),
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.close()

        async with self._lock:
            await asyncio.to_thread(operation)
        return await self._required(analysis_id)

    async def complete(
        self,
        analysis_id: str,
        report: AnalysisReport,
    ) -> AnalysisTask:
        await self._update_terminal(
            analysis_id,
            status="completed",
            report=report,
            error_code=None,
            error_message=None,
        )
        return await self._required(analysis_id)

    async def fail(
        self,
        analysis_id: str,
        *,
        error_code: AnalysisErrorCode,
        error_message: str,
    ) -> AnalysisTask:
        await self._update_terminal(
            analysis_id,
            status="failed",
            report=None,
            error_code=error_code,
            error_message=error_message,
        )
        return await self._required(analysis_id)

    async def _update_terminal(
        self,
        analysis_id: str,
        *,
        status: Literal["completed", "failed"],
        report: AnalysisReport | None,
        error_code: AnalysisErrorCode | None,
        error_message: str | None,
    ) -> None:
        report_json = (
            json.dumps(report.model_dump(mode="json"), ensure_ascii=False)
            if report is not None
            else None
        )

        def operation() -> None:
            with self._connect() as connection:
                cursor = connection.execute(
                    """
                    UPDATE analysis_tasks
                    SET status = ?, report_json = ?, error_code = ?, error_message = ?, updated_at = ?
                    WHERE request_id = ?
                    """,
                    (
                        status,
                        report_json,
                        error_code,
                        error_message,
                        _now(),
                        analysis_id,
                    ),
                )
                if cursor.rowcount != 1:
                    raise KeyError(analysis_id)

        async with self._lock:
            await asyncio.to_thread(operation)

    async def request_cancel(self, analysis_id: str) -> AnalysisTask:
        def operation() -> None:
            with self._connect() as connection:
                cursor = connection.execute(
                    """
                    UPDATE analysis_tasks
                    SET status = 'cancel_requested', updated_at = ?
                    WHERE request_id = ? AND status IN ('pending', 'processing')
                    """,
                    (_now(), analysis_id),
                )
                if cursor.rowcount == 0:
                    exists = connection.execute(
                        "SELECT 1 FROM analysis_tasks WHERE request_id = ?",
                        (analysis_id,),
                    ).fetchone()
                    if exists is None:
                        raise KeyError(analysis_id)

        async with self._lock:
            await asyncio.to_thread(operation)
        return await self._required(analysis_id)

    async def mark_cancelled(self, analysis_id: str) -> AnalysisTask:
        def operation() -> None:
            with self._connect() as connection:
                cursor = connection.execute(
                    """
                    UPDATE analysis_tasks
                    SET status = 'cancelled', error_code = 'CV_CANCELLED', updated_at = ?
                    WHERE request_id = ? AND status IN ('pending', 'processing', 'cancel_requested')
                    """,
                    (_now(), analysis_id),
                )
                if cursor.rowcount == 0:
                    raise KeyError(analysis_id)

        async with self._lock:
            await asyncio.to_thread(operation)
        return await self._required(analysis_id)

    async def recover_interrupted(self) -> None:
        def operation() -> None:
            with self._connect() as connection:
                connection.execute(
                    "UPDATE analysis_tasks SET status = 'pending', updated_at = ? WHERE status = 'processing'",
                    (_now(),),
                )
                connection.execute(
                    """
                    UPDATE analysis_tasks
                    SET status = 'cancelled', error_code = 'CV_CANCELLED', updated_at = ?
                    WHERE status = 'cancel_requested'
                    """,
                    (_now(),),
                )

        async with self._lock:
            await asyncio.to_thread(operation)

    async def _required(self, analysis_id: str) -> AnalysisTask:
        task = await self.get(analysis_id)
        if task is None:
            raise KeyError(analysis_id)
        return task

    @staticmethod
    def _task_from_row(row: sqlite3.Row) -> AnalysisTask:
        report = json.loads(row["report_json"]) if row["report_json"] else None
        return AnalysisTask.model_validate({
            "requestId": row["request_id"],
            "status": row["status"],
            "context": json.loads(row["context_json"]),
            "report": report,
            "errorCode": row["error_code"],
            "error": row["error_message"],
            "progressEvents": json.loads(row["progress_json"]),
        })
