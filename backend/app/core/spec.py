"""阶段 A：节点规范与图定义模型。

这个文件定义“图是什么、节点能做什么、端口能接什么”的静态契约。
GraphBuilder 会基于这些契约进行编译前校验。
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

NONE_SCHEMA = "none"


def normalize_schema(schema: str) -> str:
    """规范化 schema 文本。"""
    return schema.strip().lower()


def is_none_schema(schema: str) -> bool:
    """判断是否为 none schema。"""
    return normalize_schema(schema) == NONE_SCHEMA


def is_sync_schema(schema: str) -> bool:
    """判断 schema 是否为同步封装类型。"""
    normalized = normalize_schema(schema)
    return normalized.endswith(".sync")


def base_schema(schema: str) -> str:
    """提取同步 schema 的基础类型。"""
    normalized = normalize_schema(schema)
    if is_sync_schema(normalized):
        return normalized[: -len(".sync")]
    return normalized


def to_sync_schema(schema: str) -> str:
    """将基础 schema 转换为同步 schema。"""
    normalized = base_schema(schema)
    if not normalized:
        return "any.sync"
    if normalized == "any":
        return "any.sync"
    return f"{normalized}.sync"


def is_schema_compatible(source_schema: str, target_schema: str) -> bool:
    """判断来源端口 schema 与目标端口 schema 是否兼容。"""
    src = normalize_schema(source_schema)
    dst = normalize_schema(target_schema)

    if is_none_schema(src) or is_none_schema(dst):
        return False

    if src == "any" or dst == "any":
        return True

    src_sync = is_sync_schema(src)
    dst_sync = is_sync_schema(dst)
    if src_sync != dst_sync:
        return False

    if src_sync and dst_sync:
        src_base = base_schema(src)
        dst_base = base_schema(dst)
        return src_base == "any" or dst_base == "any" or src_base == dst_base

    return src == dst


class NodeMode(str, Enum):
    """节点执行模式。"""

    # 非同步节点：输入齐备 -> 一次处理 -> 输出整体结果。
    ASYNC = "async"
    # 同步节点：需要多输入聚合并执行同步策略。
    SYNC = "sync"
    # 被动节点：仅声明可引用状态，不参与调度执行。
    PASSIVE = "passive"


class InputBehavior(str, Enum):
    """输入端口行为。"""

    # 正常接收并传递 payload。
    PAYLOAD = "payload"
    # 仅建立引用绑定，不等待上游 payload。
    REFERENCE = "reference"
    # 需要上游触发，但业务逻辑不消费其 payload。
    TRIGGER = "trigger"


class SyncStrategy(str, Enum):
    """同步节点策略类型。"""

    # 必需端口都到齐后才输出。
    BARRIER = "barrier"
    # 在指定时间窗口内合并多路输入。
    WINDOW_JOIN = "window_join"
    # 按统一时钟锁步调度。
    CLOCK_LOCK = "clock_lock"


class LatePolicy(str, Enum):
    """输入迟到时的处理策略。"""

    # 丢弃迟到数据，优先实时性。
    DROP = "drop"
    # 即使不完整也部分输出，优先连续性。
    EMIT_PARTIAL = "emit_partial"
    # 重新计算时间戳后输出，优先完整性。
    RECLOCK = "reclock"


class SyncRole(str, Enum):
    """同步节点角色。"""

    INITIATOR = "initiator"
    EXECUTOR = "executor"


class PortSpec(BaseModel):
    """端口规范。

    说明：
    - 每个端口有明确的名称和 schema。
    - schema 可用于连线兼容校验。
    - `any` 可作为通配 schema（接收任意类型）。
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, description="端口名称")
    frame_schema: str = Field(default="any", min_length=1, description="数据 schema")
    is_stream: bool = Field(default=False, description="是否流式端口")
    required: bool = Field(default=True, description="是否必填/必连")
    description: str = Field(default="", description="端口说明")
    input_behavior: InputBehavior = Field(
        default=InputBehavior.PAYLOAD,
        description="输入端口行为",
    )
    # 仅用于输出端口：声明“此输出 schema 由某输入口动态推导”。
    derived_from_input: str | None = Field(default=None, description="动态 schema 来源输入口")


class SyncConfig(BaseModel):
    """同步节点配置。

    - required_ports: 同步前必须具备的输入端口。
    - strategy: 同步策略。
    - window_ms: 时间窗口（主要用于 WINDOW_JOIN）。
    - late_policy: 迟到消息处理策略。
    """

    model_config = ConfigDict(extra="forbid")

    required_ports: list[str] = Field(default_factory=list)
    strategy: SyncStrategy = Field(default=SyncStrategy.BARRIER)
    window_ms: int = Field(default=40, ge=1)
    late_policy: LatePolicy = Field(default=LatePolicy.DROP)
    role: SyncRole = Field(default=SyncRole.EXECUTOR)
    sync_group: str | None = Field(default=None)
    commit_lead_ms: int = Field(default=50, ge=1)
    ready_timeout_ms: int = Field(default=800, ge=1)


