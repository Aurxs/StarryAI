"""Mock TTS 节点（非流式）。"""

from __future__ import annotations

import time
from typing import Any

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext


class MockTTSNode(AsyncNode):
    """模拟语音合成节点。

    端口约定：
    - 输入：`text`
    - 输出：`audio`

    当前行为：
    - 不做真实语音合成，仅返回音频元信息，
      用于后续同步节点和前端展示验证。
    """

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        """基于输入文本构造模拟音频信息。"""
        text = str(inputs.get("text", ""))
        stream_id = str(context.metadata.get("stream_id", "stream_default"))
        seq = int(context.metadata.get("seq", 0))

        # 以文本长度粗略估算时长，模拟真实 TTS 返回的 duration。
        duration_ms = max(400, len(text) * 70)
        play_at = time.monotonic() + 0.18

        return {
            "audio": {
                "format": "wav",
                "duration_ms": duration_ms,
                "text": text,
                "stream_id": stream_id,
                "seq": seq,
                "play_at": play_at,
            }
        }
