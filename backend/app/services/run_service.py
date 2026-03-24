"""运行管理服务（Phase B）。"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable

from app.core.config_validation import resolve_secret_refs
from app.core.frame import RuntimeEvent, RuntimeEventSeverity, RuntimeEventType
from app.core.graph_builder import GraphBuilder
from app.core.graph_runtime import GraphRuntimeState
from app.core.node_factory import NodeFactory, create_default_node_factory
from app.core.registry import NodeTypeRegistry, create_default_registry
from app.core.scheduler import GraphScheduler, SchedulerConfig
from app.core.spec import GraphSpec
from app.secrets.service import get_secret_service


class RunNotFoundError(KeyError):
    """运行实例不存在。"""


class InvalidRunRequestError(ValueError):
    """运行请求参数非法。"""


class RunCapacityExceededError(RuntimeError):
    """运行实例数量超出服务配置上限。"""


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
            max_retained_runs: int = 500,
            retention_ttl_s: float = 3600.0,
            max_active_runs: int = 0,
    ) -> None:
        self.registry = registry or create_default_registry()
        self.scheduler_config = scheduler_config or SchedulerConfig()
        self.node_factory_builder = node_factory_builder or create_default_node_factory
        self.max_retained_runs = max(1, max_retained_runs)
        self.retention_ttl_s = max(0.0, retention_ttl_s)
        self.max_active_runs = max(0, int(max_active_runs))

        self._runs: dict[str, RunRecord] = {}
        self._lock = asyncio.Lock()

    async def create_run(self, graph: GraphSpec, *, stream_id: str = "stream_default") -> RunRecord:
        """创建并启动一个运行实例。"""
        normalized_stream_id = self._normalize_stream_id(stream_id)
        compiled_graph = self._build_graph_builder().build(graph)
        async with self._lock:
            self._prune_runs(now=time.time())
            self._ensure_capacity_locked()
            run_id = f"run_{uuid.uuid4().hex[:12]}"
            scheduler = GraphScheduler(
                config=self.scheduler_config,
                node_factory=self.node_factory_builder(),
            )
            task = asyncio.create_task(
                scheduler.run(compiled_graph, run_id=run_id, stream_id=normalized_stream_id),
                name=f"run:{run_id}",
            )
            record = RunRecord(
                run_id=run_id,
                graph_id=graph.graph_id,
                stream_id=normalized_stream_id,
                created_at=time.time(),
                scheduler=scheduler,
                task=task,
            )
            self._runs[run_id] = record
        return record

    def _build_graph_builder(self) -> GraphBuilder:
        return GraphBuilder(self.registry, secret_exists=get_secret_service().exists)

    async def stop_run(self, run_id: str, *, timeout_s: float = 3.0) -> RunRecord:
        """请求停止指定运行实例。"""
        self._prune_runs(now=time.time())
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
        self._prune_runs(now=time.time())
        return self._get_or_raise(run_id)

    def get_run_snapshot(self, run_id: str) -> dict[str, Any]:
        """获取运行快照。"""
        self._prune_runs(now=time.time())
        record = self._get_or_raise(run_id)
        runtime = record.scheduler.runtime_state
        if runtime is not None:
            data = runtime.to_dict()
        else:
            last_error: str | None = None
            if record.task.done() and not record.task.cancelled():
                exc = record.task.exception()
                if exc is not None:
                    last_error = str(exc)
            data = {
                "run_id": record.run_id,
                "graph_id": record.graph_id,
                "status": record.status,
                "started_at": None,
                "ended_at": None,
                "last_error": last_error,
                "metrics": {},
                "node_states": {},
                "edge_states": [],
            }

        data["created_at"] = record.created_at
        data["stream_id"] = record.stream_id
        data["task_done"] = record.task.done()
        return data

    def get_run_events(
            self,
            run_id: str,
            *,
            since: int = 0,
            limit: int = 200,
            event_type: RuntimeEventType | str | None = None,
            node_id: str | None = None,
            severity: RuntimeEventSeverity | str | None = None,
            error_code: str | None = None,
    ) -> tuple[list[RuntimeEvent], int]:
        """查询运行事件。"""
        self._prune_runs(now=time.time())
        record = self._get_or_raise(run_id)
        return record.scheduler.get_events_filtered(
            since=since,
            limit=limit,
            event_type=event_type,
            node_id=node_id,
            severity=severity,
            error_code=error_code,
        )

    def get_run_metrics(self, run_id: str) -> dict[str, Any]:
        """获取运行指标视图。"""
        snapshot = self.get_run_snapshot(run_id)
        edge_metrics = [
            {
                "edge": (
                    f"{edge['source_node']}.{edge['source_port']}"
                    f"->{edge['target_node']}.{edge['target_port']}"
                ),
                "forwarded_frames": edge.get("forwarded_frames", 0),
                "queue_size": edge.get("queue_size", 0),
                "queue_peak_size": edge.get("queue_peak_size", 0),
            }
            for edge in snapshot["edge_states"]
        ]
        node_metrics = {
            node_id: state.get("metrics", {})
            for node_id, state in snapshot["node_states"].items()
        }
        return {
            "run_id": snapshot["run_id"],
            "graph_id": snapshot["graph_id"],
            "status": snapshot["status"],
            "created_at": snapshot["created_at"],
            "started_at": snapshot["started_at"],
            "ended_at": snapshot["ended_at"],
            "task_done": snapshot["task_done"],
            "graph_metrics": snapshot.get("metrics", {}),
            "node_metrics": node_metrics,
            "edge_metrics": edge_metrics,
        }

    def get_run_diagnostics(self, run_id: str) -> dict[str, Any]:
        """获取运行诊断视图。"""
        snapshot = self.get_run_snapshot(run_id)
        graph_metrics = snapshot.get("metrics")
        if not isinstance(graph_metrics, dict):
            graph_metrics = {}
        failed_nodes: list[dict[str, Any]] = []
        slow_nodes: list[dict[str, Any]] = []

        for node_id, state in snapshot["node_states"].items():
            metrics = state.get("metrics", {})
            if state.get("status") == "failed":
                failed_nodes.append(
                    {
                        "node_id": node_id,
                        "last_error": state.get("last_error"),
                        "error_code": metrics.get("last_error_code"),
                        "retryable": metrics.get("last_error_retryable"),
                    }
                )

            duration_ms = metrics.get("duration_ms")
            if isinstance(duration_ms, int):
                slow_nodes.append(
                    {
                        "node_id": node_id,
                        "duration_ms": duration_ms,
                        "retry_count": metrics.get("retry_count", 0),
                        "timeout_count": metrics.get("timeout_count", 0),
                    }
                )

        slow_nodes.sort(key=lambda item: item["duration_ms"], reverse=True)

        edge_hotspots = [
            {
                "edge": (
                    f"{edge['source_node']}.{edge['source_port']}"
                    f"->{edge['target_node']}.{edge['target_port']}"
                ),
                "queue_peak_size": edge.get("queue_peak_size", 0),
                "forwarded_frames": edge.get("forwarded_frames", 0),
            }
            for edge in snapshot["edge_states"]
            if int(edge.get("queue_peak_size", 0)) > 0
        ]
        edge_hotspots.sort(key=lambda item: item["queue_peak_size"], reverse=True)
        event_window = self._build_event_window_metrics(graph_metrics)

        return {
            "run_id": snapshot["run_id"],
            "graph_id": snapshot["graph_id"],
            "status": snapshot["status"],
            "task_done": snapshot["task_done"],
            "last_error": snapshot.get("last_error"),
            "failed_nodes": failed_nodes,
            "slow_nodes_top": slow_nodes[:5],
            "edge_hotspots_top": edge_hotspots[:5],
            "event_window": event_window,
            "capacity": {
                "max_active_runs": self.max_active_runs,
                "active_runs": self._count_active_runs(),
                "retained_runs": len(self._runs),
            },
        }

    def get_service_metrics_snapshot(self) -> dict[str, Any]:
        """返回服务级聚合指标（用于运维采集）。"""
        self._prune_runs(now=time.time())
        status_counts: dict[str, int] = {
            "running": 0,
            "completed": 0,
            "failed": 0,
            "stopped": 0,
            "idle": 0,
        }
        event_total = 0
        event_retained = 0
        event_dropped = 0
        for record in self._runs.values():
            status = record.status
            status_counts[status] = int(status_counts.get(status, 0)) + 1
            runtime = record.scheduler.runtime_state
            if runtime is None:
                continue
            event_total += int(runtime.metrics.get("event_total", 0))
            event_retained += int(runtime.metrics.get("event_retained", 0))
            event_dropped += int(runtime.metrics.get("event_dropped", 0))

        capacity_limit = self.max_active_runs
        active_runs = self._count_active_runs()
        if capacity_limit > 0:
            capacity_utilization = round(active_runs / capacity_limit, 6)
        else:
            capacity_utilization = 0.0
        if event_total > 0:
            events_drop_ratio = round(event_dropped / event_total, 6)
            events_retention_ratio = round(event_retained / event_total, 6)
        else:
            events_drop_ratio = 0.0
            events_retention_ratio = 0.0

        return {
            "runs_retained": len(self._runs),
            "runs_active": active_runs,
            "runs_completed": status_counts.get("completed", 0),
            "runs_failed": status_counts.get("failed", 0),
            "runs_stopped": status_counts.get("stopped", 0),
            "runs_idle": status_counts.get("idle", 0),
            "run_capacity_limit": capacity_limit,
            "run_capacity_utilization": capacity_utilization,
            "runs_status_counts": status_counts,
            "events_total": event_total,
            "events_retained": event_retained,
            "events_dropped": event_dropped,
            "events_drop_ratio": events_drop_ratio,
            "events_retention_ratio": events_retention_ratio,
        }

    async def stop_all(self) -> None:
        """停止所有运行实例（主要供测试清理使用）。"""
        async with self._lock:
            self._prune_runs(now=time.time())
            run_ids = list(self._runs.keys())
        for run_id in run_ids:
            await self.stop_run(run_id)

    def _get_or_raise(self, run_id: str) -> RunRecord:
        try:
            return self._runs[run_id]
        except KeyError as exc:
            raise RunNotFoundError(f"运行实例不存在: {run_id}") from exc

    def _prune_runs(self, *, now: float) -> None:
        """同步触发运行记录裁剪。"""
        self._prune_runs_locked(now=now)

    def _prune_runs_locked(self, *, now: float) -> None:
        """清理终态且过期/超额的运行记录。"""
        if not self._runs:
            return

        # 先按 TTL 删除已过期的终态记录。
        expired_run_ids = [
            run_id
            for run_id, record in self._runs.items()
            if (
                record.task.done()
                and (terminal_time := self._terminal_reference_time(record)) is not None
                and now - terminal_time >= self.retention_ttl_s
            )
        ]
        for run_id in expired_run_ids:
            self._runs.pop(run_id, None)

        # 再按容量上限删除最老的终态记录。
        if len(self._runs) <= self.max_retained_runs:
            return

        terminal_records = [
            (run_id, record)
            for run_id, record in self._runs.items()
            if record.task.done()
        ]
        terminal_records.sort(key=lambda item: item[1].created_at)

        overflow = len(self._runs) - self.max_retained_runs
        for run_id, _record in terminal_records[:overflow]:
            self._runs.pop(run_id, None)

    @staticmethod
    def _build_event_window_metrics(graph_metrics: dict[str, Any]) -> dict[str, Any]:
        """构造事件窗口诊断指标。"""
        event_total = int(graph_metrics.get("event_total", 0))
        event_retained = int(graph_metrics.get("event_retained", 0))
        event_dropped = int(graph_metrics.get("event_dropped", 0))
        drop_ratio = (
            float(graph_metrics.get("event_drop_ratio", 0.0))
            if event_total > 0
            else 0.0
        )
        retention_ratio = (
            float(graph_metrics.get("event_retention_ratio", 0.0))
            if event_total > 0
            else 0.0
        )
        return {
            "event_total": event_total,
            "event_retained": event_retained,
            "event_dropped": event_dropped,
            "drop_ratio": drop_ratio,
            "retention_ratio": retention_ratio,
        }

    def _ensure_capacity_locked(self) -> None:
        """校验当前运行并发是否超过上限。"""
        if self.max_active_runs <= 0:
            return
        active_runs = sum(1 for record in self._runs.values() if not record.task.done())
        if active_runs >= self.max_active_runs:
            raise RunCapacityExceededError(
                f"并发运行已达上限: active={active_runs}, limit={self.max_active_runs}"
            )

    def _count_active_runs(self) -> int:
        """统计当前活跃运行数。"""
        return sum(1 for record in self._runs.values() if not record.task.done())

    @staticmethod
    def _terminal_reference_time(record: RunRecord) -> float | None:
        """返回用于 TTL 清理的终态时间。"""
        if not record.task.done():
            return None
        runtime = record.scheduler.runtime_state
        if runtime is not None and runtime.ended_at is not None:
            return float(runtime.ended_at)
        return record.created_at

    @staticmethod
    def _normalize_stream_id(raw_value: Any) -> str:
        """规范化 stream_id，并拒绝空白或非字符串值。"""
        if not isinstance(raw_value, str):
            raise InvalidRunRequestError(f"非法 stream_id 值: {raw_value!r}")
        stream_id = raw_value.strip()
        if not stream_id:
            raise InvalidRunRequestError("stream_id 不能为空")
        return stream_id


_run_service_singleton: RunService | None = None


def _default_node_factory_builder() -> NodeFactory:
    secret_service = get_secret_service()

    def _config_resolver(node, spec):
        return resolve_secret_refs(
            spec.config_schema,
            node.config,
            resolve_secret=secret_service.resolve_value,
        )

    return create_default_node_factory(config_resolver=_config_resolver)


def get_run_service() -> RunService:
    """获取全局运行服务。"""
    global _run_service_singleton
    if _run_service_singleton is None:
        _run_service_singleton = RunService(node_factory_builder=_default_node_factory_builder)
    return _run_service_singleton


def reset_run_service_for_testing() -> None:
    """重置全局运行服务（供测试隔离使用）。"""
    global _run_service_singleton
    _run_service_singleton = RunService(node_factory_builder=_default_node_factory_builder)


__all__ = [
    "InvalidRunRequestError",
    "RunCapacityExceededError",
    "RunNotFoundError",
    "RunRecord",
    "RunService",
    "get_run_service",
    "reset_run_service_for_testing",
]
