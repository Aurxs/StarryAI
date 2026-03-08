"""Mock 输入节点。"""

from __future__ import annotations

from typing import Any

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_config import CommonNodeConfig, NodeField
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec, PortSpec


class MockInputConfig(CommonNodeConfig):
    """Mock 输入节点配置。"""

    content: str = NodeField(
        default="你好，这是 StarryAI 的输入消息",
        description="Static text emitted by the node.",
    )


class MockInputNode(AsyncNode):
    """模拟输入源节点。

    端口约定：
    - 输入：无
    - 输出：`text`（完整文本）

    典型用途：
    - 在没有真实弹幕/语音输入时，作为上游触发源。
    """

    ConfigModel = MockInputConfig

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        """生成一条完整文本消息。

        说明：
        - `inputs` 在该节点中不使用，因为它是源节点。
        - 支持从节点配置 `content` 读取固定文本。
        """
        _ = inputs
        _ = context

        cfg = self.cfg
        if isinstance(cfg, MockInputConfig):
            content = cfg.content
        else:
            content = str(self.config.get("content", "你好，这是 StarryAI 的输入消息"))
        return {"text": content}


MOCK_INPUT_SPEC = NodeSpec(
    type_name="mock.input",
    mode=NodeMode.ASYNC,
    inputs=[],
    outputs=[
        PortSpec(
            name="text",
            frame_schema="text.final",
            is_stream=False,
            required=True,
            description="Complete text output.",
        )
    ],
    description="Mock input node that emits complete text payloads.",
    config_schema=MockInputConfig.model_json_schema(),
)


NODE_DEFINITION = NodeDefinition(
    spec=MOCK_INPUT_SPEC,
    impl_cls=MockInputNode,
    config_model=MockInputConfig,
)
