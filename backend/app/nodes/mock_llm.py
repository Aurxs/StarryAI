"""Mock LLM 节点（非流式）。"""

from __future__ import annotations

from typing import Any

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext


class MockLLMNode(AsyncNode):
    """模拟大语言模型节点。

    端口约定：
    - 输入：`prompt`（完整文本）
    - 输出：`answer`（完整文本）

    当前行为：
    - 不调用真实模型，仅进行字符串拼接模拟。
    """

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        """处理 prompt 并返回模拟答案。"""
        _ = context

        # 从规范输入端口读取 prompt，不存在时按空字符串处理。
        prompt = str(inputs.get("prompt", ""))

        # 生成可观察的 mock 输出，便于验证流程连通。
        answer = f"[MockLLM回复] 已收到: {prompt}"
        return {"answer": answer}
