"""基础音频播放节点（收到即执行）。"""

from __future__ import annotations

from typing import Any

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_config import CommonNodeConfig
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec, PortSpec


class AudioPlayBaseConfig(CommonNodeConfig):
    """基础音频播放节点配置。"""


class AudioPlayBaseNode(AsyncNode):
    """基础动作节点：消费音频包，不产生输出。"""

    ConfigModel = AudioPlayBaseConfig

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _payload = inputs.get("in")
        print(
            f"[AudioPlayBase] run={context.run_id} node={context.node_id} "
            "executed_immediately=true"
        )
        return {}


AUDIO_PLAY_BASE_SPEC = NodeSpec(
    type_name="audio.play.base",
    mode=NodeMode.ASYNC,
    inputs=[PortSpec(name="in", frame_schema="audio.full", required=True)],
    outputs=[],
    description="Base audio executor node that runs immediately when it receives input.",
    config_schema=AudioPlayBaseConfig.model_json_schema(),
)


NODE_DEFINITION = NodeDefinition(
    spec=AUDIO_PLAY_BASE_SPEC,
    impl_cls=AudioPlayBaseNode,
    config_model=AudioPlayBaseConfig,
)
