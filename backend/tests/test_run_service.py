"""RunService 业务层测试。"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import pytest

from app.core.errors import ErrorCode
from app.core.frame import RuntimeEventType
from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_factory import NodeFactory, create_default_node_factory
from app.core.registry import create_default_registry
from app.core.scheduler import GraphScheduler, SchedulerConfig
from app.core.spec import EdgeSpec, GraphSpec, NodeInstanceSpec, NodeMode, NodeSpec, PortSpec
from app.services.run_service import RunCapacityExceededError, RunNotFoundError, RunRecord, RunService


class SlowPassNode(AsyncNode):
    """用于 stop_all 测试的慢节点。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        await asyncio.sleep(float(self.config.get("delay_s", 0.6)))
        return {"text": str(inputs.get("text", ""))}


class AlwaysFailNode(AsyncNode):
    """用于 continue_on_error 策略测试的失败节点。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        raise RuntimeError("always fail")


def _basic_graph(graph_id: str = "g_service_basic") -> GraphSpec:
    return GraphSpec(
        graph_id=graph_id,
        nodes=[
            NodeInstanceSpec(node_id="n1", type_name="mock.input"),
            NodeInstanceSpec(node_id="n2", type_name="mock.llm"),
            NodeInstanceSpec(node_id="n3", type_name="mock.output"),
        ],
        edges=[
            EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="prompt"),
            EdgeSpec(source_node="n2", source_port="answer", target_node="n3", target_port="in"),
        ],
    )


def _slow_graph(graph_id: str = "g_service_slow") -> GraphSpec:
    return GraphSpec(
        graph_id=graph_id,
        nodes=[
            NodeInstanceSpec(node_id="n1", type_name="mock.input"),
            NodeInstanceSpec(
                node_id="n2",
                type_name="test.slow.service",
                config={"delay_s": 1.0},
            ),
            NodeInstanceSpec(node_id="n3", type_name="mock.output"),
        ],
        edges=[
            EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
            EdgeSpec(source_node="n2", source_port="text", target_node="n3", target_port="in"),
        ],
    )


def _sync_graph(graph_id: str = "g_service_sync") -> GraphSpec:
    return GraphSpec(
        graph_id=graph_id,
        nodes=[
            NodeInstanceSpec(node_id="n1", type_name="mock.input"),
            NodeInstanceSpec(node_id="n2", type_name="mock.tts"),
            NodeInstanceSpec(node_id="n3", type_name="mock.motion"),
            NodeInstanceSpec(node_id="n4", type_name="sync.timeline"),
            NodeInstanceSpec(node_id="n5", type_name="mock.output"),
        ],
        edges=[
            EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
            EdgeSpec(source_node="n1", source_port="text", target_node="n3", target_port="text"),
            EdgeSpec(source_node="n2", source_port="audio", target_node="n4", target_port="audio"),
            EdgeSpec(source_node="n3", source_port="motion", target_node="n4", target_port="motion"),
            EdgeSpec(source_node="n4", source_port="sync", target_node="n5", target_port="in"),
        ],
    )


def _continue_on_error_graph(graph_id: str = "g_service_continue") -> GraphSpec:
    return GraphSpec(
        graph_id=graph_id,
        nodes=[
            NodeInstanceSpec(node_id="n1", type_name="mock.input"),
            NodeInstanceSpec(
                node_id="n2",
                type_name="test.fail.service",
                config={"continue_on_error": True},
            ),
            NodeInstanceSpec(node_id="n3", type_name="mock.output"),
        ],
        edges=[
            EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
            EdgeSpec(source_node="n1", source_port="text", target_node="n3", target_port="in"),
        ],
    )


def _continue_on_error_wakeup_graph(graph_id: str = "g_service_continue_wakeup") -> GraphSpec:
    return GraphSpec(
        graph_id=graph_id,
        nodes=[
            NodeInstanceSpec(node_id="n1", type_name="mock.input"),
            NodeInstanceSpec(
                node_id="n2",
                type_name="test.fail.service",
                config={"continue_on_error": True},
            ),
            NodeInstanceSpec(node_id="n3", type_name="mock.output"),
        ],
        edges=[
            EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
            EdgeSpec(source_node="n2", source_port="text", target_node="n3", target_port="in"),
        ],
    )


def _critical_fail_fast_graph(graph_id: str = "g_service_critical") -> GraphSpec:
    return GraphSpec(
        graph_id=graph_id,
        nodes=[
            NodeInstanceSpec(node_id="n1", type_name="mock.input"),
            NodeInstanceSpec(
                node_id="n2",
                type_name="test.fail.service",
                config={"continue_on_error": True, "critical": True},
            ),
            NodeInstanceSpec(node_id="n3", type_name="mock.output"),
        ],
        edges=[
            EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
            EdgeSpec(source_node="n1", source_port="text", target_node="n3", target_port="in"),
        ],
    )


def _build_service_with_slow_node() -> RunService:
    registry = create_default_registry()
    registry.register(
        NodeSpec(
            type_name="test.slow.service",
            mode=NodeMode.ASYNC,
            inputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
            outputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
            description="slow passthrough node",
        )
    )

    def node_factory_builder() -> NodeFactory:
        factory = create_default_node_factory()
        factory.register("test.slow.service", SlowPassNode)
        return factory

    return RunService(registry=registry, node_factory_builder=node_factory_builder)


def _build_service_with_fail_node() -> RunService:
    registry = create_default_registry()
    registry.register(
        NodeSpec(
            type_name="test.fail.service",
            mode=NodeMode.ASYNC,
            inputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
            outputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
            description="always failing service node",
        )
    )

    def node_factory_builder() -> NodeFactory:
        factory = create_default_node_factory()
        factory.register("test.fail.service", AlwaysFailNode)
        return factory

    return RunService(registry=registry, node_factory_builder=node_factory_builder)


def test_run_service_create_and_snapshot_and_events() -> None:
    """create_run 后应能查询状态与事件。"""

    async def _run() -> None:
        service = RunService()
        record = await service.create_run(_basic_graph(), stream_id="stream_service")
        await record.task

        snapshot = service.get_run_snapshot(record.run_id)
        assert snapshot["status"] == "completed"
        assert snapshot["stream_id"] == "stream_service"
        assert snapshot["task_done"] is True
        assert snapshot["metrics"]["event_total"] >= 1

        page1, cursor1 = service.get_run_events(record.run_id, since=0, limit=2)
        assert len(page1) <= 2
        page2, cursor2 = service.get_run_events(record.run_id, since=cursor1, limit=100)
        assert cursor2 >= cursor1
        assert len(page1) + len(page2) >= 1

    asyncio.run(_run())


def test_run_service_rejects_blank_stream_id() -> None:
    """create_run 应拒绝空白 stream_id。"""

    async def _run() -> None:
        service = RunService()
        with pytest.raises(ValueError, match="stream_id"):
            await service.create_run(_basic_graph("g_service_blank_stream"), stream_id="   ")

    asyncio.run(_run())


def test_run_service_snapshot_includes_task_error_without_runtime_state() -> None:
    """运行任务在 runtime 初始化前失败时，快照应包含 last_error。"""

    async def _run() -> None:
        service = RunService()
        scheduler = GraphScheduler()

        async def _boom() -> Any:
            raise RuntimeError("task exploded before runtime init")

        task = asyncio.create_task(_boom())
        await asyncio.gather(task, return_exceptions=True)

        record = RunRecord(
            run_id="run_snapshot_task_error",
            graph_id="g_snapshot_task_error",
            stream_id="stream_snapshot",
            created_at=time.time(),
            scheduler=scheduler,
            task=task,
        )
        service._runs[record.run_id] = record

        snapshot = service.get_run_snapshot(record.run_id)
        assert snapshot["status"] == "failed"
        assert "task exploded before runtime init" in (snapshot["last_error"] or "")

    asyncio.run(_run())


def test_run_service_diagnostics_defaults_when_runtime_missing() -> None:
    """runtime_state 缺失时 diagnostics 仍应返回可消费的窗口指标。"""

    async def _run() -> None:
        service = RunService()
        scheduler = GraphScheduler()

        async def _boom() -> Any:
            raise RuntimeError("task exploded before runtime init")

        task = asyncio.create_task(_boom())
        await asyncio.gather(task, return_exceptions=True)
        record = RunRecord(
            run_id="run_diag_task_error",
            graph_id="g_diag_task_error",
            stream_id="stream_diag_task_error",
            created_at=time.time(),
            scheduler=scheduler,
            task=task,
        )
        service._runs[record.run_id] = record

        diagnostics = service.get_run_diagnostics(record.run_id)
        assert diagnostics["status"] == "failed"
        assert diagnostics["event_window"]["event_total"] == 0
        assert diagnostics["event_window"]["event_dropped"] == 0
        assert diagnostics["event_window"]["drop_ratio"] == 0.0

    asyncio.run(_run())


def test_run_service_not_found_paths() -> None:
    """不存在的 run_id 应抛 RunNotFoundError。"""
    service = RunService()
    with pytest.raises(RunNotFoundError):
        service.get_run("missing")
    with pytest.raises(RunNotFoundError):
        service.get_run_snapshot("missing")
    with pytest.raises(RunNotFoundError):
        service.get_run_events("missing")


def test_run_service_stop_all_stops_inflight_runs() -> None:
    """stop_all 应能停止运行中的任务。"""

    async def _run() -> None:
        service = _build_service_with_slow_node()
        run1 = await service.create_run(_slow_graph("g_service_slow_1"))
        run2 = await service.create_run(_slow_graph("g_service_slow_2"))

        await asyncio.sleep(0.08)
        await service.stop_all()

        assert run1.task.done() is True
        assert run2.task.done() is True

        status1 = service.get_run_snapshot(run1.run_id)["status"]
        status2 = service.get_run_snapshot(run2.run_id)["status"]
        assert status1 in {"stopped", "completed"}
        assert status2 in {"stopped", "completed"}

    asyncio.run(_run())


def test_run_service_stop_run_not_found_raises() -> None:
    """stop_run 对不存在 run_id 应抛错。"""

    async def _run() -> None:
        service = RunService()
        with pytest.raises(RunNotFoundError):
            await service.stop_run("missing")

    asyncio.run(_run())


def test_run_service_sync_run_exposes_sync_metrics_and_events() -> None:
    """同步链路运行后，快照和事件应包含同步信息。"""

    async def _run() -> None:
        service = RunService()
        record = await service.create_run(_sync_graph(), stream_id="stream_service_sync")
        await record.task

        snapshot = service.get_run_snapshot(record.run_id)
        assert snapshot["status"] == "completed"
        assert snapshot["metrics"]["edge_forwarded_frames"] >= 1
        assert snapshot["node_states"]["n4"]["metrics"]["sync_emitted"] >= 1

        events, _ = service.get_run_events(record.run_id, since=0, limit=300)
        sync_events = [event for event in events if event.event_type.value == "sync_frame_emitted"]
        assert len(sync_events) >= 1
        assert sync_events[0].details["stream_id"] == "stream_service_sync"
        assert sync_events[0].details["seq"] == 0

    asyncio.run(_run())


def test_run_service_get_run_events_supports_filters() -> None:
    """事件查询应支持 event_type/node_id/error_code 等过滤参数。"""

    async def _run() -> None:
        service = RunService()
        record = await service.create_run(_sync_graph("g_service_sync_filter"), stream_id="stream_filter")
        await record.task

        all_events, _ = service.get_run_events(record.run_id, since=0, limit=500)
        assert len(all_events) >= 1

        sync_events, _ = service.get_run_events(
            record.run_id,
            since=0,
            limit=200,
            event_type=RuntimeEventType.SYNC_FRAME_EMITTED,
        )
        assert len(sync_events) >= 1
        assert all(item.event_type == RuntimeEventType.SYNC_FRAME_EMITTED for item in sync_events)

        node_events, _ = service.get_run_events(
            record.run_id,
            since=0,
            limit=200,
            node_id="n4",
        )
        assert len(node_events) >= 1
        assert all(item.node_id == "n4" for item in node_events)

        missing_code_events, next_cursor = service.get_run_events(
            record.run_id,
            since=0,
            limit=200,
            error_code="non.existing.code",
        )
        assert missing_code_events == []
        assert next_cursor == len(all_events)

    asyncio.run(_run())


def test_run_service_prunes_completed_runs_when_over_limit() -> None:
    """超出保留上限时应清理最旧的终态运行记录。"""

    async def _run() -> None:
        service = RunService(max_retained_runs=2, retention_ttl_s=3600.0)

        run1 = await service.create_run(_basic_graph("g_prune_1"))
        await run1.task
        run2 = await service.create_run(_basic_graph("g_prune_2"))
        await run2.task
        run3 = await service.create_run(_basic_graph("g_prune_3"))
        await run3.task

        with pytest.raises(RunNotFoundError):
            service.get_run(run1.run_id)
        assert service.get_run(run2.run_id).run_id == run2.run_id
        assert service.get_run(run3.run_id).run_id == run3.run_id

    asyncio.run(_run())


def test_run_service_rejects_create_when_active_runs_reach_limit() -> None:
    """active run 达到上限时，应拒绝新建运行实例。"""

    async def _run() -> None:
        service = _build_service_with_slow_node()
        service.max_active_runs = 1
        active = await service.create_run(_slow_graph("g_service_capacity_active"))

        await asyncio.sleep(0.05)
        with pytest.raises(RunCapacityExceededError):
            await service.create_run(_slow_graph("g_service_capacity_rejected"))

        await service.stop_run(active.run_id)

    asyncio.run(_run())


def test_run_service_continue_on_error_completes_run() -> None:
    """continue_on_error 非关键节点失败不应拖垮整图。"""

    async def _run() -> None:
        service = _build_service_with_fail_node()
        record = await service.create_run(_continue_on_error_graph(), stream_id="stream_continue")
        await record.task

        snapshot = service.get_run_snapshot(record.run_id)
        assert snapshot["status"] == "completed"
        assert snapshot["node_states"]["n2"]["status"] == "failed"
        assert snapshot["node_states"]["n2"]["metrics"]["continued_on_error"] is True
        assert snapshot["node_states"]["n3"]["status"] == "finished"

    asyncio.run(_run())


def test_run_service_critical_failure_keeps_fail_fast() -> None:
    """关键节点失败应保持 fail-fast。"""

    async def _run() -> None:
        service = _build_service_with_fail_node()
        record = await service.create_run(_critical_fail_fast_graph(), stream_id="stream_critical")
        await record.task

        snapshot = service.get_run_snapshot(record.run_id)
        assert snapshot["status"] == "failed"
        assert snapshot["node_states"]["n2"]["status"] == "failed"

    asyncio.run(_run())


def test_run_service_metrics_and_diagnostics_views() -> None:
    """RunService 应提供独立 metrics/diagnostics 视图。"""

    async def _run() -> None:
        service = _build_service_with_fail_node()
        record = await service.create_run(_critical_fail_fast_graph("g_service_diag"), stream_id="stream_diag")
        await record.task

        metrics = service.get_run_metrics(record.run_id)
        assert metrics["run_id"] == record.run_id
        assert "graph_metrics" in metrics
        assert "node_metrics" in metrics
        assert "edge_metrics" in metrics

        diagnostics = service.get_run_diagnostics(record.run_id)
        assert diagnostics["run_id"] == record.run_id
        assert diagnostics["status"] == "failed"
        assert len(diagnostics["failed_nodes"]) >= 1
        assert "edge_hotspots_top" in diagnostics
        assert "event_window" in diagnostics
        assert "capacity" in diagnostics
        assert diagnostics["event_window"]["event_total"] >= 1
        assert diagnostics["capacity"]["retained_runs"] >= 1

    asyncio.run(_run())


def test_run_service_diagnostics_event_window_reports_drop_ratio() -> None:
    """事件窗口启用裁剪后，diagnostics 应返回 drop/retention 指标。"""

    async def _run() -> None:
        service = RunService(scheduler_config=SchedulerConfig(max_retained_events=3))
        record = await service.create_run(_basic_graph("g_service_event_window"), stream_id="stream_event_window")
        await record.task

        diagnostics = service.get_run_diagnostics(record.run_id)
        event_window = diagnostics["event_window"]
        assert event_window["event_total"] > 0
        assert event_window["event_retained"] <= 3
        assert event_window["event_dropped"] >= 1
        assert 0.0 <= float(event_window["drop_ratio"]) <= 1.0
        assert 0.0 <= float(event_window["retention_ratio"]) <= 1.0

    asyncio.run(_run())


def test_run_service_diagnostics_exposes_input_unavailable_metadata() -> None:
    """输入不可达失败应在 diagnostics 中返回结构化错误信息。"""

    async def _run() -> None:
        service = _build_service_with_fail_node()
        record = await service.create_run(
            _continue_on_error_wakeup_graph("g_service_diag_input_unavailable"),
            stream_id="stream_diag_input_unavailable",
        )
        await record.task

        diagnostics = service.get_run_diagnostics(record.run_id)
        failed_nodes = {item["node_id"]: item for item in diagnostics["failed_nodes"]}
        assert failed_nodes["n3"]["error_code"] == ErrorCode.NODE_INPUT_UNAVAILABLE.value
        assert failed_nodes["n3"]["retryable"] is False

    asyncio.run(_run())


def test_run_service_service_metrics_snapshot() -> None:
    """服务级指标快照应返回可观测聚合值。"""

    async def _run() -> None:
        service = RunService()
        record = await service.create_run(_basic_graph("g_service_metrics_snapshot"), stream_id="stream_metrics")
        await record.task

        snapshot = service.get_service_metrics_snapshot()
        assert snapshot["runs_retained"] >= 1
        assert snapshot["runs_completed"] >= 1
        assert snapshot["runs_active"] == 0
        assert snapshot["events_total"] >= 1
        assert snapshot["events_retained"] >= 1
        assert snapshot["events_dropped"] >= 0
        assert "runs_status_counts" in snapshot
        assert snapshot["runs_status_counts"]["completed"] >= 1
        assert 0.0 <= float(snapshot["run_capacity_utilization"]) <= 1.0
        assert 0.0 <= float(snapshot["events_drop_ratio"]) <= 1.0
        assert 0.0 <= float(snapshot["events_retention_ratio"]) <= 1.0

    asyncio.run(_run())
