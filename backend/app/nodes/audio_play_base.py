"""基础音频播放节点（收到即执行）。"""

from __future__ import annotations

from typing import Any

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext


class AudioPlayBaseNode(AsyncNode):
    """基础动作节点：消费音频包，不产生输出。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _payload = inputs.get("in")
        print(
            f"[AudioPlayBase] run={context.run_id} node={context.node_id} "
            "executed_immediately=true"
        )
        return {}

