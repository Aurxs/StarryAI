"""节点单文件定义协议。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypeAlias

from pydantic import BaseModel

from .node_base import BaseNode
from .spec import NodeSpec

ConfigModelType: TypeAlias = type[BaseModel]


@dataclass(frozen=True, slots=True)
class NodeDefinition:
    """节点定义聚合对象。

    - `spec`: 节点类型规范。
    - `impl_cls`: 节点实现类。
    - `config_model`: 节点配置模型（可选）。
    """

    spec: NodeSpec
    impl_cls: type[BaseNode]
    config_model: ConfigModelType | None = None

    def spec_with_config_schema(self) -> NodeSpec:
        """返回补齐配置 schema 的 NodeSpec。"""
        if self.config_model is None:
            return self.spec
        if self.spec.config_schema:
            return self.spec
        return self.spec.model_copy(update={"config_schema": self.config_model.model_json_schema()})
