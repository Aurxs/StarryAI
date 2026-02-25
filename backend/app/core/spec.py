"""阶段 A: 节点规范与图定义模型。"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class NodeMode(str, Enum):
    """节点工作模式。"""

    ASYNC = "async"  # 非同步节点：处理完成后向后传递
    SYNC = "sync"    # 同步节点：聚合多个输入并按策略对齐


class SyncStrategy(str, Enum):
    """同步策略。"""

    BARRIER = "barrier"         # 等所有必需端口齐备再放行
    WINDOW_JOIN = "window_join" # 时间窗内聚合
    CLOCK_LOCK = "clock_lock"   # 按统一时钟调度


class LatePolicy(str, Enum):
    """迟到数据策略。"""

    DROP = "drop"
    EMIT_PARTIAL = "emit_partial"
    RECLOCK = "reclock"


class PortSpec(BaseModel):
    """端口规范。

    frame_schema:
    - 推荐使用语义化字符串，如 "text.final", "audio.segment", "motion.timeline"。
    - "any" 表示兼容任意 schema。
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1)
    frame_schema: str = Field(default="any", min_length=1)
    is_stream: bool = Field(default=False)
    required: bool = Field(default=True)
    description: str = Field(default="")


class SyncConfig(BaseModel):
    """同步节点配置。"""

    model_config = ConfigDict(extra="forbid")

    required_ports: list[str] = Field(default_factory=list)
    strategy: SyncStrategy = Field(default=SyncStrategy.BARRIER)
    window_ms: int = Field(default=40, ge=1)
    late_policy: LatePolicy = Field(default=LatePolicy.DROP)


class NodeSpec(BaseModel):
    """节点类型规范（定义节点“能接什么、会产出什么”）。"""

    model_config = ConfigDict(extra="forbid")

    type_name: str = Field(..., min_length=1)
    version: str = Field(default="0.1.0", min_length=1)
    mode: NodeMode = Field(default=NodeMode.ASYNC)

    inputs: list[PortSpec] = Field(default_factory=list)
    outputs: list[PortSpec] = Field(default_factory=list)

    sync_config: SyncConfig | None = Field(default=None)
    config_schema: dict[str, Any] = Field(default_factory=dict)
    description: str = Field(default="")

    @model_validator(mode="after")
    def validate_ports_and_mode(self) -> "NodeSpec":
        input_names = [p.name for p in self.inputs]
        output_names = [p.name for p in self.outputs]
        if len(input_names) != len(set(input_names)):
            raise ValueError(f"NodeSpec[{self.type_name}] inputs 存在重名端口")
        if len(output_names) != len(set(output_names)):
            raise ValueError(f"NodeSpec[{self.type_name}] outputs 存在重名端口")

        if self.mode == NodeMode.SYNC and self.sync_config is None:
            raise ValueError(f"NodeSpec[{self.type_name}] 为 sync 模式但缺少 sync_config")

        if self.mode == NodeMode.ASYNC and self.sync_config is not None:
            raise ValueError(f"NodeSpec[{self.type_name}] 为 async 模式，不应声明 sync_config")

        if self.sync_config:
            available_inputs = {p.name for p in self.inputs}
            missing = [p for p in self.sync_config.required_ports if p not in available_inputs]
            if missing:
                raise ValueError(
                    f"NodeSpec[{self.type_name}] sync_config.required_ports 包含不存在输入口: {missing}"
                )
        return self


class NodeInstanceSpec(BaseModel):
    """图中的节点实例定义。"""

    model_config = ConfigDict(extra="forbid")

    node_id: str = Field(..., min_length=1)
    type_name: str = Field(..., min_length=1)
    title: str = Field(default="")
    config: dict[str, Any] = Field(default_factory=dict)


class EdgeSpec(BaseModel):
    """图中的有向边定义。"""

    model_config = ConfigDict(extra="forbid")

    source_node: str = Field(..., min_length=1)
    source_port: str = Field(..., min_length=1)
    target_node: str = Field(..., min_length=1)
    target_port: str = Field(..., min_length=1)
    queue_maxsize: int = Field(default=0, ge=0)


class GraphSpec(BaseModel):
    """工作流图定义。"""

    model_config = ConfigDict(extra="forbid")

    graph_id: str = Field(..., min_length=1)
    version: str = Field(default="0.1.0", min_length=1)
    nodes: list[NodeInstanceSpec] = Field(default_factory=list)
    edges: list[EdgeSpec] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_unique_node_ids(self) -> "GraphSpec":
        node_ids = [n.node_id for n in self.nodes]
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("GraphSpec nodes 存在重复 node_id")
        return self


class ValidationIssue(BaseModel):
    """图校验结果条目。"""

    model_config = ConfigDict(extra="forbid")

    level: Literal["error", "warning"]
    code: str
    message: str


class GraphValidationReport(BaseModel):
    """图校验报告。"""

    model_config = ConfigDict(extra="forbid")

    graph_id: str
    valid: bool
    issues: list[ValidationIssue] = Field(default_factory=list)
