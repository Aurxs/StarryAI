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

from pydantic import BaseModel, ValidationError

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

    # 可由子类覆盖，用于声明强类型配置模型。
    ConfigModel: type[BaseModel] | None = None

    def __init__(self, node_id: str, spec: NodeSpec, config: dict[str, Any] | None = None) -> None:
        """初始化节点实例。

        参数：
        - node_id: 图内节点实例 ID。
        - spec: 对应节点类型规范。
        - config: 节点实例配置。
        """
        self.node_id = node_id
        self.spec = spec
        self.raw_config = config or {}
        # 保持兼容：未迁移节点仍可通过 self.config 读取原始 dict。
        self.config = self.raw_config
        self.cfg = self.validate_config(self.raw_config)

    @classmethod
    def get_config_model(cls) -> type[BaseModel] | None:
        """返回节点配置模型。"""
        return cls.ConfigModel

    @classmethod
    def config_schema(cls) -> dict[str, Any]:
        """返回配置模型 JSON Schema。"""
        model_cls = cls.get_config_model()
        if model_cls is None:
            return {}
        return model_cls.model_json_schema()

    @classmethod
    def validate_config(cls, raw_config: dict[str, Any]) -> BaseModel | dict[str, Any]:
        """按配置模型校验原始配置。"""
        model_cls = cls.get_config_model()
        if model_cls is None:
            return raw_config
        try:
            return model_cls.model_validate(raw_config)
        except ValidationError as exc:
            raise ValueError(f"{cls.__name__} 配置校验失败: {exc}") from exc

    @abc.abstractmethod
    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        """执行节点处理逻辑。

        返回值键必须来自 NodeSpec.outputs 中声明的端口名。
        """
        raise NotImplementedError
