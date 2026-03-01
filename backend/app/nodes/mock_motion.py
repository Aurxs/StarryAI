"""Mock 动作规划节点（非流式）。"""

from __future__ import annotations

import time
from typing import Any

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_config import CommonNodeConfig
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec, PortSpec


class MockMotionConfig(CommonNodeConfig):
    """Mock Motion 节点配置。"""


class MockMotionNode(AsyncNode):
    """模拟动作时间线生成节点。

    端口约定：
    - 输入：`text`
    - 输出：`motion`

    当前行为：
    - 根据文本长度生成简化的动作轨迹时间线。
    """

    ConfigModel = MockMotionConfig

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        """生成 mock 动作时间线。"""
        text = str(inputs.get("text", ""))
        stream_id = str(context.metadata.get("stream_id", "stream_default"))
        seq = int(context.metadata.get("seq", 0))
        play_at = time.monotonic() + 0.2

        # 动作时间线示例：
        # 1) 初始 idle
        # 2) 开始说话
        # 3) 结束说话（时刻与文本长度相关）
        timeline = [
            {"t": 0, "action": "idle"},
            {"t": 200, "action": "speak_start"},
            {"t": 1200 + len(text) * 15, "action": "speak_end"},
        ]

        return {
            "motion": {
                "timeline": timeline,
                "source_text": text,
                "stream_id": stream_id,
                "seq": seq,
                "play_at": play_at,
            }
        }


MOCK_MOTION_SPEC = NodeSpec(
    type_name="mock.motion",
    mode=NodeMode.ASYNC,
    inputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
    outputs=[PortSpec(name="motion", frame_schema="motion.timeline", required=True)],
    description="模拟动作规划节点（输出完整动作轨迹）",
    config_schema=MockMotionConfig.model_json_schema(),
)


NODE_DEFINITION = NodeDefinition(
    spec=MOCK_MOTION_SPEC,
    impl_cls=MockMotionNode,
    config_model=MockMotionConfig,
)
