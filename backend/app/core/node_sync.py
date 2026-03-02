"""同步节点基类与运行状态模型（Phase C）。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .node_base import BaseNode
from .spec import NodeSpec, SyncConfig
from .sync_protocol import SyncMeta, build_sync_envelope, parse_sync_envelope


@dataclass(slots=True)
class SyncBucket:
    """单个同步桶状态。"""

    # 同步键下已到达的端口数据。
    ports: dict[str, Any] = field(default_factory=dict)
    # 首次与最近一次写入时刻（monotonic 秒），用于观测等待时长。
    first_seen_at: float | None = None
    last_seen_at: float | None = None


@dataclass(slots=True)
class SyncMetrics:
    """同步节点累计统计。"""

    emitted: int = 0
    dropped_late: int = 0
    reclocked: int = 0
    emit_partial: int = 0
    mismatched_inputs: int = 0
    missing_required: int = 0


@dataclass(slots=True)
class SyncState:
    """同步节点内部状态。"""

    # key: (stream_id, seq)
    buckets: dict[tuple[str, int], SyncBucket] = field(default_factory=dict)
    metrics: SyncMetrics = field(default_factory=SyncMetrics)


class SyncNode(BaseNode):
    """同步节点基类。"""

    def __init__(
        self,
        node_id: str,
            spec: NodeSpec,
        config: dict[str, Any] | None = None,
        *,
        sync_config: SyncConfig | None = None,
    ) -> None:
        """初始化同步节点。

        优先级：
        - 若显式传入 sync_config，则使用传入值。
        - 否则回退到 NodeSpec.sync_config。
        """
        super().__init__(node_id=node_id, spec=spec, config=config)
        self.sync_config = sync_config or spec.sync_config
        self.state = SyncState()

    @staticmethod
    def build_sync_payload(*, data: Any, sync: SyncMeta | dict[str, Any]) -> dict[str, Any]:
        """构造标准同步 envelope。"""
        return build_sync_envelope(data=data, sync=sync)

    @staticmethod
    def unpack_sync_payload(payload: Any) -> tuple[Any, dict[str, Any]]:
        """解析标准同步 envelope，返回业务数据与同步元信息。"""
        data, sync_meta = parse_sync_envelope(payload)
        return data, sync_meta.model_dump()
