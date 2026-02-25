"""阶段 A: 同步节点基类。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .node_base import BaseNode
from .spec import SyncConfig


@dataclass(slots=True)
class SyncState:
    """同步节点内部状态容器。

    buckets:
    - key: sync_key（通常对应 stream_id）
    - value: 按端口暂存的输入
    """

    buckets: dict[str, dict[str, Any]] = field(default_factory=dict)


class SyncNode(BaseNode):
    """同步节点基类。"""

    def __init__(
        self,
        node_id: str,
        spec,
        config: dict[str, Any] | None = None,
        *,
        sync_config: SyncConfig | None = None,
    ) -> None:
        super().__init__(node_id=node_id, spec=spec, config=config)
        self.sync_config = sync_config or spec.sync_config
        self.state = SyncState()
