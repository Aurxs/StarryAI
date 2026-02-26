"""运行事件 WebSocket（Phase B 最小可用版）。"""

from __future__ import annotations

import asyncio
from contextlib import suppress

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

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

    try:
        while True:
            events, next_cursor = service.get_run_events(run_id, since=cursor, limit=200)
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
