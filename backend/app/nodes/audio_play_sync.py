"""同步音频播放节点。"""

from __future__ import annotations

from typing import Any

from app.core.node_base import NodeContext
from app.core.node_config import CommonNodeConfig
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec, PortSpec, SyncConfig, SyncRole
from app.core.node_sync_executor import SyncExecutorNode


class AudioPlaySyncConfig(CommonNodeConfig):
    """同步音频执行节点配置。"""


class AudioPlaySyncNode(SyncExecutorNode):
    """在协调器提交后执行音频播放动作。"""

    ConfigModel = AudioPlaySyncConfig

    async def execute(self, *, data: Any, sync_meta: dict[str, Any], context: NodeContext) -> None:
        _ = data
        print(
            f"[AudioPlaySync] run={context.run_id} node={context.node_id} "
            f"group={sync_meta.get('sync_group')} round={sync_meta.get('sync_round')}"
        )


AUDIO_PLAY_SYNC_SPEC = NodeSpec(
    type_name="audio.play.sync",
    mode=NodeMode.SYNC,
    inputs=[PortSpec(name="in", frame_schema="audio.full.sync", required=True)],
    outputs=[],
    sync_config=SyncConfig(
        required_ports=["in"],
        role=SyncRole.EXECUTOR,
        commit_lead_ms=50,
        ready_timeout_ms=800,
    ),
    description="Synchronous audio executor node that runs after a coordinated commit.",
    config_schema=AudioPlaySyncConfig.model_json_schema(),
)


NODE_DEFINITION = NodeDefinition(
    spec=AUDIO_PLAY_SYNC_SPEC,
    impl_cls=AudioPlaySyncNode,
    config_model=AudioPlaySyncConfig,
)
