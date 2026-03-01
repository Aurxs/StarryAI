"""节点定义自动发现（核心模块）。"""

from __future__ import annotations

import hashlib
import importlib
import importlib.util
import os
import pkgutil
import sys
from collections.abc import Sequence
from pathlib import Path
from types import ModuleType

from .node_definition import NodeDefinition

NODE_SEARCH_DIRS_ENV = "STARRYAI_NODE_DIRS"


class NodeDiscoveryError(RuntimeError):
    """节点发现失败。"""


def _iter_package_module_names(package_name: str) -> list[str]:
    package = importlib.import_module(package_name)
    package_paths = getattr(package, "__path__", None)
    if package_paths is None:
        raise NodeDiscoveryError(f"节点包无效: {package_name}")
    module_names = [
        module_info.name
        for module_info in pkgutil.iter_modules(package_paths, prefix=f"{package_name}.")
        if not module_info.name.rsplit(".", maxsplit=1)[-1].startswith("_")
    ]
    return sorted(module_names)


def _module_name_from_path(path: Path) -> str:
    digest = hashlib.sha1(str(path.resolve()).encode("utf-8")).hexdigest()[:12]
    return f"app.dynamic_nodes.{path.stem}_{digest}"


def _load_module_from_path(path: Path) -> ModuleType:
    module_name = _module_name_from_path(path)
    if module_name in sys.modules:
        return sys.modules[module_name]
    spec = importlib.util.spec_from_file_location(module_name, str(path))
    if spec is None or spec.loader is None:
        raise NodeDiscoveryError(f"无法加载节点文件: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception as exc:  # noqa: BLE001 - 导入错误需聚合为发现错误
        sys.modules.pop(module_name, None)
        raise NodeDiscoveryError(f"导入节点文件失败: {path}: {exc}") from exc
    return module


def _iter_python_files(root: Path) -> list[Path]:
    if not root.exists() or not root.is_dir():
        return []
    files = [
        path
        for path in root.rglob("*.py")
        if path.name != "__init__.py" and not path.name.startswith("_")
    ]
    return sorted(files, key=lambda p: str(p))


def _extract_module_definitions(module: ModuleType, *, strict: bool) -> list[NodeDefinition]:
    has_single = hasattr(module, "NODE_DEFINITION")
    has_multi = hasattr(module, "NODE_DEFINITIONS")
    module_name = getattr(module, "__name__", "<unknown>")

    if has_single and has_multi:
        raise NodeDiscoveryError(f"{module_name} 同时声明了 NODE_DEFINITION 与 NODE_DEFINITIONS")

    if has_single:
        value = getattr(module, "NODE_DEFINITION")
        if not isinstance(value, NodeDefinition):
            raise NodeDiscoveryError(f"{module_name}.NODE_DEFINITION 类型非法: {type(value)!r}")
        return [value]

    if has_multi:
        values = getattr(module, "NODE_DEFINITIONS")
        if not isinstance(values, (list, tuple)):
            raise NodeDiscoveryError(f"{module_name}.NODE_DEFINITIONS 必须是 list/tuple")
        definitions: list[NodeDefinition] = []
        for index, value in enumerate(values):
            if not isinstance(value, NodeDefinition):
                raise NodeDiscoveryError(
                    f"{module_name}.NODE_DEFINITIONS[{index}] 类型非法: {type(value)!r}"
                )
            definitions.append(value)
        return definitions

    if strict:
        raise NodeDiscoveryError(f"{module_name} 未声明 NODE_DEFINITION(S)")
    return []


def _resolve_search_dirs(search_dirs: Sequence[str | Path] | None) -> list[Path]:
    env_dirs: list[Path] = []
    raw_env = os.getenv(NODE_SEARCH_DIRS_ENV, "").strip()
    if raw_env:
        for raw_part in raw_env.split(os.pathsep):
            text = raw_part.strip()
            if text:
                env_dirs.append(Path(text).expanduser().resolve())

    explicit_dirs = [Path(item).expanduser().resolve() for item in (search_dirs or [])]
    merged = env_dirs + explicit_dirs
    unique: list[Path] = []
    seen: set[Path] = set()
    for item in merged:
        if item in seen:
            continue
        seen.add(item)
        unique.append(item)
    return unique


def discover_node_definitions(
    package_name: str | None = "app.nodes",
    *,
    package_names: Sequence[str] | None = None,
    search_dirs: Sequence[str | Path] | None = None,
    strict: bool = False,
) -> list[NodeDefinition]:
    """发现并返回节点定义。

    参数：
    - package_name/package_names：包扫描来源（向后兼容 package_name 单值）。
    - search_dirs：额外目录扫描来源。
    - strict：开启后，扫描到的每个模块都必须导出节点定义。
    """
    definitions: list[NodeDefinition] = []

    if package_names is None:
        package_list = [package_name] if package_name else []
    else:
        package_list = [name for name in package_names if name]

    for current_package in package_list:
        module_names = _iter_package_module_names(current_package)
        for module_name in module_names:
            try:
                module = importlib.import_module(module_name)
            except Exception as exc:  # noqa: BLE001 - 导入错误需聚合为发现错误
                raise NodeDiscoveryError(f"导入节点模块失败: {module_name}: {exc}") from exc
            definitions.extend(_extract_module_definitions(module, strict=strict))

    for root in _resolve_search_dirs(search_dirs):
        for file_path in _iter_python_files(root):
            module = _load_module_from_path(file_path)
            definitions.extend(_extract_module_definitions(module, strict=strict))

    seen_type_names: set[str] = set()
    for definition in definitions:
        type_name = definition.spec.type_name
        if type_name in seen_type_names:
            raise NodeDiscoveryError(f"发现重复节点类型: {type_name}")
        seen_type_names.add(type_name)

    return sorted(definitions, key=lambda item: item.spec.type_name)

