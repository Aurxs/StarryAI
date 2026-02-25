"""阶段 A：同步节点基类。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .node_base import BaseNode
from .spec import NodeSpec, SyncConfig


@dataclass(slots=True)
class SyncState:
    """同步节点内部状态。

    buckets 结构：
    - key: sync_key（一般可使用 stream_id）
    - value: 已到达端口的数据映射（port_name -> payload）
    """

    buckets: dict[str, dict[str, Any]] = field(default_factory=dict)


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
