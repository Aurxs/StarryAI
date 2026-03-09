"""BaseNode 配置模型能力测试。"""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import BaseModel, ConfigDict, Field

from app.core.node_async import AsyncNode
from app.core.node_config import NodeField
from app.core.spec import NodeMode, NodeSpec


def _spec(type_name: str) -> NodeSpec:
    return NodeSpec(type_name=type_name, mode=NodeMode.ASYNC, inputs=[], outputs=[])


class PlainNode(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        _ = inputs
        _ = context
        return {}


class TypedConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    threshold: int = Field(default=1, ge=1)
    name: str = Field(default="demo", min_length=1)


class TypedNode(AsyncNode):
    ConfigModel = TypedConfig

    async def process(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        _ = inputs
        _ = context
        return {}


def test_base_node_without_config_model_keeps_raw_dict() -> None:
    config = {"timeout_s": 2, "x": "y"}
    node = PlainNode(node_id="n1", spec=_spec("plain.node"), config=config)
    assert node.raw_config == config
    assert node.config == config
    assert node.cfg == config
    assert PlainNode.config_schema() == {}


def test_base_node_with_config_model_parses_cfg() -> None:
    node = TypedNode(
        node_id="n2",
        spec=_spec("typed.node"),
        config={"threshold": 3, "name": "alpha"},
    )
    assert isinstance(node.cfg, TypedConfig)
    assert node.cfg.threshold == 3
    assert node.cfg.name == "alpha"
    schema = TypedNode.config_schema()
    assert "properties" in schema
    assert "threshold" in schema["properties"]


def test_base_node_with_config_model_rejects_invalid_config() -> None:
    with pytest.raises(ValueError, match="配置校验失败"):
        TypedNode(
            node_id="n3",
            spec=_spec("typed.node"),
            config={"threshold": 0, "name": "bad"},
        )


def test_node_field_emits_readonly_schema_metadata() -> None:
    class ReadonlyConfig(BaseModel):
        sync_round: int = NodeField(default=0, ge=0, readonly=True, json_schema_extra={"x-starryai-order": 10})

    schema = ReadonlyConfig.model_json_schema()
    sync_round_schema = schema["properties"]["sync_round"]
    assert sync_round_schema["readOnly"] is True
    assert sync_round_schema["x-starryai-order"] == 10


def test_node_field_preserves_callable_json_schema_extra() -> None:
    calls: list[str] = []

    def mutate_schema(schema: dict[str, Any]) -> None:
        calls.append("called")
        schema["x-starryai-order"] = 30

    class CallableReadonlyConfig(BaseModel):
        api_key: str | None = NodeField(default=None, readonly=True, json_schema_extra=mutate_schema)

    schema = CallableReadonlyConfig.model_json_schema()
    api_key_schema = schema["properties"]["api_key"]
    assert calls == ["called"]
    assert api_key_schema["readOnly"] is True
    assert api_key_schema["x-starryai-order"] == 30
