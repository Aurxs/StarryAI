"""运行控制接口（Phase B）。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status

from app.core.frame import RuntimeEventSeverity, RuntimeEventType
from app.core.graph_builder import GraphBuildError
from app.schemas.runs import (
    CreateRunRequest,
    CreateRunResponse,
    RunDiagnosticsResponse,
    RunEventsResponse,
    RunMetricsResponse,
    RunStatusResponse,
    StopRunResponse,
)
from app.services.run_service import (
    InvalidRunRequestError,
    RunCapacityExceededError,
    RunNotFoundError,
    get_run_service,
)

# 运行控制相关路由。
router = APIRouter(prefix="/api/v1/runs", tags=["runs"])


@router.post("")
async def create_run(req: CreateRunRequest) -> dict[str, object]:
    """创建一次图运行。
    """
    service = get_run_service()
    try:
        record = await service.create_run(req.graph, stream_id=req.stream_id)
    except GraphBuildError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "message": "Graph validation failed before execution",
                "report": exc.report.model_dump(mode="json"),
            },
        ) from exc
    except InvalidRunRequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"message": str(exc)},
        ) from exc
    except RunCapacityExceededError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"message": str(exc)},
        ) from exc

    response = CreateRunResponse(run_id=record.run_id, graph_id=record.graph_id, status=record.status)
    return response.model_dump(mode="json")


@router.post("/{run_id}/stop")
async def stop_run(run_id: str) -> dict[str, object]:
    """停止指定运行实例。
    """
    service = get_run_service()
    try:
        record = await service.stop_run(run_id)
    except RunNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return StopRunResponse(run_id=record.run_id, status=record.status).model_dump(mode="json")


@router.get("/{run_id}")
async def get_run_status(run_id: str) -> dict[str, object]:
    """获取指定运行实例状态。"""
    service = get_run_service()
    try:
        snapshot = service.get_run_snapshot(run_id)
    except RunNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return RunStatusResponse(**snapshot).model_dump(mode="json")


@router.get("/{run_id}/events")
async def get_run_events(
        run_id: str,
        *,
        since: int = Query(default=0, ge=0),
        limit: int = Query(default=200, ge=1, le=1000),
        event_type: RuntimeEventType | None = Query(default=None),
        node_id: str | None = Query(default=None, min_length=1),
        severity: RuntimeEventSeverity | None = Query(default=None),
        error_code: str | None = Query(default=None, min_length=1),
) -> dict[str, object]:
    """分页获取指定运行实例的内存事件。"""
    service = get_run_service()
    try:
        events, next_cursor = service.get_run_events(
            run_id,
            since=since,
            limit=limit,
            event_type=event_type,
            node_id=node_id,
            severity=severity,
            error_code=error_code,
        )
    except RunNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return RunEventsResponse(
        run_id=run_id,
        next_cursor=next_cursor,
        count=len(events),
        items=events,
    ).model_dump(mode="json")


@router.get("/{run_id}/metrics")
async def get_run_metrics(run_id: str) -> dict[str, object]:
    """获取指定运行实例的指标视图。"""
    service = get_run_service()
    try:
        payload = service.get_run_metrics(run_id)
    except RunNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return RunMetricsResponse(**payload).model_dump(mode="json")


@router.get("/{run_id}/diagnostics")
async def get_run_diagnostics(run_id: str) -> dict[str, object]:
    """获取指定运行实例的诊断视图。"""
    service = get_run_service()
    try:
        payload = service.get_run_diagnostics(run_id)
    except RunNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return RunDiagnosticsResponse(**payload).model_dump(mode="json")
