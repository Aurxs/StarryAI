"""同步动作执行节点。"""

from __future__ import annotations

from typing import Any

from app.core.node_base import NodeContext
from app.core.node_sync_executor import SyncExecutorNode


class MotionPlaySyncNode(SyncExecutorNode):
    """在协调器提交后执行动作轨迹。"""

    async def execute(self, *, data: Any, sync_meta: dict[str, Any], context: NodeContext) -> None:
        _ = data
        print(
            f"[MotionPlaySync] run={context.run_id} node={context.node_id} "
            f"group={sync_meta.get('sync_group')} round={sync_meta.get('sync_round')}"
        )

