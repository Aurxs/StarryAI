"""运行时数据容器存储。"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from .spec import GraphSpec, NodeSpec


@dataclass(slots=True)
class RuntimeDataEntry:
    """单个容器节点的运行时值。"""

    node_id: str
    type_name: str
    value: Any


class RuntimeDataStore:
    """按 run 生命周期维护被动数据容器的当前值。"""

    def __init__(self, entries: dict[str, RuntimeDataEntry] | None = None) -> None:
        self._entries = entries or {}

    @classmethod
    def from_graph(cls, graph: GraphSpec, node_specs: dict[str, NodeSpec]) -> "RuntimeDataStore":
        entries: dict[str, RuntimeDataEntry] = {}
        for node in graph.nodes:
            spec = node_specs.get(node.node_id)
            if spec is None or "data_container" not in spec.tags:
                continue
            entries[node.node_id] = RuntimeDataEntry(
                node_id=node.node_id,
                type_name=spec.type_name,
                value=deepcopy(node.config.get("initial_value")),
            )
        return cls(entries=entries)

    def has(self, node_id: str) -> bool:
        return node_id in self._entries

    def get_type_name(self, node_id: str) -> str:
        return self._entries[node_id].type_name

    def read(self, node_id: str) -> Any:
        return deepcopy(self._entries[node_id].value)

    def write(self, node_id: str, value: Any) -> Any:
        self._entries[node_id].value = deepcopy(value)
        return self.read(node_id)

    def snapshot(self) -> dict[str, Any]:
        return {node_id: deepcopy(entry.value) for node_id, entry in self._entries.items()}

