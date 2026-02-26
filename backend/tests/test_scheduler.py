"""GraphScheduler 运行测试。"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.core.frame import RuntimeEventType
from app.core.graph_builder import GraphBuilder
from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_factory import NodeFactory, create_default_node_factory
from app.core.registry import create_default_registry
from app.core.scheduler import GraphScheduler
from app.core.spec import EdgeSpec, GraphSpec, NodeInstanceSpec, NodeMode, NodeSpec, PortSpec


class SlowPassthroughNode(AsyncNode):
    """用于 stop 路径测试的慢节点。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        await asyncio.sleep(float(self.config.get("delay_s", 0.5)))
        return {"text": str(inputs.get("text", ""))}


class FailingNode(AsyncNode):
    """用于异常路径测试的失败节点。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        raise RuntimeError("boom from failing node")


class IncompleteOutputNode(AsyncNode):
    """返回不完整输出的节点（缺少已连接端口的数据）。"""

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        return {}


def _build_registry_with_custom_nodes() -> GraphBuilder:
    registry = create_default_registry()
    registry.register(
        NodeSpec(
            type_name="test.slow",
            mode=NodeMode.ASYNC,
            inputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
            outputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
            description="slow passthrough",
        )
    )
    registry.register(
        NodeSpec(
            type_name="test.fail",
            mode=NodeMode.ASYNC,
            inputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
            outputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
            description="always failing node",
        )
    )
    registry.register(
        NodeSpec(
            type_name="test.incomplete_output",
            mode=NodeMode.ASYNC,
            inputs=[],
            outputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
            description="returns empty output despite having connected port",
        )
    )
    return GraphBuilder(registry)


def _build_factory_with_custom_nodes() -> NodeFactory:
    factory = create_default_node_factory()
    factory.register("test.slow", SlowPassthroughNode)
    factory.register("test.fail", FailingNode)
    factory.register("test.incomplete_output", IncompleteOutputNode)
    return factory


def test_scheduler_runs_basic_chain() -> None:
    """最小链路应可执行完成。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_basic",
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
        compiled = GraphBuilder(create_default_registry()).build(graph)
        scheduler = GraphScheduler()
        state = await scheduler.run(compiled, run_id="run_scheduler_basic", stream_id="s_basic")

        assert state.status == "completed"
        assert state.node_states["n1"].status == "finished"
        assert state.node_states["n2"].status == "finished"
        assert state.node_states["n3"].status == "finished"

        events, _ = scheduler.get_events(since=0, limit=100)
        event_types = {event.event_type for event in events}
        assert RuntimeEventType.RUN_STARTED in event_types
        assert RuntimeEventType.NODE_FINISHED in event_types
        assert RuntimeEventType.RUN_STOPPED in event_types

    asyncio.run(_run())


def test_scheduler_stop_interrupts_running_nodes() -> None:
    """stop 应能停止运行中的慢节点。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_stop",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(
                    node_id="n2",
                    type_name="test.slow",
                    config={"delay_s": 1.0},
                ),
                NodeInstanceSpec(node_id="n3", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
                EdgeSpec(source_node="n2", source_port="text", target_node="n3", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())

        task = asyncio.create_task(scheduler.run(compiled, run_id="run_scheduler_stop"))
        await asyncio.sleep(0.08)
        scheduler.stop()
        state = await task

        assert state.status == "stopped"
        assert state.node_states["n2"].status == "stopped"

    asyncio.run(_run())


def test_scheduler_marks_failed_on_node_exception() -> None:
    """节点异常应被捕获并标记运行失败。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_fail",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(node_id="n2", type_name="test.fail"),
                NodeInstanceSpec(node_id="n3", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
                EdgeSpec(source_node="n2", source_port="text", target_node="n3", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())

        state = await scheduler.run(compiled, run_id="run_scheduler_fail")
        assert state.status == "failed"
        assert state.node_states["n2"].status == "failed"
        assert "boom from failing node" in (state.node_states["n2"].last_error or "")

        events, _ = scheduler.get_events(since=0, limit=100)
        assert any(event.event_type == RuntimeEventType.NODE_FAILED for event in events)

    asyncio.run(_run())


def test_scheduler_clamps_negative_event_cursor() -> None:
    """事件查询游标为负数时应自动归零。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_events",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(node_id="n2", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="in"),
            ],
        )
        compiled = GraphBuilder(create_default_registry()).build(graph)
        scheduler = GraphScheduler()
        await scheduler.run(compiled, run_id="run_scheduler_events")

        events, next_cursor = scheduler.get_events(since=-99, limit=2)
        assert len(events) <= 2
        assert next_cursor == len(events)

    asyncio.run(_run())


def test_scheduler_stop_before_run_finishes_as_stopped() -> None:
    """在 run 前先调用 stop，运行终态应为 stopped。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_pre_stop",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(node_id="n2", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="in"),
            ],
        )
        compiled = GraphBuilder(create_default_registry()).build(graph)
        scheduler = GraphScheduler()
        scheduler.stop()
        state = await scheduler.run(compiled, run_id="run_scheduler_pre_stop")
        assert state.status == "stopped"
        # 源节点（无必需输入）在 stop 后也不应执行
        assert state.node_states["n1"].status == "stopped"
        assert state.node_states["n2"].status == "stopped"

    asyncio.run(_run())


def test_scheduler_rejects_concurrent_run_calls() -> None:
    """同一个调度器不允许并发 run。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_concurrent",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="mock.input"),
                NodeInstanceSpec(
                    node_id="n2",
                    type_name="test.slow",
                    config={"delay_s": 0.3},
                ),
                NodeInstanceSpec(node_id="n3", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
                EdgeSpec(source_node="n2", source_port="text", target_node="n3", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())

        running_task = asyncio.create_task(scheduler.run(compiled, run_id="run_scheduler_concurrent"))
        await asyncio.sleep(0.05)
        with pytest.raises(RuntimeError):
            await scheduler.run(compiled, run_id="run_scheduler_concurrent_2")
        scheduler.stop()
        await running_task

    asyncio.run(_run())


def test_scheduler_fails_when_node_omits_connected_output() -> None:
    """节点未输出已连接端口的数据时，运行应失败而非死锁。"""

    async def _run() -> None:
        graph = GraphSpec(
            graph_id="g_scheduler_incomplete",
            nodes=[
                NodeInstanceSpec(node_id="n1", type_name="test.incomplete_output"),
                NodeInstanceSpec(node_id="n2", type_name="mock.output"),
            ],
            edges=[
                EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="in"),
            ],
        )
        builder = _build_registry_with_custom_nodes()
        compiled = builder.build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory_with_custom_nodes())

        state = await scheduler.run(compiled, run_id="run_scheduler_incomplete")
        assert state.status == "failed"
        assert state.node_states["n1"].status == "failed"
        assert "text" in (state.node_states["n1"].last_error or "")

    asyncio.run(_run())
