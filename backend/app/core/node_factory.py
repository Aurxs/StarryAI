"""节点实例工厂（Phase B）。

职责：
1. 维护 type_name -> 节点实现类映射。
2. 基于图中的 NodeInstanceSpec 与 NodeSpec 创建运行时节点实例。
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.core.node_base import BaseNode
from app.core.node_discovery import NodeDiscoveryError, discover_node_definitions
from app.core.spec import NodeInstanceSpec, NodeSpec


class NodeFactoryError(ValueError):
    """节点工厂异常。"""


@dataclass(slots=True)
class NodeFactory:
    """节点实例工厂。"""

    _impls: dict[str, type[BaseNode]] = field(default_factory=dict)
    _config_resolver: Callable[[NodeInstanceSpec, NodeSpec], dict[str, Any]] | None = None

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
        config = node.config
        if self._config_resolver is not None:
            config = self._config_resolver(node, spec)
        return impl_cls(node_id=node.node_id, spec=spec, config=config)


def create_default_node_factory(
    *,
    package_name: str | None = "app.nodes",
    package_names: Sequence[str] | None = None,
    search_dirs: Sequence[str | Path] | None = None,
    strict: bool = True,
    config_resolver: Callable[[NodeInstanceSpec, NodeSpec], dict[str, Any]] | None = None,
) -> NodeFactory:
    """创建默认节点工厂并注入内置节点实现。"""
    factory = NodeFactory(_config_resolver=config_resolver)
    try:
        discovered_mappings = _build_discovered_mappings(
            package_name=package_name,
            package_names=package_names,
            search_dirs=search_dirs,
            strict=strict,
        )
    except NodeDiscoveryError as exc:
        raise NodeFactoryError(f"节点发现失败: {exc}") from exc
    factory.bulk_register(discovered_mappings)
    return factory


def _build_discovered_mappings(
    *,
    package_name: str | None = "app.nodes",
    package_names: Sequence[str] | None = None,
    search_dirs: Sequence[str | Path] | None = None,
    strict: bool = True,
) -> dict[str, type[BaseNode]]:
    mappings: dict[str, type[BaseNode]] = {}
    definitions = discover_node_definitions(
        package_name=package_name,
        package_names=package_names,
        search_dirs=search_dirs,
        strict=strict,
    )
    for definition in definitions:
        mappings[definition.spec.type_name] = definition.impl_cls
    return mappings
