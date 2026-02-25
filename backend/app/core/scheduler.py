"""阶段 A：调度器骨架。

该模块在阶段 A 仅定义接口与配置。
真正的任务编排、队列调度、生命周期管理将在阶段 B 实现。
"""

from __future__ import annotations

from dataclasses import dataclass

from .graph_builder import CompiledGraph


@dataclass(slots=True)
class SchedulerConfig:
    """调度器配置。"""

    # 未来用于限制并行节点数。
    max_parallel_nodes: int = 16


class GraphScheduler:
    """图调度器。"""

    def __init__(self, config: SchedulerConfig | None = None) -> None:
        """初始化调度器。"""
        self.config = config or SchedulerConfig()

    async def run(self, compiled_graph: CompiledGraph) -> None:
        """运行编译后的图。

        参数：
        - compiled_graph: GraphBuilder 输出的编译结果。

        说明：
        - 阶段 A 只完成协议与模型，本方法暂不提供真实运行逻辑。
        """
        _ = compiled_graph
        raise NotImplementedError("GraphScheduler.run 将在阶段 B 实现")
