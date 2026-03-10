"""spec / registry / node factory 组合测试。"""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

import app.core.node_catalog as node_catalog_module
from app.core.node_catalog import get_node_definitions, reset_node_catalog_cache
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


@pytest.fixture(autouse=True)
def _reset_node_catalog() -> None:
    reset_node_catalog_cache()
    yield
    reset_node_catalog_cache()


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
        "llm.chat",
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

    monkeypatch.setattr(node_catalog_module, "discover_node_definitions", _raise_discovery_error)
    with pytest.raises(RegistryError, match="节点发现失败"):
        create_default_registry()


def test_factory_raises_when_discovery_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _raise_discovery_error(*_args: object, **_kwargs: object) -> list[object]:
        raise NodeDiscoveryError("boom")

    monkeypatch.setattr(node_catalog_module, "discover_node_definitions", _raise_discovery_error)
    with pytest.raises(NodeFactoryError, match="节点发现失败"):
        create_default_node_factory()


def test_registry_uses_strict_discovery_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[bool] = []

    def _fake_discovery(*_args: object, **kwargs: object) -> list[object]:
        called.append(bool(kwargs.get("strict")))
        return []

    monkeypatch.setattr(node_catalog_module, "discover_node_definitions", _fake_discovery)
    registry = create_default_registry()
    assert called == [True]
    assert registry.list_specs() == []


def test_factory_uses_strict_discovery_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[bool] = []

    def _fake_discovery(*_args: object, **kwargs: object) -> list[object]:
        called.append(bool(kwargs.get("strict")))
        return []

    monkeypatch.setattr(node_catalog_module, "discover_node_definitions", _fake_discovery)
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


def test_registry_and_factory_share_discovery_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    def _fake_discovery(*_args: object, **kwargs: object) -> list[object]:
        calls.append(dict(kwargs))
        return []

    monkeypatch.setattr(node_catalog_module, "discover_node_definitions", _fake_discovery)

    registry = create_default_registry()
    factory = create_default_node_factory()

    assert registry.list_specs() == []
    with pytest.raises(NodeFactoryError):
        factory.create(
            node=NodeInstanceSpec(node_id="n1", type_name="mock.input"),
            spec=NodeSpec(type_name="mock.input", mode=NodeMode.ASYNC, inputs=[], outputs=[]),
        )
    assert len(calls) == 1


def test_registry_returns_deep_copied_specs_across_calls() -> None:
    first_registry = create_default_registry()
    second_registry = create_default_registry()

    first_spec = first_registry.get("mock.llm")
    second_spec = second_registry.get("mock.llm")

    assert first_spec is not second_spec
    first_spec.config_schema["title"] = "changed"
    assert second_spec.config_schema.get("title") != "changed"


