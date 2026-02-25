"""Mock 输入节点。"""

from __future__ import annotations

from typing import Any

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext


class MockInputNode(AsyncNode):
    """模拟输入源节点。

    端口约定：
    - 输入：无
    - 输出：`text`（完整文本）

    典型用途：
    - 在没有真实弹幕/语音输入时，作为上游触发源。
    """

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        """生成一条完整文本消息。

        说明：
        - `inputs` 在该节点中不使用，因为它是源节点。
        - 支持从节点配置 `content` 读取固定文本。
        """
        _ = inputs
        _ = context

        content = self.config.get("content", "你好，这是 StarryAI 的输入消息")
        return {"text": content}
