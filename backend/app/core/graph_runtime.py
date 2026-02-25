"""阶段 A: 运行态结构占位。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class RuntimeNodeState:
    """节点运行状态。"""

    node_id: str
    status: str = "idle"
    last_error: str | None = None
    metrics: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class RuntimeEdgeState:
    """边运行状态。"""

    source_node: str
    source_port: str
    target_node: str
    target_port: str
    queue_size: int = 0


@dataclass(slots=True)
class GraphRuntimeState:
    """图运行时总状态。"""

    run_id: str
    node_states: dict[str, RuntimeNodeState] = field(default_factory=dict)
    edge_states: list[RuntimeEdgeState] = field(default_factory=list)
