"""阶段 A：节点抽象基类。

非流式约定：
- 输入为 `dict[input_port, Any]`
- 输出为 `dict[output_port, Any]`
- process 结束后统一输出
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Any

from .spec import NodeSpec


@dataclass(slots=True)
class NodeContext:
    """节点运行上下文。"""

    # 当前运行实例 ID。
    run_id: str
    # 当前节点实例 ID。
    node_id: str
    # 扩展上下文（例如 stream_id、trace_id、调试信息）。
    metadata: dict[str, Any] = field(default_factory=dict)


class BaseNode(abc.ABC):
    """所有节点实现的抽象基类。"""

    def __init__(self, node_id: str, spec: NodeSpec, config: dict[str, Any] | None = None) -> None:
        """初始化节点实例。

        参数：
        - node_id: 图内节点实例 ID。
        - spec: 对应节点类型规范。
        - config: 节点实例配置。
        """
        self.node_id = node_id
        self.spec = spec
        self.config = config or {}

    @abc.abstractmethod
    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        """执行节点处理逻辑。

        返回值键必须来自 NodeSpec.outputs 中声明的端口名。
        """
        raise NotImplementedError
