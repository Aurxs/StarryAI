"""双输入双输出同步发起器。"""

from __future__ import annotations

import time
from typing import Any

from app.core.node_base import NodeContext
from app.core.node_sync import SyncNode


class SyncInitiatorDualNode(SyncNode):
    """将两个普通输入封装为两个同步数据包。"""

    def __init__(self, node_id: str, spec, config: dict[str, Any] | None = None) -> None:
        super().__init__(node_id=node_id, spec=spec, config=config)
        self._round_cursor = self._normalize_round(self.config.get("sync_round", 0))

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        if "in_a" not in inputs or "in_b" not in inputs:
            raise ValueError("sync.initiator.dual 需要 in_a/in_b 两路输入")

        stream_id = str(context.metadata.get("stream_id", "stream_default"))
        configured_group = self.config.get("sync_group")
        sync_group = str(configured_group).strip() if configured_group is not None else "default_group"
        if not sync_group:
            raise ValueError("sync.initiator.dual 的 sync_group 不能为空")

        ready_timeout_ms = self._normalize_positive_int(
            self.config.get("ready_timeout_ms", 800),
            field_name="ready_timeout_ms",
        )
        commit_lead_ms = self._normalize_positive_int(
            self.config.get("commit_lead_ms", 50),
            field_name="commit_lead_ms",
        )
        sync_round = self._round_cursor
        self._round_cursor += 1

        sync_key = f"{stream_id}:{sync_group}:{sync_round}"
        sync_packet = {
            "stream_id": stream_id,
            "seq": sync_round,
            "sync_group": sync_group,
            "sync_round": sync_round,
            "ready_timeout_ms": ready_timeout_ms,
            "commit_lead_ms": commit_lead_ms,
            "sync_key": sync_key,
            "issued_at": time.monotonic(),
        }

        return {
            "out_a": {"data": inputs.get("in_a"), "sync": dict(sync_packet)},
            "out_b": {"data": inputs.get("in_b"), "sync": dict(sync_packet)},
            "__node_metrics": {"sync_packets_emitted": 2},
        }

    @staticmethod
    def _normalize_round(raw_round: Any) -> int:
        if isinstance(raw_round, bool) or not isinstance(raw_round, int) or raw_round < 0:
            return 0
        return int(raw_round)

    @staticmethod
    def _normalize_positive_int(raw_value: Any, *, field_name: str) -> int:
        if isinstance(raw_value, bool) or not isinstance(raw_value, int):
            raise ValueError(f"sync.initiator.dual 的 {field_name} 非法: {raw_value!r}")
        if raw_value < 1:
            raise ValueError(f"sync.initiator.dual 的 {field_name} 必须 >= 1: {raw_value}")
        return int(raw_value)
