"""时间轴同步节点。"""

from __future__ import annotations

import time
from typing import Any

from app.core.node_base import NodeContext
from app.core.node_sync import SyncNode


class TimelineSyncNode(SyncNode):
    """阶段 A: 聚合完整音频与完整动作，产出统一同步计划。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        audio = inputs.get("audio", {})
        motion = inputs.get("motion", {})
        now = time.monotonic()

        sync_packet = {
            "stream_id": context.metadata.get("stream_id", "stream_default"),
            "seq": 0,
            "play_at": now + 0.25,
            "audio": audio,
            "motion": motion,
            "strategy": self.sync_config.strategy.value if self.sync_config else "barrier",
        }
        return {"sync": sync_packet}
