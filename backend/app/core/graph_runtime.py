"""阶段 A：图运行态结构。

当前仅定义状态数据结构，供阶段 B 调度器填充与更新。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class RuntimeNodeState:
    """节点运行状态。"""

    node_id: str
    # idle/running/finished/failed 等状态字符串。
    status: str = "idle"
    # 最近一次错误信息（如果有）。
    last_error: str | None = None
    # 运行指标（如耗时、处理次数）。
    metrics: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class RuntimeEdgeState:
    """边运行状态。"""

    source_node: str
    source_port: str
    target_node: str
    target_port: str
    # 边对应队列当前长度。
    queue_size: int = 0


@dataclass(slots=True)
class GraphRuntimeState:
    """整个图运行状态快照。"""

    run_id: str
    node_states: dict[str, RuntimeNodeState] = field(default_factory=dict)
    edge_states: list[RuntimeEdgeState] = field(default_factory=list)
