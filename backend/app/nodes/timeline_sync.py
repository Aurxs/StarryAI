"""时间轴同步节点。"""

from __future__ import annotations

import time
from typing import Any

from app.core.node_base import NodeContext
from app.core.node_sync import SyncNode


class TimelineSyncNode(SyncNode):
    """音频与动作的同步编排节点。

    端口约定：
    - 输入：`audio`、`motion`
    - 输出：`sync`

    当前阶段行为：
    - 以完整音频和完整动作为输入，输出一条统一同步计划。
    - 计划中包含 `stream_id`、`seq`、`play_at` 三个关键字段。
    """

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        """聚合输入并产出同步计划。"""
        # 读取上游两路完整结果。
        audio_payload = inputs.get("audio", {})
        motion_payload = inputs.get("motion", {})

        # 使用单调时钟计算未来触发时刻，避免系统时间跳变影响。
        now = time.monotonic()

        # `stream_id`：同一业务流标识；
        # `seq`：当前阶段非流式，固定为 0；
        # `play_at`：调度执行对齐时刻。
        sync_packet = {
            "stream_id": context.metadata.get("stream_id", "stream_default"),
            "seq": 0,
            "play_at": now + 0.25,
            "audio": audio_payload,
            "motion": motion_payload,
            "strategy": self.sync_config.strategy.value if self.sync_config else "barrier",
        }

        return {"sync": sync_packet}
