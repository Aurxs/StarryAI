"""运行事件 WebSocket（阶段 A 占位）。"""

from __future__ import annotations

from fastapi import APIRouter, WebSocket

# 运行事件 WebSocket 路由。
router = APIRouter(tags=["runs-ws"])


@router.websocket("/api/v1/runs/{run_id}/events")
async def run_events(ws: WebSocket, run_id: str) -> None:
    """订阅指定运行实例的事件流。

    阶段 A 提供占位行为：
    1. 接受连接
    2. 返回一条说明消息
    3. 主动关闭连接
    """
    await ws.accept()

    await ws.send_json(
        {
            "run_id": run_id,
            "event_type": "system",
            "message": "WebSocket runtime events will be implemented in Phase B",
        }
    )

    await ws.close()
