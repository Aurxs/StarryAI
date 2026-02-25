"""阶段 A: 非同步节点基类。"""

from __future__ import annotations

from .node_base import BaseNode


class AsyncNode(BaseNode):
    """非同步节点基类。

    语义:
    - 上游数据齐备后执行一次 process。
    - 完成后再将输出交给下游（非流式）。
    """

    pass