def test_node_catalog_refreshes_after_env_change_when_cache_is_reset(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    first_root = tmp_path / "env_nodes_first"
    second_root = tmp_path / "env_nodes_second"
    _write(
        first_root / "node_a.py",
        """
from typing import Any
from app.core.node_async import AsyncNode
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec

class EnvNodeA(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        return {}

NODE_DEFINITION = NodeDefinition(
    spec=NodeSpec(type_name="custom.env.a", mode=NodeMode.ASYNC, inputs=[], outputs=[]),
    impl_cls=EnvNodeA,
)
""",
    )
    _write(
        second_root / "node_b.py",
        """
from typing import Any
from app.core.node_async import AsyncNode
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec

class EnvNodeB(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        return {}

NODE_DEFINITION = NodeDefinition(
    spec=NodeSpec(type_name="custom.env.b", mode=NodeMode.ASYNC, inputs=[], outputs=[]),
    impl_cls=EnvNodeB,
)
""",
    )

    monkeypatch.setenv(NODE_SEARCH_DIRS_ENV, str(first_root))
    reset_node_catalog_cache()
    first_registry = create_default_registry(package_name=None, strict=True)
    assert {spec.type_name for spec in first_registry.list_specs()} == {"custom.env.a"}

    monkeypatch.setenv(NODE_SEARCH_DIRS_ENV, str(second_root))
    reset_node_catalog_cache()
    second_registry = create_default_registry(package_name=None, strict=True)
    assert {spec.type_name for spec in second_registry.list_specs()} == {"custom.env.b"}


def test_node_catalog_reloads_edited_custom_node_module_after_cache_reset(
    tmp_path: Path,
) -> None:
    custom_root = tmp_path / "edited_nodes"
    node_file = custom_root / "demo_node.py"
    _write(
        node_file,
        """
from typing import Any
from app.core.node_async import AsyncNode
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec

class DemoNodeV1(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        return {"version": "v1"}

NODE_DEFINITION = NodeDefinition(
    spec=NodeSpec(type_name="custom.reload.same_path", mode=NodeMode.ASYNC, inputs=[], outputs=[]),
    impl_cls=DemoNodeV1,
)
""",
    )

    first_definitions = get_node_definitions(
        package_name=None,
        search_dirs=[custom_root],
        strict=True,
    )
    assert [definition.spec.type_name for definition in first_definitions] == [
        "custom.reload.same_path"
    ]
    assert first_definitions[0].impl_cls.__name__ == "DemoNodeV1"

    _write(
        node_file,
        """
from typing import Any
from app.core.node_async import AsyncNode
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec

class DemoNodeVersionTwo(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        return {"version": "version-two-loaded-after-reset"}

NODE_DEFINITION = NodeDefinition(
    spec=NodeSpec(type_name="custom.reload.same_path", mode=NodeMode.ASYNC, inputs=[], outputs=[]),
    impl_cls=DemoNodeVersionTwo,
)
""",
    )

    reset_node_catalog_cache()
    second_definitions = get_node_definitions(
        package_name=None,
        search_dirs=[custom_root],
        strict=True,
    )
    assert [definition.spec.type_name for definition in second_definitions] == [
        "custom.reload.same_path"
    ]
    assert second_definitions[0].impl_cls.__name__ == "DemoNodeVersionTwo"


def test_node_catalog_reloads_edited_custom_node_module_without_cache_reset(
    tmp_path: Path,
) -> None:
    custom_root = tmp_path / "edited_nodes_auto"
    node_file = custom_root / "demo_node.py"
    _write(
        node_file,
        """
from typing import Any
from app.core.node_async import AsyncNode
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec

class DemoNodeV1(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        return {"version": "v1"}

NODE_DEFINITION = NodeDefinition(
    spec=NodeSpec(type_name="custom.reload.auto", mode=NodeMode.ASYNC, inputs=[], outputs=[]),
    impl_cls=DemoNodeV1,
)
""",
    )

    first_definitions = get_node_definitions(
        package_name=None,
        search_dirs=[custom_root],
        strict=True,
    )
    assert first_definitions[0].impl_cls.__name__ == "DemoNodeV1"

    _write(
        node_file,
        """
from typing import Any
from app.core.node_async import AsyncNode
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec

class DemoNodeVersionTwo(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        return {"version": "version-two"}

NODE_DEFINITION = NodeDefinition(
    spec=NodeSpec(type_name="custom.reload.auto", mode=NodeMode.ASYNC, inputs=[], outputs=[]),
    impl_cls=DemoNodeVersionTwo,
)
""",
    )

    second_definitions = get_node_definitions(
        package_name=None,
        search_dirs=[custom_root],
        strict=True,
    )
    assert second_definitions[0].impl_cls.__name__ == "DemoNodeVersionTwo"


def test_node_catalog_refreshes_when_dynamic_files_are_added_or_removed_without_cache_reset(
    tmp_path: Path,
) -> None:
    custom_root = tmp_path / "dynamic_nodes_auto"
    first_node = custom_root / "node_a.py"
    second_node = custom_root / "node_b.py"
    _write(
        first_node,
        """
from typing import Any
from app.core.node_async import AsyncNode
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec

class FirstNode(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        return {}

NODE_DEFINITION = NodeDefinition(
    spec=NodeSpec(type_name="custom.auto.first", mode=NodeMode.ASYNC, inputs=[], outputs=[]),
    impl_cls=FirstNode,
)
""",
    )

    first_definitions = get_node_definitions(
        package_name=None,
        search_dirs=[custom_root],
        strict=True,
    )
    assert [definition.spec.type_name for definition in first_definitions] == [
        "custom.auto.first"
    ]

    _write(
        second_node,
        """
from typing import Any
from app.core.node_async import AsyncNode
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec

class SecondNode(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        return {}

NODE_DEFINITION = NodeDefinition(
    spec=NodeSpec(type_name="custom.auto.second", mode=NodeMode.ASYNC, inputs=[], outputs=[]),
    impl_cls=SecondNode,
)
""",
    )

    second_definitions = get_node_definitions(
        package_name=None,
        search_dirs=[custom_root],
        strict=True,
    )
    assert [definition.spec.type_name for definition in second_definitions] == [
        "custom.auto.first",
        "custom.auto.second",
    ]

    first_node.unlink()
    third_definitions = get_node_definitions(
        package_name=None,
        search_dirs=[custom_root],
        strict=True,
    )
    assert [definition.spec.type_name for definition in third_definitions] == [
        "custom.auto.second"
    ]


def test_registry_forwards_discovery_kwargs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, object] = {}

    def _fake_discovery(*_args: object, **kwargs: object) -> list[object]:
        captured.update(kwargs)
        return []

    monkeypatch.setattr(node_catalog_module, "discover_node_definitions", _fake_discovery)
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

    monkeypatch.setattr(node_catalog_module, "discover_node_definitions", _fake_discovery)
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
