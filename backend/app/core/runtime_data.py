"""运行时数据变量存储。"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from .data_registry import build_variable_index, parse_data_registry
from .spec import GraphSpec, NodeSpec


@dataclass(slots=True)
class RuntimeDataEntry:
    """单个真实变量的运行时值。"""

    variable_name: str
    value_kind: str
    value: Any
    is_constant: bool = False


class RuntimeDataStore:
    """按 run 生命周期维护真实变量的当前值。"""

    def __init__(self, entries: dict[str, RuntimeDataEntry] | None = None) -> None:
        self._entries = entries or {}

    @classmethod
    def from_graph(cls, graph: GraphSpec, node_specs: dict[str, NodeSpec]) -> "RuntimeDataStore":
        entries: dict[str, RuntimeDataEntry] = {}
        _ = node_specs
        registry = parse_data_registry(graph.metadata)
        for variable_name, variable in build_variable_index(registry.variables).items():
            entries[variable_name] = RuntimeDataEntry(
                variable_name=variable_name,
                value_kind=variable.value_kind,
                value=deepcopy(variable.initial_value),
                is_constant=variable.is_constant,
            )
        return cls(entries=entries)

    def has(self, variable_name: str) -> bool:
        return variable_name in self._entries

    def get_value_kind(self, variable_name: str) -> str:
        return self._entries[variable_name].value_kind

    def read(self, variable_name: str) -> Any:
        return deepcopy(self._entries[variable_name].value)

    def write(self, variable_name: str, value: Any) -> Any:
        if self._entries[variable_name].is_constant:
            raise ValueError(f"变量 {variable_name} 是常量，不能写入")
        self._entries[variable_name].value = deepcopy(value)
        return self.read(variable_name)

    def snapshot(self) -> dict[str, Any]:
        return {variable_name: deepcopy(entry.value) for variable_name, entry in self._entries.items()}
