from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from uuid import uuid4

from chartviz_community_core import AnalysisErrorCode, AnalysisTask
from .image_store import LocalImageStore
from .provider import (
    ChartAnalysisProvider,
    ProviderFailure,
    ProviderResponseInvalid,
    ProviderTimeout,
)
from .repository import SQLiteTaskRepository
from .validation import ImageValidationError, ValidatedImage, validate_image


_ERROR_MESSAGES: dict[AnalysisErrorCode, dict[str, str]] = {
    "CV_IMAGE_INVALID": {
        "en": "The uploaded image could not be read as a chart screenshot.",
        "zh-CN": "无法将上传的图片读取为图表截图。",
    },
    "CV_PROVIDER_TIMEOUT": {
        "en": "The model provider timed out. Please try again.",
        "zh-CN": "模型服务响应超时，请重试。",
    },
    "CV_PROVIDER_ERROR": {
        "en": "The model provider request failed. Check the provider configuration and try again.",
        "zh-CN": "模型服务请求失败，请检查服务配置后重试。",
    },
    "CV_RESPONSE_INVALID": {
        "en": "The model response did not match the ChartViz report schema.",
        "zh-CN": "模型返回结果不符合 ChartViz 报告格式。",
    },
    "CV_CANCELLED": {
        "en": "The analysis was cancelled.",
        "zh-CN": "分析已取消。",
    },
    "CV_INTERNAL_ERROR": {
        "en": "The analysis could not be completed because of an internal error.",
        "zh-CN": "由于内部错误，分析未能完成。",
    },
}


def new_analysis_id(now: datetime | None = None) -> str:
    current = now or datetime.now(timezone.utc)
    return f"c_{current:%Y%m%d}_{uuid4().hex}"


class AnalysisService:
    def __init__(
        self,
        *,
        repository: SQLiteTaskRepository,
        image_store: LocalImageStore,
        provider: ChartAnalysisProvider,
        max_image_bytes: int,
        max_image_pixels: int,
    ) -> None:
        self._repository = repository
        self._image_store = image_store
        self._provider = provider
        self._max_image_bytes = max_image_bytes
        self._max_image_pixels = max_image_pixels
        self._wake = asyncio.Event()
        self._worker: asyncio.Task[None] | None = None
        self._stopping = False

    async def start(self) -> None:
        await self._repository.initialize()
        await self._repository.recover_interrupted()
        if self._worker is None or self._worker.done():
            self._stopping = False
            self._worker = asyncio.create_task(self._run(), name="community-analysis-worker")

    async def stop(self) -> None:
        self._stopping = True
        if self._worker is None:
            return
        self._worker.cancel()
        try:
            await self._worker
        except asyncio.CancelledError:
            pass
        finally:
            self._worker = None

    async def submit(
        self,
        image: ValidatedImage,
        context: dict,
    ) -> AnalysisTask:
        analysis_id = new_analysis_id()
        image_path = self._image_store.put(analysis_id, image)
        try:
            task = await self._repository.create(
                analysis_id=analysis_id,
                context=dict(context),
                image_path=image_path,
            )
        except Exception:
            self._image_store.delete(image_path)
            raise
        self._wake.set()
        return task

    async def cancel(self, analysis_id: str) -> AnalysisTask:
        current = await self._repository.get(analysis_id)
        if current is None:
            raise KeyError(analysis_id)
        if current.status == "pending":
            await self._repository.request_cancel(analysis_id)
            return await self._repository.mark_cancelled(analysis_id)
        if current.status == "processing":
            return await self._repository.request_cancel(analysis_id)
        return current

    async def process_one(self) -> bool:
        claimed = await self._repository.claim_next()
        if claimed is None:
            return False
        analysis_id = claimed.task.requestId
        language = "zh-CN" if claimed.task.context.get("language") == "zh-CN" else "en"
        try:
            await self._repository.append_progress(analysis_id, "preparing")
            if await self._finish_requested_cancellation(analysis_id):
                return True
            image = validate_image(
                self._image_store.read(claimed.image_path),
                max_bytes=self._max_image_bytes,
                max_pixels=self._max_image_pixels,
            )
            await self._repository.append_progress(analysis_id, "reading_chart")
            if await self._finish_requested_cancellation(analysis_id):
                return True
            report = await self._provider.analyze(image, claimed.task.context)
            if await self._finish_requested_cancellation(analysis_id):
                return True
            await self._repository.append_progress(analysis_id, "preparing_result")
            await self._repository.complete(analysis_id, report)
        except asyncio.CancelledError:
            if self._stopping:
                raise
            await self._repository.mark_cancelled(analysis_id)
        except ImageValidationError:
            await self._fail(analysis_id, "CV_IMAGE_INVALID", language)
        except ProviderTimeout:
            await self._fail(analysis_id, "CV_PROVIDER_TIMEOUT", language)
        except ProviderFailure:
            await self._fail(analysis_id, "CV_PROVIDER_ERROR", language)
        except ProviderResponseInvalid:
            await self._fail(analysis_id, "CV_RESPONSE_INVALID", language)
        except Exception:
            await self._fail(analysis_id, "CV_INTERNAL_ERROR", language)
        return True

    async def _finish_requested_cancellation(self, analysis_id: str) -> bool:
        current = await self._repository.get(analysis_id)
        if current is not None and current.status == "cancel_requested":
            await self._repository.mark_cancelled(analysis_id)
            return True
        return False

    async def _fail(
        self,
        analysis_id: str,
        error_code: AnalysisErrorCode,
        language: str,
    ) -> None:
        await self._repository.fail(
            analysis_id,
            error_code=error_code,
            error_message=_ERROR_MESSAGES[error_code][language],
        )

    async def _run(self) -> None:
        while True:
            self._wake.clear()
            processed = await self.process_one()
            if not processed:
                await self._wake.wait()
