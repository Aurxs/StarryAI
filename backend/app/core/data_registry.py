"""图级真实变量注册表模型与辅助函数。"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator


DataValueKind = Literal[
    "scalar.int",
    "scalar.float",
    "scalar.string",
    "json.list",
    "json.dict",
    "json.any",
]

DATA_REGISTRY_METADATA_KEY = "data_registry"
SCALAR_VALUE_KINDS = {"scalar.int", "scalar.float", "scalar.string"}
LIST_LIKE_VALUE_KINDS = {"json.list", "json.any"}
DICT_LIKE_VALUE_KINDS = {"json.dict", "json.any"}
PATH_VALUE_KINDS = {"json.list", "json.dict", "json.any"}
SUPPORTED_VALUE_KINDS = {
    "scalar.int",
    "scalar.float",
    "scalar.string",
    "json.list",
    "json.dict",
    "json.any",
}


def _is_json_like(value: Any) -> bool:
    if value is None or isinstance(value, (bool, int, float, str)):
        return True
    if isinstance(value, list):
        return all(_is_json_like(item) for item in value)
    if isinstance(value, dict):
        return all(isinstance(key, str) and _is_json_like(item) for key, item in value.items())
    return False


class GraphDataVariable(BaseModel):
    """图级真实变量定义。"""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1)
    value_kind: DataValueKind = Field(...)
    initial_value: Any = Field(default=None)
    is_constant: bool = Field(default=False)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("name 不能为空")
        return normalized

    @model_validator(mode="after")
    def validate_initial_value(self) -> "GraphDataVariable":
        value = self.initial_value
        if self.value_kind == "scalar.int":
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError("scalar.int 的 initial_value 必须是 integer")
        elif self.value_kind == "scalar.float":
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError("scalar.float 的 initial_value 必须是 float")
        elif self.value_kind == "scalar.string":
            if not isinstance(value, str):
                raise ValueError("scalar.string 的 initial_value 必须是 string")
        elif self.value_kind == "json.list":
            if not isinstance(value, list):
                raise ValueError("json.list 的 initial_value 必须是 list")
        elif self.value_kind == "json.dict":
            if not isinstance(value, dict):
                raise ValueError("json.dict 的 initial_value 必须是 dict")
        elif not _is_json_like(value):
            raise ValueError("json.any 的 initial_value 必须是 JSON 兼容值")
        return self


class GraphDataRegistry(BaseModel):
    """图级真实变量注册表。"""

    model_config = ConfigDict(extra="forbid")

    variables: list[GraphDataVariable] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_unique_variable_names(self) -> "GraphDataRegistry":
        normalized_names = [item.name.strip() for item in self.variables]
        if len(normalized_names) != len(set(normalized_names)):
            raise ValueError("data_registry.variables 存在重复 name")
        return self


def extract_data_registry_payload(metadata: Mapping[str, Any] | None) -> object:
    if not isinstance(metadata, Mapping):
        return {}
    return metadata.get(DATA_REGISTRY_METADATA_KEY, {})


def parse_data_registry(metadata: Mapping[str, Any] | None) -> GraphDataRegistry:
    payload = extract_data_registry_payload(metadata)
    if payload in (None, {}):
        return GraphDataRegistry()
    if isinstance(payload, GraphDataRegistry):
        return payload
    return GraphDataRegistry.model_validate(payload)


def try_parse_data_registry(metadata: Mapping[str, Any] | None) -> tuple[GraphDataRegistry | None, ValidationError | None]:
    try:
        return parse_data_registry(metadata), None
    except ValidationError as exc:
        return None, exc


def build_variable_index(variables: list[GraphDataVariable]) -> dict[str, GraphDataVariable]:
    return {item.name: item for item in variables}
