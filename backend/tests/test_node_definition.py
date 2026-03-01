"""NodeDefinition 协议测试。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.core.node_async import AsyncNode
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec


class DemoNode(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        _ = inputs
        _ = context
        return {}


class DemoConfig(BaseModel):
    content: str = Field(default="x", min_length=1)


def _spec(*, config_schema: dict[str, Any] | None = None) -> NodeSpec:
    return NodeSpec(
        type_name="demo.node",
        mode=NodeMode.ASYNC,
        inputs=[],
        outputs=[],
        config_schema=config_schema or {},
    )


def test_node_definition_injects_config_schema_when_empty() -> None:
    definition = NodeDefinition(
        spec=_spec(),
        impl_cls=DemoNode,
        config_model=DemoConfig,
    )
    resolved = definition.spec_with_config_schema()
    assert "properties" in resolved.config_schema
    assert "content" in resolved.config_schema["properties"]


def test_node_definition_keeps_existing_config_schema() -> None:
    definition = NodeDefinition(
        spec=_spec(config_schema={"type": "object", "title": "Custom"}),
        impl_cls=DemoNode,
        config_model=DemoConfig,
    )
    resolved = definition.spec_with_config_schema()
    assert resolved.config_schema["title"] == "Custom"


def test_node_definition_without_config_model_keeps_spec() -> None:
    spec = _spec()
    definition = NodeDefinition(spec=spec, impl_cls=DemoNode, config_model=None)
    resolved = definition.spec_with_config_schema()
    assert resolved is spec
