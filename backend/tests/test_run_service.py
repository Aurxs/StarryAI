"""RunService 业务层测试。"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_factory import NodeFactory, create_default_node_factory
from app.core.registry import create_default_registry
from app.core.spec import EdgeSpec, GraphSpec, NodeInstanceSpec, NodeMode, NodeSpec, PortSpec
from app.services.run_service import RunNotFoundError, RunService


class SlowPassNode(AsyncNode):
    """用于 stop_all 测试的慢节点。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        await asyncio.sleep(float(self.config.get("delay_s", 0.6)))
        return {"text": str(inputs.get("text", ""))}


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

        page1, cursor1 = service.get_run_events(record.run_id, since=0, limit=2)
        assert len(page1) <= 2
        page2, cursor2 = service.get_run_events(record.run_id, since=cursor1, limit=100)
        assert cursor2 >= cursor1
        assert len(page1) + len(page2) >= 1

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
        assert snapshot["node_states"]["n4"]["metrics"]["sync_emitted"] >= 1

        events, _ = service.get_run_events(record.run_id, since=0, limit=300)
        sync_events = [event for event in events if event.event_type.value == "sync_frame_emitted"]
        assert len(sync_events) >= 1
        assert sync_events[0].details["stream_id"] == "stream_service_sync"
        assert sync_events[0].details["seq"] == 0

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
