"""Mock 输入节点。"""

from __future__ import annotations

from typing import Any

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext


class MockInputNode(AsyncNode):
    """阶段 A: 产出完整文本。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        content = self.config.get("content", "你好，这是 StarryAI 的输入消息")
        return {"text": content}
