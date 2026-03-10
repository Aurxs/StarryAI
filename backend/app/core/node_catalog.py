from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import TypeAlias

from app.core.node_definition import NodeDefinition
from app.core.node_discovery import (
    build_search_dirs_fingerprint,
    discover_node_definitions,
    reset_dynamic_node_modules,
    resolve_search_dirs,
)

_SearchDirKey: TypeAlias = tuple[str, ...]
_PackageNamesKey: TypeAlias = tuple[str, ...] | None
_NodeCatalogKey: TypeAlias = tuple[str | None, _PackageNamesKey, _SearchDirKey, bool, str]

_node_definitions_cache: dict[_NodeCatalogKey, tuple[NodeDefinition, ...]] = {}


def get_node_definitions(
    package_name: str | None = "app.nodes",
    *,
    package_names: Sequence[str] | None = None,
    search_dirs: Sequence[str | Path] | None = None,
    strict: bool = False,
) -> tuple[NodeDefinition, ...]:
    key = _build_cache_key(
        package_name=package_name,
        package_names=package_names,
        search_dirs=search_dirs,
        strict=strict,
    )
    cached = _node_definitions_cache.get(key)
    if cached is not None:
        return cached

    definitions = tuple(
        discover_node_definitions(
            package_name=package_name,
            package_names=package_names,
            search_dirs=search_dirs,
            strict=strict,
        )
    )
    _node_definitions_cache[key] = definitions
    return definitions


def reset_node_catalog_cache() -> None:
    _node_definitions_cache.clear()
    reset_dynamic_node_modules()


def _build_cache_key(
    *,
    package_name: str | None,
    package_names: Sequence[str] | None,
    search_dirs: Sequence[str | Path] | None,
    strict: bool,
) -> _NodeCatalogKey:
    package_names_key: _PackageNamesKey
    if package_names is None:
        package_names_key = None
    else:
        package_names_key = tuple(str(name) for name in package_names)

    resolved_search_dirs = resolve_search_dirs(search_dirs)
    search_dirs_key = tuple(str(item) for item in resolved_search_dirs)
    fingerprint = build_search_dirs_fingerprint(resolved_search_dirs)
    return package_name, package_names_key, search_dirs_key, bool(strict), fingerprint


__all__ = ["get_node_definitions", "reset_node_catalog_cache"]