class NodeSpec(BaseModel):
    """节点类型规范。

    NodeSpec 描述的是“节点类型”，不是图中的具体实例。
    图中的实例会通过 NodeInstanceSpec 引用这里的 type_name。
    """

    model_config = ConfigDict(extra="forbid")

    type_name: str = Field(..., min_length=1, description="节点类型名")
    version: str = Field(default="0.1.0", min_length=1, description="类型版本")
    mode: NodeMode = Field(default=NodeMode.ASYNC, description="执行模式")

    inputs: list[PortSpec] = Field(default_factory=list, description="输入端口列表")
    outputs: list[PortSpec] = Field(default_factory=list, description="输出端口列表")

    sync_config: SyncConfig | None = Field(default=None, description="同步配置")
    config_schema: dict[str, Any] = Field(default_factory=dict, description="配置模式")
    description: str = Field(default="", description="节点说明")
    tags: list[str] = Field(default_factory=list, description="节点标签")

    @model_validator(mode="after")
    def validate_ports_and_mode(self) -> "NodeSpec":
        """校验节点规范内部一致性。

        校验点：
        1. 输入端口名称不可重复。
        2. 输出端口名称不可重复。
        3. sync 模式必须有 sync_config。
        4. async 模式不能声明 sync_config。
        5. sync_config.required_ports 必须全部出现在 inputs 中。
        """
        input_names = [port.name for port in self.inputs]
        output_names = [port.name for port in self.outputs]

        if len(input_names) != len(set(input_names)):
            raise ValueError(f"NodeSpec[{self.type_name}] inputs 存在重名端口")
        if len(output_names) != len(set(output_names)):
            raise ValueError(f"NodeSpec[{self.type_name}] outputs 存在重名端口")

        for input_port in self.inputs:
            if is_none_schema(input_port.frame_schema):
                raise ValueError(
                    f"NodeSpec[{self.type_name}] 输入口 {input_port.name} 不能使用 none schema"
                )
            if input_port.derived_from_input is not None:
                raise ValueError(
                    f"NodeSpec[{self.type_name}] 输入口 {input_port.name} 不允许声明 derived_from_input"
                )

        available_inputs = {port.name for port in self.inputs}
        for output_port in self.outputs:
            if output_port.derived_from_input is None:
                continue
            if output_port.derived_from_input not in available_inputs:
                raise ValueError(
                    f"NodeSpec[{self.type_name}] 输出口 {output_port.name} 的 derived_from_input "
                    f"不存在: {output_port.derived_from_input}"
                )
            if not output_port.frame_schema.strip():
                raise ValueError(
                    f"NodeSpec[{self.type_name}] 输出口 {output_port.name} 声明了 derived_from_input，"
                    "其 frame_schema 不能为空"
                )

        if self.mode == NodeMode.SYNC and self.sync_config is None:
            raise ValueError(f"NodeSpec[{self.type_name}] 为 sync 模式但缺少 sync_config")

        if self.mode == NodeMode.ASYNC and self.sync_config is not None:
            raise ValueError(f"NodeSpec[{self.type_name}] 为 async 模式，不应声明 sync_config")

        if self.mode == NodeMode.PASSIVE and self.sync_config is not None:
            raise ValueError(f"NodeSpec[{self.type_name}] 为 passive 模式，不应声明 sync_config")

        if self.sync_config:
            missing_ports = [
                port for port in self.sync_config.required_ports if port not in available_inputs
            ]
            if missing_ports:
                raise ValueError(
                    f"NodeSpec[{self.type_name}] sync_config.required_ports 包含不存在输入口: "
                    f"{missing_ports}"
                )
        return self


class NodeInstanceSpec(BaseModel):
    """图中的节点实例定义。"""

    model_config = ConfigDict(extra="forbid")

    node_id: str = Field(..., min_length=1, description="节点实例 ID")
    type_name: str = Field(..., min_length=1, description="引用的节点类型名")
    title: str = Field(default="", description="展示名称")
    config: dict[str, Any] = Field(default_factory=dict, description="实例级配置")


class EdgeSpec(BaseModel):
    """图中的有向边定义。"""

    model_config = ConfigDict(extra="forbid")

    source_node: str = Field(..., min_length=1, description="来源节点 ID")
    source_port: str = Field(..., min_length=1, description="来源输出端口")
    target_node: str = Field(..., min_length=1, description="目标节点 ID")
    target_port: str = Field(..., min_length=1, description="目标输入端口")
    queue_maxsize: int = Field(default=0, ge=0, description="边队列大小，0 表示无界")


class GraphSpec(BaseModel):
    """工作流图定义。"""

    model_config = ConfigDict(extra="forbid")

    graph_id: str = Field(..., min_length=1, description="图 ID")
    version: str = Field(default="0.1.0", min_length=1, description="图版本")
    nodes: list[NodeInstanceSpec] = Field(default_factory=list, description="节点实例列表")
    edges: list[EdgeSpec] = Field(default_factory=list, description="连线列表")
    metadata: dict[str, Any] = Field(default_factory=dict, description="扩展信息")

    @model_validator(mode="after")
    def validate_unique_node_ids(self) -> "GraphSpec":
        """保证图内节点 ID 唯一。"""
        node_ids = [node.node_id for node in self.nodes]
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("GraphSpec nodes 存在重复 node_id")
        return self


class ValidationIssue(BaseModel):
    """图校验问题条目。"""

    model_config = ConfigDict(extra="forbid")

    level: Literal["error", "warning"] = Field(..., description="级别")
    code: str = Field(..., description="问题编码")
    message: str = Field(..., description="问题描述")


class GraphValidationReport(BaseModel):
    """图校验报告。"""

    model_config = ConfigDict(extra="forbid")

    graph_id: str = Field(..., description="图 ID")
    valid: bool = Field(..., description="是否通过校验")
    issues: list[ValidationIssue] = Field(default_factory=list, description="问题列表")
