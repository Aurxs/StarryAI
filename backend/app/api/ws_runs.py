"""运行事件 WebSocket（Phase B 最小可用版）。"""

from __future__ import annotations

import asyncio
from contextlib import suppress

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.frame import RuntimeEventSeverity, RuntimeEventType
from app.services.run_service import RunNotFoundError, get_run_service

# 运行事件 WebSocket 路由。
router = APIRouter(tags=["runs-ws"])


@router.websocket("/api/v1/runs/{run_id}/events")
async def run_events(ws: WebSocket, run_id: str) -> None:
    """订阅指定运行实例的事件流。
    """
    await ws.accept()
    service = get_run_service()

    try:
        service.get_run(run_id)
    except RunNotFoundError:
        await ws.send_json({"run_id": run_id, "event_type": "error", "message": "run not found"})
        await ws.close(code=4404)
        return

    cursor_raw = ws.query_params.get("since", "0")
    try:
        cursor = max(int(cursor_raw), 0)
    except ValueError:
        cursor = 0

    event_type_raw = ws.query_params.get("event_type")
    event_type: RuntimeEventType | None = None
    if event_type_raw:
        try:
            event_type = RuntimeEventType(event_type_raw)
        except ValueError:
            await ws.send_json(
                {
                    "run_id": run_id,
                    "event_type": "error",
                    "message": f"invalid event_type: {event_type_raw}",
                }
            )
            await ws.close(code=4400)
            return

    severity_raw = ws.query_params.get("severity")
    severity: RuntimeEventSeverity | None = None
    if severity_raw:
        try:
            severity = RuntimeEventSeverity(severity_raw)
        except ValueError:
            await ws.send_json(
                {
                    "run_id": run_id,
                    "event_type": "error",
                    "message": f"invalid severity: {severity_raw}",
                }
            )
            await ws.close(code=4400)
            return

    node_id = (ws.query_params.get("node_id") or "").strip() or None
    error_code = (ws.query_params.get("error_code") or "").strip() or None

    try:
        while True:
            events, next_cursor = service.get_run_events(
                run_id,
                since=cursor,
                limit=200,
                event_type=event_type,
                node_id=node_id,
                severity=severity,
                error_code=error_code,
            )
            for event in events:
                await ws.send_json(event.model_dump(mode="json"))
            cursor = next_cursor

            snapshot = service.get_run_snapshot(run_id)
            # 终态且无新事件时结束推送。
            if snapshot["task_done"] and not events:
                await ws.send_json(
                    {
                        "run_id": run_id,
                        "event_type": "system",
                        "message": "stream completed",
                        "status": snapshot["status"],
                    }
                )
                break

            await asyncio.sleep(0.2)
    except WebSocketDisconnect:
        return
    finally:
        with suppress(RuntimeError):
            await ws.close()
