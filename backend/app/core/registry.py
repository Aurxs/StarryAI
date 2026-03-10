"""阶段 A：节点类型注册中心。

注册中心职责：
1. 管理 NodeSpec（按 type_name 索引）。
2. 为图校验器提供节点类型查询能力。
3. 提供默认内置节点规格，便于前端和后端共享契约。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

from app.core.node_catalog import get_node_definitions
from app.core.node_discovery import NodeDiscoveryError

from .spec import NodeSpec


class RegistryError(ValueError):
    """节点注册中心相关异常。"""


@dataclass(slots=True)
class NodeTypeRegistry:
    """节点类型注册表。"""

    # 内部存储：type_name -> NodeSpec
    _specs: dict[str, NodeSpec] = field(default_factory=dict)

    def register(self, spec: NodeSpec, *, overwrite: bool = False) -> None:
        """注册一个节点类型。

        参数：
        - spec: 节点类型规范。
        - overwrite: 若为 True，允许覆盖同名类型。
        """
        if spec.type_name in self._specs and not overwrite:
            raise RegistryError(f"节点类型已存在: {spec.type_name}")
        self._specs[spec.type_name] = spec

    def bulk_register(self, specs: list[NodeSpec], *, overwrite: bool = False) -> None:
        """批量注册节点类型。"""
        for spec in specs:
            self.register(spec, overwrite=overwrite)

    def get(self, type_name: str) -> NodeSpec:
        """获取指定节点类型规范。"""
        try:
            return self._specs[type_name]
        except KeyError as exc:
            raise RegistryError(f"未找到节点类型: {type_name}") from exc

    def has(self, type_name: str) -> bool:
        """判断节点类型是否已注册。"""
        return type_name in self._specs

    def list_specs(self) -> list[NodeSpec]:
        """返回全部已注册节点规范。"""
        return list(self._specs.values())


def create_default_registry(
    *,
    package_name: str | None = "app.nodes",
    package_names: Sequence[str] | None = None,
    search_dirs: Sequence[str | Path] | None = None,
    strict: bool = True,
) -> NodeTypeRegistry:
    """创建默认注册中心并注入内置 mock 类型。

    设计目标：
    - 前端可直接拉取节点类型元数据进行渲染。
    - 后端 GraphBuilder 可直接据此做端口/schema 校验。
    """

    registry = NodeTypeRegistry()
    try:
        discovered_specs = _build_discovered_specs(
            package_name=package_name,
            package_names=package_names,
            search_dirs=search_dirs,
            strict=strict,
        )
    except NodeDiscoveryError as exc:
        raise RegistryError(f"节点发现失败: {exc}") from exc
    registry.bulk_register(discovered_specs)
    return registry


def _build_discovered_specs(
    *,
    package_name: str | None = "app.nodes",
    package_names: Sequence[str] | None = None,
    search_dirs: Sequence[str | Path] | None = None,
    strict: bool = True,
) -> list[NodeSpec]:
    definitions = get_node_definitions(
        package_name=package_name,
        package_names=package_names,
        search_dirs=search_dirs,
        strict=strict,
    )
    return [definition.spec_with_config_schema().model_copy(deep=True) for definition in definitions]
