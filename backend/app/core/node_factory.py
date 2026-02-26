"""节点实例工厂（Phase B）。

职责：
1. 维护 type_name -> 节点实现类映射。
2. 基于图中的 NodeInstanceSpec 与 NodeSpec 创建运行时节点实例。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from app.core.node_base import BaseNode
from app.core.spec import NodeInstanceSpec, NodeSpec
from app.nodes import (
    MockInputNode,
    MockLLMNode,
    MockMotionNode,
    MockOutputNode,
    MockTTSNode,
    TimelineSyncNode,
)


class NodeFactoryError(ValueError):
    """节点工厂异常。"""


@dataclass(slots=True)
class NodeFactory:
    """节点实例工厂。"""

    _impls: dict[str, type[BaseNode]] = field(default_factory=dict)

    def register(self, type_name: str, impl_cls: type[BaseNode], *, overwrite: bool = False) -> None:
        """注册节点实现类。"""
        if type_name in self._impls and not overwrite:
            raise NodeFactoryError(f"节点实现已存在: {type_name}")
        self._impls[type_name] = impl_cls

    def bulk_register(
            self, mappings: Mapping[str, type[BaseNode]], *, overwrite: bool = False
    ) -> None:
        """批量注册节点实现类。"""
        for type_name, impl_cls in mappings.items():
            self.register(type_name=type_name, impl_cls=impl_cls, overwrite=overwrite)

    def create(self, node: NodeInstanceSpec, spec: NodeSpec) -> BaseNode:
        """创建节点实例。"""
        try:
            impl_cls = self._impls[node.type_name]
        except KeyError as exc:
            raise NodeFactoryError(f"未找到节点实现: {node.type_name}") from exc
        return impl_cls(node_id=node.node_id, spec=spec, config=node.config)


def create_default_node_factory() -> NodeFactory:
    """创建默认节点工厂并注入内置节点实现。"""
    factory = NodeFactory()
    factory.bulk_register(
        {
            "mock.input": MockInputNode,
            "mock.llm": MockLLMNode,
            "mock.tts": MockTTSNode,
            "mock.motion": MockMotionNode,
            "sync.timeline": TimelineSyncNode,
            "mock.output": MockOutputNode,
        }
    )
    return factory
