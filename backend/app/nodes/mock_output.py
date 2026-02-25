"""Mock 输出节点。"""

from __future__ import annotations

from typing import Any

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext


class MockOutputNode(AsyncNode):
    """阶段 A: 消费任意输入并打印。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        print(f"[MockOutput] run={context.run_id} node={context.node_id} payload={inputs}")
        return {}
