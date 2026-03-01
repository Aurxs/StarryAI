"""节点自动发现测试。"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

from app.core.node_discovery import (
    NODE_SEARCH_DIRS_ENV,
    NodeDiscoveryError,
    discover_node_definitions,
)


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _clear_import_cache(prefix: str) -> None:
    for module_name in list(sys.modules.keys()):
        if module_name == prefix or module_name.startswith(f"{prefix}."):
            sys.modules.pop(module_name, None)


def _mount_pkg(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, pkg_name: str) -> Path:
    pkg_root = tmp_path / pkg_name
    _write(pkg_root / "__init__.py", "")
    monkeypatch.syspath_prepend(str(tmp_path))
    importlib.invalidate_caches()
    _clear_import_cache(pkg_name)
    return pkg_root


def test_discovery_collects_single_and_multi_exports(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pkg_name = "demo_nodes_pkg_1"
    pkg_root = _mount_pkg(tmp_path, monkeypatch, pkg_name)
    _write(
        pkg_root / "a.py",
        """
from typing import Any
from app.core.node_async import AsyncNode
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec

class ANode(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        return {}

NODE_DEFINITION = NodeDefinition(
    spec=NodeSpec(type_name="demo.a", mode=NodeMode.ASYNC, inputs=[], outputs=[]),
    impl_cls=ANode,
)
""",
    )
    _write(
        pkg_root / "b.py",
        """
from typing import Any
from app.core.node_async import AsyncNode
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec

class BNode(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        return {}

NODE_DEFINITIONS = [
    NodeDefinition(spec=NodeSpec(type_name="demo.b1", mode=NodeMode.ASYNC, inputs=[], outputs=[]), impl_cls=BNode),
    NodeDefinition(spec=NodeSpec(type_name="demo.b2", mode=NodeMode.ASYNC, inputs=[], outputs=[]), impl_cls=BNode),
]
""",
    )

    definitions = discover_node_definitions(package_name=pkg_name, strict=True)
    assert [definition.spec.type_name for definition in definitions] == [
        "demo.a",
        "demo.b1",
        "demo.b2",
    ]


def test_discovery_strict_requires_exports(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    pkg_name = "demo_nodes_pkg_2"
    pkg_root = _mount_pkg(tmp_path, monkeypatch, pkg_name)
    _write(pkg_root / "no_export.py", "VALUE = 1\n")

    assert discover_node_definitions(package_name=pkg_name, strict=False) == []
    with pytest.raises(NodeDiscoveryError, match="未声明 NODE_DEFINITION"):
        discover_node_definitions(package_name=pkg_name, strict=True)


def test_discovery_rejects_duplicate_type_names(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pkg_name = "demo_nodes_pkg_3"
    pkg_root = _mount_pkg(tmp_path, monkeypatch, pkg_name)
    shared = """
from typing import Any
from app.core.node_async import AsyncNode
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec

class DNode(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        return {}

NODE_DEFINITION = NodeDefinition(
    spec=NodeSpec(type_name="demo.dup", mode=NodeMode.ASYNC, inputs=[], outputs=[]),
    impl_cls=DNode,
)
"""
    _write(pkg_root / "x.py", shared)
    _write(pkg_root / "y.py", shared)

    with pytest.raises(NodeDiscoveryError, match="重复节点类型"):
        discover_node_definitions(package_name=pkg_name, strict=True)


def test_discovery_rejects_invalid_export_type(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pkg_name = "demo_nodes_pkg_4"
    pkg_root = _mount_pkg(tmp_path, monkeypatch, pkg_name)
    _write(pkg_root / "bad.py", "NODE_DEFINITION = 1\n")

    with pytest.raises(NodeDiscoveryError, match="类型非法"):
        discover_node_definitions(package_name=pkg_name, strict=True)


def test_discovery_rejects_conflicting_exports(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pkg_name = "demo_nodes_pkg_5"
    pkg_root = _mount_pkg(tmp_path, monkeypatch, pkg_name)
    _write(
        pkg_root / "bad.py",
        """
NODE_DEFINITION = None
NODE_DEFINITIONS = []
""",
    )

    with pytest.raises(NodeDiscoveryError, match="同时声明了 NODE_DEFINITION 与 NODE_DEFINITIONS"):
        discover_node_definitions(package_name=pkg_name, strict=True)


def test_discovery_scans_real_nodes_package_in_non_strict_mode() -> None:
    definitions = discover_node_definitions(package_name="app.nodes", strict=False)
    type_names = [definition.spec.type_name for definition in definitions]
    assert {
        "mock.input",
        "mock.llm",
        "mock.tts",
        "mock.motion",
        "mock.output",
        "audio.play.base",
        "sync.initiator.dual",
        "audio.play.sync",
        "motion.play.sync",
    }.issubset(set(type_names))


def test_discovery_scans_custom_search_dirs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    custom_root = tmp_path / "custom_nodes"
    _write(
        custom_root / "my_custom.py",
        """
from typing import Any
from app.core.node_async import AsyncNode
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec

class MyCustomNode(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        return {}

NODE_DEFINITION = NodeDefinition(
    spec=NodeSpec(type_name="custom.demo", mode=NodeMode.ASYNC, inputs=[], outputs=[]),
    impl_cls=MyCustomNode,
)
""",
    )
    monkeypatch.delenv(NODE_SEARCH_DIRS_ENV, raising=False)

    definitions = discover_node_definitions(
        package_name=None,
        search_dirs=[custom_root],
        strict=True,
    )
    type_names = [definition.spec.type_name for definition in definitions]
    assert type_names == ["custom.demo"]


def test_discovery_reads_search_dirs_from_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    custom_root = tmp_path / "custom_nodes_env"
    _write(
        custom_root / "env_node.py",
        """
from typing import Any
from app.core.node_async import AsyncNode
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec

class EnvNode(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        return {}

NODE_DEFINITION = NodeDefinition(
    spec=NodeSpec(type_name="custom.env", mode=NodeMode.ASYNC, inputs=[], outputs=[]),
    impl_cls=EnvNode,
)
""",
    )
    monkeypatch.setenv(NODE_SEARCH_DIRS_ENV, str(custom_root))
    definitions = discover_node_definitions(package_name=None, strict=True)
    type_names = [definition.spec.type_name for definition in definitions]
    assert type_names == ["custom.env"]
