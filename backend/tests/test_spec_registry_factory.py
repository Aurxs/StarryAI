"""spec / registry / node factory 组合测试。"""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

import app.core.node_factory as node_factory_module
import app.core.registry as registry_module
from app.core.node_discovery import NODE_SEARCH_DIRS_ENV, NodeDiscoveryError
from app.core.node_factory import (
    NodeFactory,
    NodeFactoryError,
    create_default_node_factory,
)
from app.core.registry import (
    RegistryError,
    create_default_registry,
)
from app.core.spec import (
    GraphSpec,
    NodeInstanceSpec,
    NodeMode,
    NodeSpec,
    PortSpec,
    SyncConfig,
    SyncRole,
)
from app.nodes.mock_input import MockInputNode


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


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


def test_nodespec_rejects_none_on_input_ports() -> None:
    """输入端口不允许使用 none schema。"""
    with pytest.raises(ValidationError):
        NodeSpec(
            type_name="bad.none.input",
            mode=NodeMode.ASYNC,
            inputs=[PortSpec(name="in", frame_schema="none")],
            outputs=[],
        )


def test_nodespec_rejects_invalid_derived_output_binding() -> None:
    """动态输出绑定必须指向已存在输入，且输出 schema 为 *.sync。"""
    with pytest.raises(ValidationError):
        NodeSpec(
            type_name="bad.dynamic.output",
            mode=NodeMode.SYNC,
            inputs=[PortSpec(name="in_a", frame_schema="any")],
            outputs=[
                PortSpec(
                    name="out_a",
                    frame_schema="any",
                    derived_from_input="in_x",
                )
            ],
            sync_config=SyncConfig(required_ports=["in_a"], role=SyncRole.INITIATOR),
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
        "llm.openai_compatible",
        "mock.input",
        "mock.llm",
        "mock.tts",
        "mock.motion",
        "sync.initiator.dual",
        "audio.play.base",
        "audio.play.sync",
        "motion.play.sync",
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


def test_registry_raises_when_discovery_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _raise_discovery_error(*_args: object, **_kwargs: object) -> list[object]:
        raise NodeDiscoveryError("boom")

    monkeypatch.setattr(registry_module, "discover_node_definitions", _raise_discovery_error)
    with pytest.raises(RegistryError, match="节点发现失败"):
        create_default_registry()


def test_factory_raises_when_discovery_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _raise_discovery_error(*_args: object, **_kwargs: object) -> list[object]:
        raise NodeDiscoveryError("boom")

    monkeypatch.setattr(node_factory_module, "discover_node_definitions", _raise_discovery_error)
    with pytest.raises(NodeFactoryError, match="节点发现失败"):
        create_default_node_factory()


def test_registry_uses_strict_discovery_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[bool] = []

    def _fake_discovery(*_args: object, **kwargs: object) -> list[object]:
        called.append(bool(kwargs.get("strict")))
        return []

    monkeypatch.setattr(registry_module, "discover_node_definitions", _fake_discovery)
    registry = create_default_registry()
    assert called == [True]
    assert registry.list_specs() == []


def test_factory_uses_strict_discovery_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[bool] = []

    def _fake_discovery(*_args: object, **kwargs: object) -> list[object]:
        called.append(bool(kwargs.get("strict")))
        return []

    monkeypatch.setattr(node_factory_module, "discover_node_definitions", _fake_discovery)
    factory = create_default_node_factory()
    assert called == [True]
    with pytest.raises(NodeFactoryError):
        factory.create(
            node=NodeInstanceSpec(node_id="n1", type_name="mock.input"),
            spec=NodeSpec(type_name="mock.input", mode=NodeMode.ASYNC, inputs=[], outputs=[]),
        )


def test_registry_and_factory_load_custom_nodes_from_explicit_search_dirs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    custom_root = tmp_path / "custom_nodes_explicit"
    _write(
        custom_root / "custom_explicit.py",
        """
from typing import Any
from app.core.node_async import AsyncNode
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec

class CustomExplicitNode(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        return {}

NODE_DEFINITION = NodeDefinition(
    spec=NodeSpec(type_name="custom.explicit", mode=NodeMode.ASYNC, inputs=[], outputs=[]),
    impl_cls=CustomExplicitNode,
)
""",
    )
    monkeypatch.delenv(NODE_SEARCH_DIRS_ENV, raising=False)

    registry = create_default_registry(package_name=None, search_dirs=[custom_root], strict=True)
    factory = create_default_node_factory(package_name=None, search_dirs=[custom_root], strict=True)

    spec = registry.get("custom.explicit")
    node = factory.create(
        node=NodeInstanceSpec(node_id="n_custom", type_name="custom.explicit"),
        spec=spec,
    )
    assert node.__class__.__name__ == "CustomExplicitNode"


def test_registry_and_factory_load_custom_nodes_from_env_dirs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    custom_root = tmp_path / "custom_nodes_env"
    _write(
        custom_root / "custom_env.py",
        """
from typing import Any
from app.core.node_async import AsyncNode
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec

class CustomEnvNode(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        return {}

NODE_DEFINITION = NodeDefinition(
    spec=NodeSpec(type_name="custom.env.registry", mode=NodeMode.ASYNC, inputs=[], outputs=[]),
    impl_cls=CustomEnvNode,
)
""",
    )
    monkeypatch.setenv(NODE_SEARCH_DIRS_ENV, str(custom_root))

    registry = create_default_registry(package_name=None, strict=True)
    factory = create_default_node_factory(package_name=None, strict=True)

    spec = registry.get("custom.env.registry")
    node = factory.create(
        node=NodeInstanceSpec(node_id="n_env", type_name="custom.env.registry"),
        spec=spec,
    )
    assert node.__class__.__name__ == "CustomEnvNode"


def test_registry_forwards_discovery_kwargs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, object] = {}

    def _fake_discovery(*_args: object, **kwargs: object) -> list[object]:
        captured.update(kwargs)
        return []

    monkeypatch.setattr(registry_module, "discover_node_definitions", _fake_discovery)
    create_default_registry(
        package_name=None,
        package_names=["pkg.a", "pkg.b"],
        search_dirs=[tmp_path],
        strict=False,
    )
    assert captured == {
        "package_name": None,
        "package_names": ["pkg.a", "pkg.b"],
        "search_dirs": [tmp_path],
        "strict": False,
    }


def test_factory_forwards_discovery_kwargs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, object] = {}

    def _fake_discovery(*_args: object, **kwargs: object) -> list[object]:
        captured.update(kwargs)
        return []

    monkeypatch.setattr(node_factory_module, "discover_node_definitions", _fake_discovery)
    create_default_node_factory(
        package_name=None,
        package_names=["pkg.a", "pkg.b"],
        search_dirs=[tmp_path],
        strict=False,
    )
    assert captured == {
        "package_name": None,
        "package_names": ["pkg.a", "pkg.b"],
        "search_dirs": [tmp_path],
        "strict": False,
    }
