from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from chartviz_community_core import AnalysisTask

from .analyzer import AnalysisService
from .auth import LocalTokenAuth
from .capabilities import COMMUNITY_CAPABILITIES, Capabilities
from .config import Settings
from .image_store import LocalImageStore
from .provider import ChartAnalysisProvider, OpenAICompatibleProvider
from .repository import SQLiteTaskRepository
from .validation import ImageValidationError, validate_image


def _invalid_request(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=422, detail={"code": code, "message": message})


def _parse_context(raw_context: str) -> dict:
    try:
        context = json.loads(raw_context)
    except (TypeError, ValueError) as exc:
        raise _invalid_request(
            "CV_CONTEXT_INVALID", "Context must be a JSON object."
        ) from exc
    if not isinstance(context, dict):
        raise _invalid_request("CV_CONTEXT_INVALID", "Context must be a JSON object.")

    language = context.get("language", "en")
    if language not in {"en", "zh-CN"}:
        raise _invalid_request(
            "CV_CONTEXT_INVALID", "Language must be en or zh-CN."
        )
    context["language"] = language

    timeframe = context.get("timeframe")
    timeframes = context.get("timeframes")
    if timeframe is not None and (not isinstance(timeframe, str) or not timeframe.strip()):
        raise _invalid_request("CV_CONTEXT_INVALID", "Timeframe must be a string.")
    if timeframes is not None:
        if (
            not isinstance(timeframes, list)
            or len(timeframes) > 1
            or any(not isinstance(item, str) or not item.strip() for item in timeframes)
        ):
            raise _invalid_request(
                "CV_CONTEXT_INVALID",
                "Community Edition supports at most one timeframe.",
            )
    if timeframe is not None and timeframes:
        raise _invalid_request(
            "CV_CONTEXT_INVALID",
            "Provide timeframe or timeframes, not both.",
        )
    return context


def create_app(
    settings: Settings | None = None,
    *,
    provider: ChartAnalysisProvider | None = None,
) -> FastAPI:
    config = settings or Settings.from_env()
    repository = SQLiteTaskRepository(config.data_dir / "community.sqlite3")
    image_store = LocalImageStore(config.data_dir)
    active_provider = provider or OpenAICompatibleProvider(
        base_url=config.llm_base_url,
        api_key=config.llm_api_key,
        model=config.llm_model,
        timeout_seconds=config.timeout_seconds,
    )
    service = AnalysisService(
        repository=repository,
        image_store=image_store,
        provider=active_provider,
        max_image_bytes=config.max_image_bytes,
        max_image_pixels=config.max_image_pixels,
    )
    authenticate = LocalTokenAuth(config.local_api_token)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await service.start()
        try:
            yield
        finally:
            await service.stop()

    app = FastAPI(
        title="ChartViz Community API",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.analysis_service = service
    app.state.repository = repository

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "edition": "community"}

    @app.get("/v1/capabilities", response_model=Capabilities)
    async def capabilities() -> Capabilities:
        return COMMUNITY_CAPABILITIES

    @app.get("/v1/models", dependencies=[Depends(authenticate)])
    async def models() -> dict[str, list[dict[str, str]]]:
        return {
            "models": [{
                "id": config.llm_model,
                "provider": "openai-compatible",
            }]
        }

    @app.post(
        "/v1/analyses",
        status_code=202,
        response_model=AnalysisTask,
        dependencies=[Depends(authenticate)],
    )
    async def create_analysis(
        image: list[UploadFile] = File(...),
        context: str = Form("{}"),
    ) -> AnalysisTask:
        if len(image) != 1:
            raise _invalid_request(
                "CV_IMAGE_INVALID",
                "Community Edition accepts exactly one chart image.",
            )
        upload = image[0]
        content = await upload.read(config.max_image_bytes + 1)
        try:
            validated = validate_image(
                content,
                max_bytes=config.max_image_bytes,
                max_pixels=config.max_image_pixels,
            )
        except ImageValidationError as exc:
            raise _invalid_request("CV_IMAGE_INVALID", str(exc)) from exc
        return await service.submit(validated, _parse_context(context))

    @app.get(
        "/v1/analyses/{analysis_id}",
        response_model=AnalysisTask,
        dependencies=[Depends(authenticate)],
    )
    async def get_analysis(analysis_id: str) -> AnalysisTask:
        task = await repository.get(analysis_id)
        if task is None:
            raise HTTPException(status_code=404, detail="Analysis not found.")
        return task

    @app.delete(
        "/v1/analyses/{analysis_id}",
        status_code=202,
        response_model=AnalysisTask,
        dependencies=[Depends(authenticate)],
    )
    async def cancel_analysis(analysis_id: str) -> AnalysisTask:
        try:
            return await service.cancel(analysis_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Analysis not found.") from exc

    return app


def run() -> None:
    import uvicorn

    uvicorn.run(create_app(), host="0.0.0.0", port=8000)
