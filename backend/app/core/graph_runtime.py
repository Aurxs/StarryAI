"""图运行态结构（Phase B）。

该模块定义调度器在运行过程中维护的状态快照。
运行状态会被 runs API 与事件推送复用，用于前端展示与调试排障。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class RuntimeNodeState:
    """节点运行状态。"""

    node_id: str
    # idle/running/finished/failed/stopped
    status: str = "idle"
    started_at: float | None = None
    finished_at: float | None = None
    # 最近一次错误信息（如果有）。
    last_error: str | None = None
    # 运行指标（如执行次数、耗时）。
    metrics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """序列化为可 JSON 化结构。"""
        return {
            "node_id": self.node_id,
            "status": self.status,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "last_error": self.last_error,
            "metrics": dict(self.metrics),
        }


@dataclass(slots=True)
class RuntimeEdgeState:
    """边运行状态。"""

    source_node: str
    source_port: str
    target_node: str
    target_port: str
    # 边对应队列当前长度。
    queue_size: int = 0
    # 边队列观测到的历史峰值。
    queue_peak_size: int = 0
    # 该边累计转发帧数量。
    forwarded_frames: int = 0

    def to_dict(self) -> dict[str, Any]:
        """序列化为可 JSON 化结构。"""
        return {
            "source_node": self.source_node,
            "source_port": self.source_port,
            "target_node": self.target_node,
            "target_port": self.target_port,
            "queue_size": self.queue_size,
            "queue_peak_size": self.queue_peak_size,
            "forwarded_frames": self.forwarded_frames,
        }


@dataclass(slots=True)
class GraphRuntimeState:
    """整个图运行状态快照。"""

    run_id: str
    graph_id: str
    # idle/running/completed/stopped/failed
    status: str = "idle"
    started_at: float | None = None
    ended_at: float | None = None
    last_error: str | None = None
    # 图级聚合指标（事件计数、节点状态计数、边转发统计等）。
    metrics: dict[str, Any] = field(default_factory=dict)
    node_states: dict[str, RuntimeNodeState] = field(default_factory=dict)
    edge_states: list[RuntimeEdgeState] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """序列化为可 JSON 化结构。"""
        return {
            "run_id": self.run_id,
            "graph_id": self.graph_id,
            "status": self.status,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "last_error": self.last_error,
            "metrics": dict(self.metrics),
            "node_states": {k: v.to_dict() for k, v in self.node_states.items()},
            "edge_states": [edge.to_dict() for edge in self.edge_states],
        }
