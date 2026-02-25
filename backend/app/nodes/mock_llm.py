"""Mock LLM 节点（非流式）。"""

from __future__ import annotations

from typing import Any

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext


class MockLLMNode(AsyncNode):
    """阶段 A: 等待输入完整文本后返回完整回复。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        prompt = str(inputs.get("prompt", ""))
        answer = f"[MockLLM回复] 已收到: {prompt}"
        return {"answer": answer}
