"""runs API DTO 定义（Phase B）。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.frame import RuntimeEvent
from app.core.spec import GraphSpec


class CreateRunRequest(BaseModel):
    """创建运行请求。"""

    model_config = ConfigDict(extra="forbid")

    graph: GraphSpec = Field(..., description="待运行的图定义")
    stream_id: str = Field(default="stream_default", min_length=1, description="业务流 ID")

    @field_validator("stream_id")
    @classmethod
    def validate_stream_id(cls, value: str) -> str:
        """规范化并校验业务流 ID。"""
        normalized = value.strip()
        if not normalized:
            raise ValueError("stream_id 不能为空")
        return normalized


class CreateRunResponse(BaseModel):
    """创建运行响应。"""

    model_config = ConfigDict(extra="forbid")

    run_id: str
    graph_id: str
    status: str


class StopRunResponse(BaseModel):
    """停止运行响应。"""

    model_config = ConfigDict(extra="forbid")

    run_id: str
    status: str


class RunStatusResponse(BaseModel):
    """运行状态响应。"""

    model_config = ConfigDict(extra="forbid")

    run_id: str
    graph_id: str
    status: str
    created_at: float
    started_at: float | None = None
    ended_at: float | None = None
    stream_id: str
    last_error: str | None = None
    task_done: bool
    metrics: dict[str, Any] = Field(default_factory=dict)
    node_states: dict[str, dict[str, Any]] = Field(default_factory=dict)
    edge_states: list[dict[str, Any]] = Field(default_factory=list)


class RunEventsResponse(BaseModel):
    """运行事件响应。"""

    model_config = ConfigDict(extra="forbid")

    run_id: str
    next_cursor: int
    count: int
    items: list[RuntimeEvent] = Field(default_factory=list)


class RunMetricsResponse(BaseModel):
    """运行指标视图响应。"""

    model_config = ConfigDict(extra="forbid")

    run_id: str
    graph_id: str
    status: str
    created_at: float
    started_at: float | None = None
    ended_at: float | None = None
    task_done: bool
    graph_metrics: dict[str, Any] = Field(default_factory=dict)
    node_metrics: dict[str, dict[str, Any]] = Field(default_factory=dict)
    edge_metrics: list[dict[str, Any]] = Field(default_factory=list)


class RunDiagnosticsResponse(BaseModel):
    """运行诊断视图响应。"""

    model_config = ConfigDict(extra="forbid")

    run_id: str
    graph_id: str
    status: str
    task_done: bool
    last_error: str | None = None
    failed_nodes: list[dict[str, Any]] = Field(default_factory=list)
    slow_nodes_top: list[dict[str, Any]] = Field(default_factory=list)
    edge_hotspots_top: list[dict[str, Any]] = Field(default_factory=list)
