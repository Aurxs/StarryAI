"""spec / registry / node factory 组合测试。"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.node_factory import NodeFactory, NodeFactoryError, create_default_node_factory
from app.core.registry import RegistryError, create_default_registry
from app.core.spec import (
    GraphSpec,
    NodeInstanceSpec,
    NodeMode,
    NodeSpec,
    PortSpec,
    SyncConfig,
)
from app.nodes.mock_input import MockInputNode


def test_nodespec_rejects_duplicate_input_port_names() -> None:
    """NodeSpec 输入端口名不能重复。"""
    with pytest.raises(ValidationError):
        NodeSpec(
            type_name="dup.input",
            mode=NodeMode.ASYNC,
            inputs=[PortSpec(name="in"), PortSpec(name="in")],
            outputs=[PortSpec(name="out")],
        )


def test_nodespec_sync_mode_requires_sync_config() -> None:
    """sync 模式必须提供 sync_config。"""
    with pytest.raises(ValidationError):
        NodeSpec(
            type_name="sync.without.config",
            mode=NodeMode.SYNC,
            inputs=[PortSpec(name="in")],
            outputs=[PortSpec(name="out")],
        )


def test_nodespec_async_mode_forbids_sync_config() -> None:
    """async 模式不能声明 sync_config。"""
    with pytest.raises(ValidationError):
        NodeSpec(
            type_name="async.with.config",
            mode=NodeMode.ASYNC,
            inputs=[PortSpec(name="in")],
            outputs=[PortSpec(name="out")],
            sync_config=SyncConfig(required_ports=["in"]),
        )


def test_nodespec_sync_required_ports_must_exist() -> None:
    """sync_config.required_ports 必须存在于输入端口列表。"""
    with pytest.raises(ValidationError):
        NodeSpec(
            type_name="sync.bad.required",
            mode=NodeMode.SYNC,
            inputs=[PortSpec(name="audio")],
            outputs=[PortSpec(name="out")],
            sync_config=SyncConfig(required_ports=["audio", "motion"]),
        )


def test_graphspec_rejects_duplicate_node_ids() -> None:
    """GraphSpec 内 node_id 必须唯一。"""
    with pytest.raises(ValidationError):
        GraphSpec(
            graph_id="g_dup",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(node_id="n1", type_name="mock.output"),
            ],
            edges=[],
        )


def test_registry_default_types_and_duplicate_registration() -> None:
    """默认注册中心应包含内置类型，重复注册应报错。"""
    registry = create_default_registry()
    type_names = {spec.type_name for spec in registry.list_specs()}
    assert {
        "mock.input",
        "mock.llm",
        "mock.tts",
        "mock.motion",
        "sync.timeline",
        "mock.output",
    }.issubset(type_names)

    with pytest.raises(RegistryError):
        registry.register(registry.get("mock.input"))


def test_node_factory_creates_known_node_and_rejects_unknown() -> None:
    """节点工厂应能创建已注册实现，并拒绝未知实现。"""
    registry = create_default_registry()
    factory = create_default_node_factory()
    node = factory.create(
        node=NodeInstanceSpec(node_id="n1", type_name="mock.input"),
        spec=registry.get("mock.input"),
    )
    assert isinstance(node, MockInputNode)

    with pytest.raises(NodeFactoryError):
        factory.create(
            node=NodeInstanceSpec(node_id="nX", type_name="unknown.type"),
            spec=registry.get("mock.input"),
        )


def test_node_factory_duplicate_registration_without_overwrite_fails() -> None:
    """NodeFactory 默认不允许同名重复注册。"""
    factory = NodeFactory()
    factory.register("mock.input", MockInputNode)
    with pytest.raises(NodeFactoryError):
        factory.register("mock.input", MockInputNode)
