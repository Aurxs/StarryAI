"""阶段 A：非同步节点基类。"""

from __future__ import annotations

from .node_base import BaseNode


class AsyncNode(BaseNode):
    """非同步节点。

    语义说明：
    1. 上游输入准备好后执行一次 `process`。
    2. `process` 返回后再向后续节点传递输出。
    3. 当前阶段不拆分 token/chunk 流式输出。
    """

    # 阶段 A 仅保留语义标记，具体调度行为由阶段 B 实现。
    pass
