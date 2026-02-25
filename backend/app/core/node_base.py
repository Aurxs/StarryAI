"""阶段 A: 节点抽象基类（非流式 MVP）。"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Any

from .spec import NodeSpec


@dataclass(slots=True)
class NodeContext:
    """节点运行上下文。

    阶段 A 仅保留最小字段，阶段 B 会补充 logger/metrics/runtime 状态。
    """

    run_id: str
    node_id: str
    metadata: dict[str, Any] = field(default_factory=dict)


class BaseNode(abc.ABC):
    """所有节点实现的抽象基类。

    非流式模式约定:
    - 输入为 `dict[input_port, Any]`
    - 输出为 `dict[output_port, Any]`
    - 只有 process 返回后，调度器才会把结果发往下游。
    """

    def __init__(self, node_id: str, spec: NodeSpec, config: dict[str, Any] | None = None) -> None:
        self.node_id = node_id
        self.spec = spec
        self.config = config or {}

    @abc.abstractmethod
    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        """处理一次节点输入并返回输出。"""
        raise NotImplementedError
