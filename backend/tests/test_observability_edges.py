"""可观测性与稳定性边缘场景测试（T8）。"""

from __future__ import annotations

import asyncio
from typing import Any

from app.core.frame import RuntimeEventType
from app.core.graph_builder import GraphBuilder
from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_factory import NodeFactory, create_default_node_factory
from app.core.registry import create_default_registry
from app.core.scheduler import GraphScheduler
from app.core.spec import EdgeSpec, GraphSpec, NodeInstanceSpec, NodeMode, NodeSpec, PortSpec
from app.services.run_service import RunService


class EdgeFickleNode(AsyncNode):
    """失败若干次后成功。"""

    def __init__(
            self,
            node_id: str,
            spec: NodeSpec,
            config: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(node_id=node_id, spec=spec, config=config)
        self._attempt = 0

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        self._attempt += 1
        fail_times = int(self.config.get("fail_times", 0))
        if self._attempt <= fail_times:
            raise RuntimeError("fickle failure")
        return {"text": str(inputs.get("text", ""))}


class EdgeSlowNode(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        await asyncio.sleep(float(self.config.get("delay_s", 0.05)))
        return {"text": str(inputs.get("text", ""))}


class EdgeNonRetryableNode(AsyncNode):
    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = inputs
        _ = context
        raise ValueError("non-retryable edge case")


def _build_registry() -> GraphBuilder:
    registry = create_default_registry()
    for type_name in ["test.edge_fickle", "test.edge_slow", "test.edge_non_retryable"]:
        registry.register(
            NodeSpec(
                type_name=type_name,
                mode=NodeMode.ASYNC,
                inputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
                outputs=[PortSpec(name="text", frame_schema="text.final", required=True)],
                description=f"{type_name} node",
            )
        )
    return GraphBuilder(registry)


def _build_factory() -> NodeFactory:
    factory = create_default_node_factory()
    factory.register("test.edge_fickle", EdgeFickleNode)
    factory.register("test.edge_slow", EdgeSlowNode)
    factory.register("test.edge_non_retryable", EdgeNonRetryableNode)
    return factory


def _graph_for_middle(middle_type: str, middle_config: dict[str, Any], graph_id: str) -> GraphSpec:
    return GraphSpec(
        graph_id=graph_id,
        nodes=[
            NodeInstanceSpec(node_id="n1", type_name="mock.input"),
            NodeInstanceSpec(node_id="n2", type_name=middle_type, config=middle_config),
            NodeInstanceSpec(node_id="n3", type_name="mock.output"),
        ],
        edges=[
            EdgeSpec(source_node="n1", source_port="text", target_node="n2", target_port="text"),
            EdgeSpec(source_node="n2", source_port="text", target_node="n3", target_port="in"),
        ],
    )


def test_scheduler_events_empty_and_negative_cursor() -> None:
    scheduler = GraphScheduler()
    events, cursor = scheduler.get_events_filtered(since=-999, limit=10, node_id="missing")
    assert events == []
    assert cursor == 0


def test_scheduler_timeout_with_zero_retry_edge_case() -> None:
    async def _run() -> None:
        graph = _graph_for_middle(
            "test.edge_slow",
            {"delay_s": 0.03, "timeout_s": 0.001, "max_retries": 0},
            "g_edge_timeout_zero_retry",
        )
        compiled = _build_registry().build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory())
        state = await scheduler.run(compiled, run_id="run_edge_timeout_zero_retry")
        assert state.status == "failed"
        assert state.node_states["n2"].metrics["attempt_count"] == 1
        assert state.node_states["n2"].metrics["retry_count"] == 0
        assert state.node_states["n2"].metrics["last_error_code"] == "node.timeout"

        events, _ = scheduler.get_events(since=0, limit=300)
        assert len([e for e in events if e.event_type == RuntimeEventType.NODE_TIMEOUT]) == 1
        assert len([e for e in events if e.event_type == RuntimeEventType.NODE_RETRY]) == 0

    asyncio.run(_run())


def test_scheduler_huge_retry_config_does_not_over_retry() -> None:
    async def _run() -> None:
        graph = _graph_for_middle(
            "test.edge_fickle",
            {"fail_times": 2, "max_retries": 100, "retry_backoff_ms": 0},
            "g_edge_huge_retry",
        )
        compiled = _build_registry().build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory())
        state = await scheduler.run(compiled, run_id="run_edge_huge_retry")
        assert state.status == "completed"
        assert state.node_states["n2"].metrics["attempt_count"] == 3
        assert state.node_states["n2"].metrics["retry_count"] == 2

    asyncio.run(_run())


def test_scheduler_non_retryable_exception_ignores_retry_config() -> None:
    async def _run() -> None:
        graph = _graph_for_middle(
            "test.edge_non_retryable",
            {"max_retries": 999, "retry_backoff_ms": 0},
            "g_edge_non_retryable",
        )
        compiled = _build_registry().build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory())
        state = await scheduler.run(compiled, run_id="run_edge_non_retryable")
        assert state.status == "failed"
        assert state.node_states["n2"].metrics["attempt_count"] == 1
        assert state.node_states["n2"].metrics["retry_count"] == 0

    asyncio.run(_run())


def test_scheduler_edge_queue_peak_metric_is_reported() -> None:
    async def _run() -> None:
        graph = _graph_for_middle("test.edge_fickle", {"fail_times": 0}, "g_edge_queue_peak")
        compiled = _build_registry().build(graph)
        scheduler = GraphScheduler(node_factory=_build_factory())
        state = await scheduler.run(compiled, run_id="run_edge_queue_peak")
        assert state.status == "completed"
        assert state.metrics["edge_queue_peak_max"] >= 1
        assert state.edge_states[0].queue_peak_size >= 1

    asyncio.run(_run())


def test_run_service_event_pagination_cursor_monotonic() -> None:
    async def _run() -> None:
        service = RunService()
        graph = GraphSpec(
            graph_id="g_edge_page",
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
        record = await service.create_run(graph, stream_id="stream_edge_page")
        await record.task

        cursor = 0
        seen = 0
        for _ in range(500):
            items, next_cursor = service.get_run_events(record.run_id, since=cursor, limit=1)
            assert next_cursor >= cursor
            cursor = next_cursor
            seen += len(items)
            if len(items) == 0:
                break

        all_events, _ = service.get_run_events(record.run_id, since=0, limit=999)
        assert seen == len(all_events)

    asyncio.run(_run())
