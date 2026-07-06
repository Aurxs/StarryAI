"""触发器节点。"""

from __future__ import annotations

from typing import Any

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_config import CommonNodeConfig, NodeField
from app.core.node_definition import NodeDefinition
from app.core.spec import InputBehavior, NodeMode, NodeSpec, PortSpec


class TriggerGroupConfig(CommonNodeConfig):
    """触发组配置。"""

    trigger_group: str = NodeField(
        default="default",
        description="Trigger group name shared by emitters and entries.",
    )


class TriggerEntryConfig(TriggerGroupConfig):
    """触发入口配置。"""

    require_cached_input: bool = NodeField(
        default=True,
        description="Require a cached normal input before releasing output.",
    )
    fallback_value: Any = NodeField(
        default=None,
        description="Value emitted when cached input is not required and no cache exists.",
    )


class TriggerEmitNode(AsyncNode):
    """触发广播节点。"""

    ConfigModel = TriggerGroupConfig

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        return {
            "out": inputs.get("in"),
            "__node_metrics": {"trigger_emits": 1},
        }


class TriggerEntryNode(AsyncNode):
    """触发入口节点，被广播激活时释放普通输入缓存。"""

    ConfigModel = TriggerEntryConfig

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        cfg = self.cfg
        require_cached_input = True
        fallback_value: Any = None
        if isinstance(cfg, TriggerEntryConfig):
            require_cached_input = cfg.require_cached_input
            fallback_value = cfg.fallback_value

        has_cached_input = "in" in inputs
        if require_cached_input and not has_cached_input:
            raise ValueError("trigger.entry 缺少已缓存的普通输入")
        return {
            "out": inputs.get("in") if has_cached_input else fallback_value,
            "__node_metrics": {"trigger_entries": 1},
        }


TRIGGER_EMIT_SPEC = NodeSpec(
    type_name="trigger.emit",
    mode=NodeMode.ASYNC,
    inputs=[
        PortSpec(
            name="in",
            frame_schema="any",
            required=True,
            description="Payload that activates this emitter.",
        ),
    ],
    outputs=[
        PortSpec(
            name="out",
            frame_schema="any",
            required=True,
            derived_from_input="in",
            description="Optional pass-through output for ordinary graph edges.",
        ),
    ],
    description="Broadcast a trigger signal to entries in the same trigger_group.",
    config_schema=TriggerGroupConfig.model_json_schema(),
    tags=["trigger_emit"],
)

TRIGGER_ENTRY_SPEC = NodeSpec(
    type_name="trigger.entry",
    mode=NodeMode.ASYNC,
    inputs=[
        PortSpec(
            name="in",
            frame_schema="any",
            required=False,
            description="Normal payload cache released when the entry is triggered.",
        ),
        PortSpec(
            name="trigger",
            frame_schema="any",
            required=True,
            input_behavior=InputBehavior.TRIGGER,
            description="Internal trigger signal delivered by trigger_group.",
        ),
    ],
    outputs=[
        PortSpec(
            name="out",
            frame_schema="any",
            required=True,
            derived_from_input="in",
            description="Cached payload released on trigger.",
        ),
    ],
    description="Entry point that releases cached input when its trigger_group is broadcast.",
    config_schema=TriggerEntryConfig.model_json_schema(),
    tags=["trigger_entry"],
)


NODE_DEFINITIONS = [
    NodeDefinition(
        spec=TRIGGER_EMIT_SPEC,
        impl_cls=TriggerEmitNode,
        config_model=TriggerGroupConfig,
    ),
    NodeDefinition(
        spec=TRIGGER_ENTRY_SPEC,
        impl_cls=TriggerEntryNode,
        config_model=TriggerEntryConfig,
    ),
]
