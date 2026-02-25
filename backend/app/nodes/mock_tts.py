"""Mock TTS 节点（非流式）。"""

from __future__ import annotations

from typing import Any

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext


class MockTTSNode(AsyncNode):
    """阶段 A: 输入完整文本，输出完整音频元信息。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        text = str(inputs.get("text", ""))
        # 这里只返回模拟音频信息，不做真实语音合成。
        return {
            "audio": {
                "format": "wav",
                "duration_ms": max(400, len(text) * 70),
                "text": text,
            }
        }
