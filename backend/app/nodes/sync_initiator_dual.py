"""双输入双输出同步发起器。"""

from __future__ import annotations

from typing import Any

from pydantic import Field

from app.core.node_base import NodeContext
from app.core.node_config import CommonNodeConfig
from app.core.node_definition import NodeDefinition
from app.core.node_sync import SyncNode
from app.core.spec import NodeMode, NodeSpec, PortSpec, SyncConfig, SyncRole, SyncStrategy
from app.core.sync_protocol import SyncMeta


class SyncInitiatorDualConfig(CommonNodeConfig):
    """同步发起器配置。"""

    sync_group: Any = Field(default=None, description="Sync group name for the task.")
    sync_round: Any = Field(default=0, description="Current sync round for the task.")
    ready_timeout_ms: Any = Field(
        default=800,
        description="Maximum wait time for participants to become ready, in milliseconds.",
    )
    commit_lead_ms: Any = Field(
        default=50,
        description="Lead time reserved before the coordinator commits, in milliseconds.",
    )


class SyncInitiatorDualNode(SyncNode):
    """将两个普通输入封装为两个同步数据包。"""

    ConfigModel = SyncInitiatorDualConfig

    def __init__(self, node_id: str, spec, config: dict[str, Any] | None = None) -> None:
        super().__init__(node_id=node_id, spec=spec, config=config)
        cfg = self.cfg if isinstance(self.cfg, SyncInitiatorDualConfig) else None
        raw_round = cfg.sync_round if cfg is not None else self.config.get("sync_round", 0)
        self._round_cursor = self._normalize_round(raw_round)

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        if "in_a" not in inputs or "in_b" not in inputs:
            raise ValueError("sync.initiator.dual 需要 in_a/in_b 两路输入")

        cfg = self.cfg if isinstance(self.cfg, SyncInitiatorDualConfig) else None
        stream_id = str(context.metadata.get("stream_id", "stream_default"))
        configured_group = cfg.sync_group if cfg is not None else self.config.get("sync_group")
        if not isinstance(configured_group, str):
            raise ValueError("sync.initiator.dual 的 sync_group 必须是非空字符串")
        sync_group = configured_group.strip()
        if not sync_group:
            raise ValueError("sync.initiator.dual 的 sync_group 不能为空")

        ready_timeout_ms = self._normalize_positive_int(
            cfg.ready_timeout_ms if cfg is not None else self.config.get("ready_timeout_ms", 800),
            field_name="ready_timeout_ms",
        )
        commit_lead_ms = self._normalize_positive_int(
            cfg.commit_lead_ms if cfg is not None else self.config.get("commit_lead_ms", 50),
            field_name="commit_lead_ms",
        )
        sync_round = self._round_cursor
        self._round_cursor += 1

        sync_meta = SyncMeta(
            stream_id=stream_id,
            seq=sync_round,
            sync_group=sync_group,
            sync_round=sync_round,
            ready_timeout_ms=ready_timeout_ms,
            commit_lead_ms=commit_lead_ms,
        )

        return {
            "out_a": self.build_sync_payload(data=inputs.get("in_a"), sync=sync_meta),
            "out_b": self.build_sync_payload(data=inputs.get("in_b"), sync=sync_meta),
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


SYNC_INITIATOR_DUAL_SPEC = NodeSpec(
    type_name="sync.initiator.dual",
    mode=NodeMode.SYNC,
    inputs=[
        PortSpec(name="in_a", frame_schema="any", required=True),
        PortSpec(name="in_b", frame_schema="any", required=True),
    ],
    outputs=[
        PortSpec(
            name="out_a",
            frame_schema="any.sync",
            required=True,
            derived_from_input="in_a",
        ),
        PortSpec(
            name="out_b",
            frame_schema="any.sync",
            required=True,
            derived_from_input="in_b",
        ),
    ],
    sync_config=SyncConfig(
        required_ports=["in_a", "in_b"],
        strategy=SyncStrategy.BARRIER,
        role=SyncRole.INITIATOR,
    ),
    description="Sync initiator that packages dual inputs into paired sync tasks.",
    config_schema=SyncInitiatorDualConfig.model_json_schema(),
)


NODE_DEFINITION = NodeDefinition(
    spec=SYNC_INITIATOR_DUAL_SPEC,
    impl_cls=SyncInitiatorDualNode,
    config_model=SyncInitiatorDualConfig,
)
