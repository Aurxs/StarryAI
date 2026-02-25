"""Mock 动作规划节点（非流式）。"""

from __future__ import annotations

from typing import Any

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext


class MockMotionNode(AsyncNode):
    """阶段 A: 输入完整文本，输出完整动作时间线。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        text = str(inputs.get("text", ""))
        steps = [
            {"t": 0, "action": "idle"},
            {"t": 200, "action": "speak_start"},
            {"t": 1200 + len(text) * 15, "action": "speak_end"},
        ]
        return {"motion": {"timeline": steps, "source_text": text}}
