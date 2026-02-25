"""阶段 A: 调度器骨架。"""

from __future__ import annotations

from dataclasses import dataclass

from .graph_builder import CompiledGraph


@dataclass(slots=True)
class SchedulerConfig:
    """调度器配置。"""

    max_parallel_nodes: int = 16


class GraphScheduler:
    """图调度器（阶段 A 仅提供接口占位）。"""

    def __init__(self, config: SchedulerConfig | None = None) -> None:
        self.config = config or SchedulerConfig()

    async def run(self, compiled_graph: CompiledGraph) -> None:
        """运行编译后的图。

        说明:
        - 阶段 A 只完成协议/模型，实际调度逻辑在阶段 B 实现。
        """

        raise NotImplementedError("GraphScheduler.run 将在阶段 B 实现")
