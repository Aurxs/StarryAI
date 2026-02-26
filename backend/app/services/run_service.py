"""运行管理服务（Phase B）。"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable

from app.core.frame import RuntimeEvent
from app.core.graph_builder import GraphBuilder
from app.core.graph_runtime import GraphRuntimeState
from app.core.node_factory import NodeFactory, create_default_node_factory
from app.core.registry import NodeTypeRegistry, create_default_registry
from app.core.scheduler import GraphScheduler, SchedulerConfig
from app.core.spec import GraphSpec


class RunNotFoundError(KeyError):
    """运行实例不存在。"""


@dataclass(slots=True)
class RunRecord:
    """运行实例记录。"""

    run_id: str
    graph_id: str
    stream_id: str
    created_at: float
    scheduler: GraphScheduler
    task: asyncio.Task[GraphRuntimeState]

    @property
    def status(self) -> str:
        """返回运行状态。"""
        if self.scheduler.runtime_state is not None:
            return self.scheduler.runtime_state.status
        if self.task.cancelled():
            return "stopped"
        if self.task.done():
            exc = self.task.exception()
            return "failed" if exc is not None else "completed"
        return "running"


class RunService:
    """运行管理服务。

    职责：
    1. 校验并编译图。
    2. 创建并托管 GraphScheduler 生命周期。
    3. 提供状态与事件查询能力。
    """

    def __init__(
            self,
            *,
            registry: NodeTypeRegistry | None = None,
            scheduler_config: SchedulerConfig | None = None,
            node_factory_builder: Callable[[], NodeFactory] | None = None,
    ) -> None:
        self.registry = registry or create_default_registry()
        self.scheduler_config = scheduler_config or SchedulerConfig()
        self.node_factory_builder = node_factory_builder or create_default_node_factory
        self.builder = GraphBuilder(self.registry)

        self._runs: dict[str, RunRecord] = {}
        self._lock = asyncio.Lock()

    async def create_run(self, graph: GraphSpec, *, stream_id: str = "stream_default") -> RunRecord:
        """创建并启动一个运行实例。"""
        compiled_graph = self.builder.build(graph)
        run_id = f"run_{uuid.uuid4().hex[:12]}"
        scheduler = GraphScheduler(
            config=self.scheduler_config,
            node_factory=self.node_factory_builder(),
        )
        task = asyncio.create_task(
            scheduler.run(compiled_graph, run_id=run_id, stream_id=stream_id),
            name=f"run:{run_id}",
        )
        record = RunRecord(
            run_id=run_id,
            graph_id=graph.graph_id,
            stream_id=stream_id,
            created_at=time.time(),
            scheduler=scheduler,
            task=task,
        )
        async with self._lock:
            self._runs[run_id] = record
        return record

    async def stop_run(self, run_id: str, *, timeout_s: float = 3.0) -> RunRecord:
        """请求停止指定运行实例。"""
        record = self._get_or_raise(run_id)
        record.scheduler.stop()

        if not record.task.done():
            try:
                await asyncio.wait_for(asyncio.shield(record.task), timeout=timeout_s)
            except asyncio.TimeoutError:
                record.task.cancel()
                await asyncio.gather(record.task, return_exceptions=True)
        return record

    def get_run(self, run_id: str) -> RunRecord:
        """获取运行记录。"""
        return self._get_or_raise(run_id)

    def get_run_snapshot(self, run_id: str) -> dict[str, Any]:
        """获取运行快照。"""
        record = self._get_or_raise(run_id)
        runtime = record.scheduler.runtime_state
        if runtime is not None:
            data = runtime.to_dict()
        else:
            data = {
                "run_id": record.run_id,
                "graph_id": record.graph_id,
                "status": record.status,
                "started_at": None,
                "ended_at": None,
                "last_error": None,
                "node_states": {},
                "edge_states": [],
            }

        data["created_at"] = record.created_at
        data["stream_id"] = record.stream_id
        data["task_done"] = record.task.done()
        return data

    def get_run_events(
            self, run_id: str, *, since: int = 0, limit: int = 200
    ) -> tuple[list[RuntimeEvent], int]:
        """查询运行事件。"""
        record = self._get_or_raise(run_id)
        return record.scheduler.get_events(since=since, limit=limit)

    async def stop_all(self) -> None:
        """停止所有运行实例（主要供测试清理使用）。"""
        async with self._lock:
            run_ids = list(self._runs.keys())
        for run_id in run_ids:
            await self.stop_run(run_id)

    def _get_or_raise(self, run_id: str) -> RunRecord:
        try:
            return self._runs[run_id]
        except KeyError as exc:
            raise RunNotFoundError(f"运行实例不存在: {run_id}") from exc


_run_service_singleton: RunService | None = None


def get_run_service() -> RunService:
    """获取全局运行服务。"""
    global _run_service_singleton
    if _run_service_singleton is None:
        _run_service_singleton = RunService()
    return _run_service_singleton


def reset_run_service_for_testing() -> None:
    """重置全局运行服务（供测试隔离使用）。"""
    global _run_service_singleton
    _run_service_singleton = RunService()


__all__ = [
    "RunNotFoundError",
    "RunRecord",
    "RunService",
    "get_run_service",
    "reset_run_service_for_testing",
]
