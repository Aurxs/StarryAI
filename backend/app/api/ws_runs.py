"""运行事件 WebSocket（阶段 A 占位）。"""

from __future__ import annotations

from fastapi import APIRouter, WebSocket

router = APIRouter(tags=["runs-ws"])


@router.websocket("/api/v1/runs/{run_id}/events")
async def run_events(ws: WebSocket, run_id: str) -> None:
    await ws.accept()
    await ws.send_json(
        {
            "run_id": run_id,
            "event_type": "system",
            "message": "WebSocket runtime events will be implemented in Phase B",
        }
    )
    await ws.close()
